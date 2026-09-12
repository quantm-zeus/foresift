/**
 * Alert classification (T014, FR-ALERT-001…004, AC-140/142/143; PRD §26.2/§26.3,
 * §34.3, §67.4; plan D8).
 *
 * `classifyAlert` turns one Zod-validated decision+evidence envelope into
 * exactly one §26.2 class, or an explicit typed suppression. It COMPOSES the
 * T012 per-class policies and the T013 §26.3 gate function; it never re-derives
 * execution, security, or cost logic owned elsewhere.
 *
 * Laws encoded here:
 * - routing: a prior actionable alert routes to expiry / risk / thesis
 *   strengthening-weakening from lifecycle, risk, and actionability;
 * - CONFIRMED_OPPORTUNITY is gate-driven and FAIL-CLOSED: an unavailable or
 *   incomplete gate set suppresses rather than degrading to a weaker class
 *   (§34.3);
 * - `SOCIAL_UNAVAILABLE` is unknown coverage (§67.4): it never lowers the
 *   classification, never counts as negative evidence, and never satisfies
 *   organic confirmation — an explicit organic-confirmation claim made while
 *   social coverage is unavailable is suppressed;
 * - a request that references a prohibited scraping / private-endpoint
 *   capability (§67.3, AC-143) is refused with a typed contract error.
 *
 * Strictly read-only: the classifier only decides whether intelligence may be
 * delivered; nothing here can trade, hold custody, sign, handle private keys, or
 * submit a transaction.
 */
import { z } from 'zod';
import {
  ActionabilityState,
  AgentDecisionKind,
  AlertClass,
  AlertSuppressionReason,
  CandidateLifecycleState,
  CandidateRiskState,
  ErrorCode,
  ForesiftError,
  actionabilityFor,
  confirmedOpportunityEligible,
  parseAlertClass,
  socialIsUnknownCoverage,
  type ConfirmedOpportunityGateResult,
  type SocialCapabilityState,
} from '@foresift/domain';
import {
  AlertClassificationInputSchema,
  UtcTimestampSchema,
  type AlertClassificationInput,
} from '@foresift/shared-schemas';
import {
  ConfirmedOpportunityGateInputSchema,
  evaluateConfirmedOpportunityGates,
  firstRefusedGate,
  validateConfirmedOpportunityGateResults,
} from './gates.ts';
import {
  alertPolicyFor,
  type AlertContentTemplate,
  type AlertPolicy,
  type AlertPolicyRegistry,
} from './policies.ts';

// --- §67.3 prohibited capability access modes -------------------------------

/**
 * §67.3 access modes that MUST NOT be enabled by configuration or a model
 * request: scraping and reverse-engineering private/undocumented endpoints.
 */
export const AlertProhibitedCapabilityMode = {
  SCRAPING: 'SCRAPING',
  PRIVATE_ENDPOINT: 'PRIVATE_ENDPOINT',
  UNDOCUMENTED_ENDPOINT: 'UNDOCUMENTED_ENDPOINT',
  REVERSE_ENGINEERING: 'REVERSE_ENGINEERING',
} as const;
export type AlertProhibitedCapabilityMode =
  (typeof AlertProhibitedCapabilityMode)[keyof typeof AlertProhibitedCapabilityMode];
export const ALL_ALERT_PROHIBITED_CAPABILITY_MODES: readonly AlertProhibitedCapabilityMode[] =
  Object.values(AlertProhibitedCapabilityMode);

const PROHIBITED_CAPABILITY_MARKERS: readonly {
  readonly mode: AlertProhibitedCapabilityMode;
  readonly marker: string;
}[] = Object.freeze([
  { mode: AlertProhibitedCapabilityMode.SCRAPING, marker: 'scraping' },
  { mode: AlertProhibitedCapabilityMode.SCRAPING, marker: 'scrape' },
  { mode: AlertProhibitedCapabilityMode.PRIVATE_ENDPOINT, marker: 'private-endpoint' },
  { mode: AlertProhibitedCapabilityMode.PRIVATE_ENDPOINT, marker: 'private-endpoint' },
  { mode: AlertProhibitedCapabilityMode.PRIVATE_ENDPOINT, marker: 'private-api' },
  { mode: AlertProhibitedCapabilityMode.UNDOCUMENTED_ENDPOINT, marker: 'undocumented-endpoint' },
  { mode: AlertProhibitedCapabilityMode.UNDOCUMENTED_ENDPOINT, marker: 'undocumented-api' },
  { mode: AlertProhibitedCapabilityMode.UNDOCUMENTED_ENDPOINT, marker: 'undocumented' },
  { mode: AlertProhibitedCapabilityMode.REVERSE_ENGINEERING, marker: 'reverse-engineer' },
  { mode: AlertProhibitedCapabilityMode.REVERSE_ENGINEERING, marker: 'reverse-engineering' },
]);

function normalizeCapabilityRef(ref: string): string {
  return ref.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** The prohibited §67.3 mode a capability ref names, or null when permitted. */
export function prohibitedCapabilityModeFor(
  capabilityRef: string,
): AlertProhibitedCapabilityMode | null {
  if (typeof capabilityRef !== 'string' || capabilityRef.length === 0) return null;
  const normalized = normalizeCapabilityRef(capabilityRef);
  for (const { mode, marker } of PROHIBITED_CAPABILITY_MARKERS) {
    if (normalized.includes(marker)) return mode;
  }
  return null;
}

/**
 * §67.3/AC-143 refusal: an alert request that references a prohibited
 * scraping/private-endpoint capability is rejected, never silently ignored.
 */
export function assertNoProhibitedCapabilityRefs(
  capabilityRefs: readonly string[] | undefined,
): void {
  if (capabilityRefs === undefined) return;
  for (const ref of capabilityRefs) {
    const mode = prohibitedCapabilityModeFor(ref);
    if (mode !== null) {
      throw new ForesiftError(
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
        '§67.3: scraping or private/undocumented endpoint capability cannot be enabled by an alert request',
        { capabilityMode: mode },
      );
    }
  }
}

// --- §67.4 social unknown coverage -----------------------------------------

/** The alert layer's social-evidence verdict: unknown coverage is never negative. */
export interface SocialCoverageVerdict {
  readonly unknownCoverage: boolean;
  /** §67.4: unavailable coverage is never negative evidence. */
  readonly negativeEvidence: false;
  /** §67.4: unavailable coverage can never satisfy organic confirmation. */
  readonly organicConfirmationAvailable: false;
  /** §67.4: unavailable coverage contributes exactly zero to the score. */
  readonly scoreContribution: 0;
}

/** Total §67.4 law: absent social capability is unknown coverage, nothing more. */
export function socialCoverageVerdict(state: SocialCapabilityState): SocialCoverageVerdict {
  return Object.freeze({
    unknownCoverage: socialIsUnknownCoverage(state),
    negativeEvidence: false as const,
    organicConfirmationAvailable: false as const,
    scoreContribution: 0 as const,
  });
}

// --- request envelope -------------------------------------------------------

/**
 * The classifier's request is the shared §26.1 input envelope extended with the
 * three pieces the classifier needs beyond the row shape:
 * - `now` for actionability,
 * - `gateInputs` for the T013 gate function (absent ⇒ consume `gateResults`),
 * - `requestedCapabilityRefs` / `organicConfirmationClaimed` for the §67 laws.
 */
export const AlertClassificationRequestSchema = AlertClassificationInputSchema.extend({
  now: UtcTimestampSchema.optional(),
  organicConfirmationClaimed: z.boolean().optional(),
  requestedCapabilityRefs: z.array(z.string().min(1)).optional(),
  gateInputs: ConfirmedOpportunityGateInputSchema.nullable().optional(),
});
export type AlertClassificationRequest = z.infer<typeof AlertClassificationRequestSchema>;

// --- outcome ----------------------------------------------------------------

export const AlertClassificationKind = {
  CLASSIFIED: 'CLASSIFIED',
  SUPPRESSED: 'SUPPRESSED',
} as const;
export type AlertClassificationKind =
  (typeof AlertClassificationKind)[keyof typeof AlertClassificationKind];

/** The classification result: exactly one class, or an explicit suppression. */
export interface AlertClassificationOutcome {
  readonly kind: AlertClassificationKind;
  /** The §26.2 class, set iff `kind` is CLASSIFIED. */
  readonly alertClass: AlertClass | null;
  /** The resolved T012 policy for the class, or null when suppressed. */
  readonly policy: AlertPolicy | null;
  readonly contentTemplate: AlertContentTemplate | null;
  /** The §26.3 gate results actually consumed (possibly empty). */
  readonly gates: readonly ConfirmedOpportunityGateResult[];
  /** The typed suppression reason, set iff `kind` is SUPPRESSED. */
  readonly suppressionReason: AlertSuppressionReason | null;
  readonly socialUnknownCoverage: boolean;
  /** False whenever social coverage is unavailable (§67.4). */
  readonly organicConfirmationClaimed: boolean;
  /** True iff the complete fourteen-gate set was available and validated. */
  readonly gateSetComplete: boolean;
}

function classifiedOutcome(
  alertClass: AlertClass,
  registry: AlertPolicyRegistry | undefined,
  gates: readonly ConfirmedOpportunityGateResult[],
  socialUnknownCoverage: boolean,
  organicConfirmationClaimed: boolean,
  gateSetComplete: boolean,
): AlertClassificationOutcome {
  const policy =
    registry === undefined ? alertPolicyFor(alertClass) : registry.policyFor(alertClass);
  return Object.freeze({
    kind: AlertClassificationKind.CLASSIFIED,
    alertClass,
    policy,
    contentTemplate: policy.content.template,
    gates,
    suppressionReason: null,
    socialUnknownCoverage,
    organicConfirmationClaimed,
    gateSetComplete,
  });
}

function suppressionOutcome(
  reason: AlertSuppressionReason,
  gates: readonly ConfirmedOpportunityGateResult[],
  socialUnknownCoverage: boolean,
  gateSetComplete: boolean,
): AlertClassificationOutcome {
  return Object.freeze({
    kind: AlertClassificationKind.SUPPRESSED,
    alertClass: null,
    policy: null,
    contentTemplate: null,
    gates,
    suppressionReason: reason,
    socialUnknownCoverage,
    organicConfirmationClaimed: false,
    gateSetComplete,
  });
}

// --- routing ----------------------------------------------------------------

const WEAKENING_LIFECYCLE: readonly CandidateLifecycleState[] = [CandidateLifecycleState.DECAYING];
const TERMINAL_LIFECYCLE: readonly CandidateLifecycleState[] = [
  CandidateLifecycleState.ARCHIVED,
  CandidateLifecycleState.REJECTED,
];
const RISK_CLASS_RISK: readonly CandidateRiskState[] = [
  CandidateRiskState.HIGH,
  CandidateRiskState.CRITICAL,
  CandidateRiskState.CONFLICTING,
];

interface RouteDecision {
  readonly alertClass: AlertClass;
}

function routePriorUpdate(
  request: AlertClassificationRequest,
  actionability: ActionabilityState | null,
): RouteDecision | AlertSuppressionReason {
  // A prior alert past its validity (or explicitly cancelled) is no longer
  // actionable: FR-ALERT-004 emits nothing for it.
  if (
    actionability === ActionabilityState.EXPIRED ||
    actionability === ActionabilityState.CANCELLED
  ) {
    return AlertSuppressionReason.EXPIRED_ACTIONABILITY;
  }
  // The final actionability window is the explicit expiry update (§26.2).
  if (actionability === ActionabilityState.EXPIRING) {
    return { alertClass: AlertClass.OPPORTUNITY_EXPIRED };
  }
  if (RISK_CLASS_RISK.includes(request.riskState)) return { alertClass: AlertClass.RISK_ALERT };
  if (TERMINAL_LIFECYCLE.includes(request.lifecycleState)) {
    return { alertClass: AlertClass.OPPORTUNITY_EXPIRED };
  }
  if (WEAKENING_LIFECYCLE.includes(request.lifecycleState)) {
    return { alertClass: AlertClass.THESIS_WEAKENING };
  }
  return { alertClass: AlertClass.THESIS_STRENGTHENING };
}

function isSuppression(
  value: RouteDecision | AlertSuppressionReason,
): value is AlertSuppressionReason {
  return typeof value === 'string';
}

/**
 * The ordered, deterministic §26.2 routing law. Returns either the class to
 * classify or the typed suppression reason that prevents any alert.
 */
function routeAlertClass(
  request: AlertClassificationRequest,
  gates: readonly ConfirmedOpportunityGateResult[],
  gateSetComplete: boolean,
  socialUnknownCoverage: boolean,
): { readonly alertClass: AlertClass } | { readonly suppression: AlertSuppressionReason } {
  if (socialUnknownCoverage && request.organicConfirmationClaimed === true) {
    // §67.4: unavailable coverage can never satisfy organic confirmation.
    return { suppression: AlertSuppressionReason.SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION };
  }

  if (
    request.decision === AgentDecisionKind.IGNORE ||
    request.decision === AgentDecisionKind.REJECT ||
    request.decision === AgentDecisionKind.INSUFFICIENT_DATA
  ) {
    return { suppression: AlertSuppressionReason.GATE_REFUSED };
  }

  const actionability =
    request.now === undefined ? null : actionabilityFor(request.validUntil, null, request.now);

  if (request.priorAlertRef !== null) {
    const route = routePriorUpdate(request, actionability);
    return isSuppression(route) ? { suppression: route } : route;
  }

  if (
    actionability === ActionabilityState.EXPIRED ||
    actionability === ActionabilityState.CANCELLED
  ) {
    return { suppression: AlertSuppressionReason.EXPIRED_ACTIONABILITY };
  }
  if (TERMINAL_LIFECYCLE.includes(request.lifecycleState)) {
    return { alertClass: AlertClass.OPPORTUNITY_EXPIRED };
  }
  if (RISK_CLASS_RISK.includes(request.riskState)) {
    return { alertClass: AlertClass.RISK_ALERT };
  }

  const recommended = request.alertClassRecommendation;
  const wantsConfirmed =
    recommended === AlertClass.CONFIRMED_OPPORTUNITY ||
    (recommended === null && request.gateInputs !== null && request.gateInputs !== undefined);

  if (wantsConfirmed) {
    // §34.3 fail-closed: an unavailable or incomplete gate set suppresses a
    // would-be confirmed opportunity rather than degrading it to a weaker class.
    if (!gateSetComplete) return { suppression: AlertSuppressionReason.GATE_REFUSED };
    if (!confirmedOpportunityEligible(gates)) {
      return {
        suppression: firstRefusedGate(gates)?.reason ?? AlertSuppressionReason.GATE_REFUSED,
      };
    }
    return { alertClass: AlertClass.CONFIRMED_OPPORTUNITY };
  }

  if (recommended !== null) {
    return { alertClass: parseAlertClass(recommended) };
  }
  return { alertClass: AlertClass.EARLY_WATCH };
}

// --- the classifier ---------------------------------------------------------

function resolveGateResults(request: AlertClassificationRequest): {
  readonly gates: readonly ConfirmedOpportunityGateResult[];
  readonly complete: boolean;
} {
  if (request.gateInputs !== null && request.gateInputs !== undefined) {
    const gates = evaluateConfirmedOpportunityGates(request.gateInputs);
    return { gates, complete: true };
  }
  if (request.gateResults.length === 0) return { gates: [], complete: false };
  try {
    const gates = validateConfirmedOpportunityGateResults(request.gateResults);
    return { gates, complete: true };
  } catch {
    // An incomplete or malformed observed gate set fails closed: the caller's
    // results are consumed only when they are exactly the fourteen gates.
    return { gates: request.gateResults, complete: false };
  }
}

/**
 * Classify a Zod-validated decision+evidence request. Deterministic and pure
 * except for the optional registry policy lookup.
 */
export function classifyAlert(
  rawInput: unknown,
  options: { readonly registry?: AlertPolicyRegistry } = {},
): AlertClassificationOutcome {
  const request = AlertClassificationRequestSchema.parse(rawInput) as AlertClassificationRequest;
  assertNoProhibitedCapabilityRefs(
    request.requestedCapabilityRefs as readonly string[] | undefined,
  );

  const socialUnknownCoverage = socialIsUnknownCoverage(request.socialCapabilityState);
  const { gates, complete } = resolveGateResults(request);
  const route = routeAlertClass(request, gates, complete, socialUnknownCoverage);

  if ('suppression' in route) {
    return suppressionOutcome(route.suppression, gates, socialUnknownCoverage, complete);
  }
  return classifiedOutcome(
    route.alertClass,
    options.registry,
    gates,
    socialUnknownCoverage,
    socialUnknownCoverage ? false : request.organicConfirmationClaimed === true,
    complete,
  );
}

/** True iff the outcome is a delivered-eligible classification. */
export function isClassified(
  outcome: AlertClassificationOutcome,
): outcome is AlertClassificationOutcome & {
  readonly alertClass: AlertClass;
  readonly policy: AlertPolicy;
} {
  return outcome.kind === AlertClassificationKind.CLASSIFIED && outcome.alertClass !== null;
}

/** The §26.1 input type re-exported for callers building a request. */
export type { AlertClassificationInput };
