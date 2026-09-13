/**
 * Class-templated alert content renderer (T015, FR-ALERT-001/002/003,
 * AC-140/142; PRD §26.2/§26.7/§26.8; plan D6).
 *
 * `renderAlertContent` selects the template from the resolved T012 class policy,
 * fills the shared §26.7/§26.8 `OpportunityContentEnvelope`, and enforces the
 * content laws mechanically:
 * - EARLY_WATCH MUST list explicit missing data and MUST NOT carry
 *   high-conviction/buy language (FR-ALERT-002) — offending content is refused
 *   with the domain's typed `ALERT_HIGH_CONVICTION_LANGUAGE`;
 * - opportunity templates REQUIRE `valid_until`, `actionability_state`,
 *   configured notional, modeled entry/exit impact, cancellation state, evidence
 *   timestamp, execution assumptions, and the frozen run/evidence link;
 * - a positive headline is WITHHELD (and the reason recorded) when the body
 *   carries a critical contradiction, a failed required delay/stress scenario,
 *   an unsupported adapter, expired actionability, or an unauthorized
 *   performance claim (§26.8);
 * - `SOCIAL_UNAVAILABLE` renders as explicit missing data (§67.4) — it is never
 *   a negative feature and never an organic-confirmation claim.
 *
 * The renderer emits DATA ONLY: it has no channel, no credentials, and no
 * delivery path. `contentHash` is `sha256Text(canonicalJson(envelope))`, so the
 * committed content address matches what the outbox delivers.
 *
 * Strictly read-only: nothing here can trade, hold custody, sign, handle private
 * keys, or submit a transaction.
 */
import {
  AlertSuppressionReason,
  ErrorCode,
  ForesiftError,
  assertHighConvictionLanguageAllowed,
  socialIsUnknownCoverage,
  type ActionabilityState,
  type AlertCancellationState,
  type AlertClass,
  type CandidateLifecycleState,
  type SocialCapabilityState,
} from '@foresift/domain';
import { parseAlertSchema, type OpportunityContentEnvelope } from '@foresift/shared-schemas';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import { type AlertContentTemplate, type AlertPolicy } from './policies.ts';
import {
  AlertClassificationKind,
  isClassified,
  type AlertClassificationOutcome,
} from './classification.ts';

// --- renderer input ---------------------------------------------------------

/** Identity/stage fields carried by every rendered alert (§26.7). */
export interface AlertContentIdentity {
  readonly alertId: string;
  readonly assetId: string;
  readonly chainId: string;
  readonly canonicalContract: string;
  readonly profileId: string;
  readonly candidateStage: CandidateLifecycleState;
  readonly detectedAt: string;
  readonly deliveredAt: string;
}

/** Narrative/evidence content (§26.7). */
export interface AlertContentNarrative {
  readonly whyEarly: string;
  readonly positiveEvidence: readonly string[];
  readonly riskEvidence: readonly string[];
  readonly counterThesis: string;
  readonly alphaEvidence: readonly {
    readonly evidenceRef: string;
    readonly lifecycleStatus: string;
  }[];
  readonly patternStage: string | null;
  readonly patternRemainingActionability: string | null;
  readonly multiViewContradictions: readonly string[];
  readonly vetoes: readonly string[];
  readonly failureHazardDrivers: readonly string[];
  readonly noveltyApplicabilityLimits: readonly string[];
  readonly providerConflicts: readonly string[];
  readonly thesisInvalidationConditions: readonly string[];
  readonly sources: readonly string[];
  readonly freshness: string;
}

/** Robust actionability / utility fields (§26.8). */
export interface AlertContentExecutionFields {
  readonly populationScopeClaim: string;
  readonly decisionReadyAt: string;
  readonly actionDelayPolicyRef: string;
  readonly requiredDelayPassMatrix: Record<string, unknown>;
  readonly baseExecutionResult: Record<string, unknown>;
  readonly conservativeExecutionResult: Record<string, unknown>;
  readonly maximumExecutableNotionalUsd: string;
  readonly capacityCaveat: string;
  readonly poolProgramAdapterVersions: Record<string, unknown>;
  readonly conservativeNetUtilityRange: { readonly low: number; readonly high: number };
  readonly portfolioExposureConstraintResult: Record<string, unknown>;
  readonly sourceEffectiveIndependence: string;
  readonly coverageGaps: readonly string[];
  readonly statisticalAuthorizationScope: string;
  readonly statisticalAuthorizationExpiresAt: string;
}

/** §26.8 headline-withholding inputs, each already computed by its owner. */
export interface AlertContentSuppressionFlags {
  readonly criticalContradiction: boolean;
  readonly requiredDelayScenarioPassed: boolean;
  readonly adaptersSupported: boolean;
  readonly performanceClaimAuthorized: boolean;
}

export interface AlertContentRenderInput {
  readonly classification: AlertClassificationOutcome;
  readonly identity: AlertContentIdentity;
  readonly narrative: AlertContentNarrative;
  readonly validUntil: string;
  readonly actionabilityState: ActionabilityState;
  readonly cancellationState: AlertCancellationState;
  readonly evidenceTimestamp: string;
  /** Required for the opportunity template; null renders as explicit missing data. */
  readonly configuredNotionalUsd: string | null;
  readonly modeledEntryImpact: number | null;
  readonly modeledExitImpact: number | null;
  readonly executionAssumptions: Record<string, unknown> | null;
  readonly frozenRunRef: string;
  readonly frozenEvidenceRef: string;
  readonly researchDisclaimer: string;
  readonly socialCapabilityState: SocialCapabilityState;
  /** Required for the opportunity template; null renders as explicit missing data. */
  readonly execution: AlertContentExecutionFields | null;
  readonly suppression: AlertContentSuppressionFlags;
  readonly missingData: readonly string[];
  readonly candidateHeadline: string;
}

// --- renderer output --------------------------------------------------------

export interface RenderedAlertContent {
  readonly alertClass: AlertClass;
  readonly template: AlertContentTemplate;
  /** The positive headline, or null when §26.8 withheld it. */
  readonly headline: string | null;
  readonly headlineSuppressed: boolean;
  readonly suppressionReasons: readonly AlertSuppressionReason[];
  readonly missingData: readonly string[];
  readonly contentHash: string;
  readonly envelope: OpportunityContentEnvelope;
}

/** Typed content refusal; `reason` is the closed machine reason. */
export class AlertContentRefusedError extends ForesiftError {
  readonly reason: AlertSuppressionReason;
  readonly missing: readonly string[];

  constructor(
    reason: AlertSuppressionReason,
    message: string,
    detail: Record<string, string | number | boolean | null> = {},
    missing: readonly string[] = [],
  ) {
    super(ErrorCode.CONTRACT_INVARIANT_VIOLATED, message, detail);
    this.name = 'AlertContentRefusedError';
    this.reason = reason;
    this.missing = missing;
  }
}

const NOT_APPLICABLE = 'NOT_APPLICABLE' as const;
/** The explicit §67.4 missing-data marker for unknown social coverage. */
export const SOCIAL_UNAVAILABLE_MISSING_DATA = 'social_capability:SOCIAL_UNAVAILABLE' as const;
const EARLY_WATCH_CAPACITY_CAVEAT =
  'EARLY_WATCH makes no capacity, execution, or utility claim; coverage is incomplete.';

function dedupeSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function requireOpportunityFields(input: AlertContentRenderInput): readonly string[] {
  const missing: string[] = [];
  if (input.configuredNotionalUsd === null || input.configuredNotionalUsd.length === 0) {
    missing.push('configured_notional_usd');
  }
  if (
    input.modeledEntryImpact === null ||
    !Number.isFinite(input.modeledEntryImpact) ||
    input.modeledEntryImpact < 0
  ) {
    missing.push('modeled_entry_impact');
  }
  if (
    input.modeledExitImpact === null ||
    !Number.isFinite(input.modeledExitImpact) ||
    input.modeledExitImpact < 0
  ) {
    missing.push('modeled_exit_impact');
  }
  if (input.executionAssumptions === null) missing.push('execution_assumptions');
  if (input.frozenRunRef.length === 0) missing.push('frozen_run_ref');
  if (input.frozenEvidenceRef.length === 0) missing.push('frozen_evidence_ref');
  if (input.evidenceTimestamp.length === 0) missing.push('evidence_timestamp');
  if (input.validUntil.length === 0) missing.push('valid_until');
  if (input.execution === null) missing.push('execution_analysis');
  return missing;
}

function suppressionReasonsFor(input: AlertContentRenderInput): readonly AlertSuppressionReason[] {
  const reasons: AlertSuppressionReason[] = [];
  if (input.suppression.criticalContradiction) {
    reasons.push(AlertSuppressionReason.CRITICAL_CONTRADICTION);
  }
  if (!input.suppression.requiredDelayScenarioPassed) {
    reasons.push(AlertSuppressionReason.FAILED_REQUIRED_DELAY_SCENARIO);
  }
  if (!input.suppression.adaptersSupported) {
    reasons.push(AlertSuppressionReason.UNSUPPORTED_ADAPTER);
  }
  if (!input.suppression.performanceClaimAuthorized) {
    reasons.push(AlertSuppressionReason.UNAUTHORIZED_PERFORMANCE_CLAIM);
  }
  if (input.actionabilityState === 'EXPIRED' || input.actionabilityState === 'CANCELLED') {
    reasons.push(AlertSuppressionReason.EXPIRED_ACTIONABILITY);
  }
  return Object.freeze(reasons);
}

function assertRenderable(
  outcome: AlertClassificationOutcome,
): asserts outcome is AlertClassificationOutcome & {
  readonly policy: AlertPolicy;
  readonly alertClass: AlertClass;
} {
  if (outcome.kind !== AlertClassificationKind.CLASSIFIED || !isClassified(outcome)) {
    throw new AlertContentRefusedError(
      outcome.suppressionReason ?? AlertSuppressionReason.GATE_REFUSED,
      'a suppressed classification has no renderable content',
      { suppressionReason: outcome.suppressionReason },
    );
  }
}

/**
 * Render one class-templated content envelope. Deterministic and pure; the only
 * failure modes are typed content refusals (language law, incomplete opportunity
 * content, missing EARLY_WATCH missing-data disclosure).
 */
export function renderAlertContent(input: AlertContentRenderInput): RenderedAlertContent {
  assertRenderable(input.classification);
  const policy = input.classification.policy;
  const alertClass = input.classification.alertClass;
  const template = policy.content.template;

  // AC-142/§67.4: the classification's social coverage is authoritative. A
  // caller-supplied state that contradicts it is refused rather than rendered,
  // so a positive/negative claim can never suppress the missing-data marker.
  const classificationUnknownCoverage = input.classification.socialUnknownCoverage;
  const callerUnknownCoverage = socialIsUnknownCoverage(input.socialCapabilityState);
  if (classificationUnknownCoverage !== callerUnknownCoverage) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'renderer social capability state contradicts the classification social coverage (§67.4)',
      {
        classificationUnknownCoverage,
        callerSocialCapabilityState: input.socialCapabilityState,
      },
    );
  }

  const suppressionReasons = suppressionReasonsFor(input);

  const augmentation: string[] = [];
  if (classificationUnknownCoverage) {
    // §67.4: absent social capability is explicit missing data, never negative.
    augmentation.push(SOCIAL_UNAVAILABLE_MISSING_DATA);
  }
  if (policy.content.requiresOpportunityEnvelope) {
    const missing = requireOpportunityFields(input);
    if (missing.length > 0) {
      throw new AlertContentRefusedError(
        AlertSuppressionReason.GATE_REFUSED,
        'opportunity content is incomplete; a confirmed-opportunity notification cannot be rendered',
        { alertClass, missing: missing.join(',') },
        missing,
      );
    }
  } else {
    if (input.configuredNotionalUsd === null) augmentation.push('configured_notional_usd');
    if (input.modeledEntryImpact === null) augmentation.push('modeled_entry_impact');
    if (input.modeledExitImpact === null) augmentation.push('modeled_exit_impact');
    if (input.executionAssumptions === null) augmentation.push('execution_assumptions');
    if (input.execution === null) augmentation.push('execution_analysis');
  }

  const missingData = dedupeSorted([...input.missingData, ...augmentation]);
  if (policy.content.requiresMissingData && missingData.length === 0) {
    throw new AlertContentRefusedError(
      AlertSuppressionReason.GATE_REFUSED,
      'EARLY_WATCH content must list explicit missing data (FR-ALERT-002)',
      { alertClass },
      [],
    );
  }

  const execution = input.execution;
  const envelopeInput = {
    alertId: input.identity.alertId,
    alertClass,
    assetId: input.identity.assetId,
    chainId: input.identity.chainId,
    canonicalContract: input.identity.canonicalContract,
    profileId: input.identity.profileId,
    candidateStage: input.identity.candidateStage,
    detectedAt: input.identity.detectedAt,
    deliveredAt: input.identity.deliveredAt,
    validUntil: input.validUntil,
    actionabilityState: input.actionabilityState,
    cancellationState: input.cancellationState,
    configuredNotionalUsd: input.configuredNotionalUsd ?? '0',
    modeledEntryImpact: input.modeledEntryImpact ?? 0,
    modeledExitImpact: input.modeledExitImpact ?? 0,
    evidenceTimestamp: input.evidenceTimestamp,
    executionAssumptions: input.executionAssumptions ?? {},
    whyEarly: input.narrative.whyEarly,
    positiveEvidence: [...input.narrative.positiveEvidence],
    riskEvidence: [...input.narrative.riskEvidence],
    counterThesis: input.narrative.counterThesis,
    alphaEvidence: input.narrative.alphaEvidence.map((entry) => ({ ...entry })),
    patternStage: input.narrative.patternStage,
    patternRemainingActionability: input.narrative.patternRemainingActionability,
    multiViewContradictions: [...input.narrative.multiViewContradictions],
    vetoes: [...input.narrative.vetoes],
    failureHazardDrivers: [...input.narrative.failureHazardDrivers],
    noveltyApplicabilityLimits: [...input.narrative.noveltyApplicabilityLimits],
    missingData: [...missingData],
    providerConflicts: [...input.narrative.providerConflicts],
    thesisInvalidationConditions: [...input.narrative.thesisInvalidationConditions],
    freshness: input.narrative.freshness,
    sources: [...input.narrative.sources],
    frozenRunRef: input.frozenRunRef,
    frozenEvidenceRef: input.frozenEvidenceRef,
    researchDisclaimer: input.researchDisclaimer,
    socialCapabilityState: input.socialCapabilityState,
    populationScopeClaim: execution?.populationScopeClaim ?? NOT_APPLICABLE,
    decisionReadyAt: execution?.decisionReadyAt ?? input.evidenceTimestamp,
    actionDelayPolicyRef: execution?.actionDelayPolicyRef ?? NOT_APPLICABLE,
    requiredDelayPassMatrix: execution?.requiredDelayPassMatrix ?? {},
    baseExecutionResult: execution?.baseExecutionResult ?? {},
    conservativeExecutionResult: execution?.conservativeExecutionResult ?? {},
    maximumExecutableNotionalUsd: execution?.maximumExecutableNotionalUsd ?? '0',
    capacityCaveat: execution?.capacityCaveat ?? EARLY_WATCH_CAPACITY_CAVEAT,
    poolProgramAdapterVersions: execution?.poolProgramAdapterVersions ?? {},
    conservativeNetUtilityRange: execution?.conservativeNetUtilityRange ?? { low: 0, high: 0 },
    portfolioExposureConstraintResult: execution?.portfolioExposureConstraintResult ?? {},
    sourceEffectiveIndependence: execution?.sourceEffectiveIndependence ?? 'UNKNOWN',
    coverageGaps: execution === null ? [] : [...execution.coverageGaps],
    statisticalAuthorizationScope: execution?.statisticalAuthorizationScope ?? NOT_APPLICABLE,
    statisticalAuthorizationExpiresAt:
      execution?.statisticalAuthorizationExpiresAt ?? input.validUntil,
    suppressionReasons: [...suppressionReasons],
  };

  const envelope = parseAlertSchema('OpportunityContentEnvelope', envelopeInput);
  // FR-ALERT-002: the law is mechanical and runs over the canonical
  // serialization of the WHOLE delivered envelope — every string field
  // (evidence, risk, missing data, disclaimer, sources, …) plus the delivered
  // headline — for every class whose policy forbids high-conviction language
  // (always EARLY_WATCH). Conviction prose can no longer hide in a field the
  // old three-field scan did not read.
  assertHighConvictionLanguageAllowed(
    alertClass,
    `${canonicalJson(envelope)}\n${input.candidateHeadline}`,
  );
  const headlineSuppressed = suppressionReasons.length > 0;
  // A withheld headline must never be replaced by positive phrasing that §26.8
  // forbids surfacing; the envelope keeps the neutral narrative instead.
  const headline = headlineSuppressed ? null : input.candidateHeadline;

  return Object.freeze({
    alertClass,
    template,
    headline,
    headlineSuppressed,
    suppressionReasons,
    missingData,
    contentHash: sha256Text(canonicalJson(envelope)),
    envelope,
  });
}
