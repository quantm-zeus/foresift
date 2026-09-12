/**
 * Canonical classification inputs for every §26.2 alert class plus the §67
 * negative fixtures (T027, FR-ALERT-001/002/003, AC-140/142/143; PRD §26.2,
 * §67.2-§67.4).
 *
 * Every request is a plain inert object typed with the alert package's own
 * `AlertClassificationRequest`; builders return fresh clones so a test can
 * never mutate a shared fixture. No I/O, clock, credentials, or network.
 */
import type { AlertClassificationRequest } from '@foresift/alerts';
import type { AlertClass } from '@foresift/domain';
import {
  ALERT_FIXTURE_EXPIRING_AT,
  ALERT_FIXTURE_T0,
  ALERT_FIXTURE_VALID_UNTIL,
  ALERT_HASH_A,
  ALERT_HASH_B,
  cloneFixture,
  deepFreeze,
} from './common.ts';
import { PASSING_GATE_INPUT } from './gates.ts';

/** A fresh, schema-shaped classification request with watch defaults. */
export function classificationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  const base: AlertClassificationRequest = {
    assetId: 'asset-1',
    chainId: 'solana',
    profileId: 'profile-1',
    decision: 'WATCH',
    alertClassRecommendation: null,
    lifecycleState: 'EMERGING',
    riskState: 'LOW',
    multiViewState: 'CONSENSUS_POSITIVE',
    noveltyState: 'IN_DISTRIBUTION',
    costPolicyResult: 'PASS',
    socialCapabilityState: 'SOCIAL_FULL',
    thesisVersion: 1,
    severity: 0.5,
    validUntil: ALERT_FIXTURE_VALID_UNTIL,
    validUntilGeneration: 1,
    executionScenarioId: 'scenario-1',
    tradabilityAssessmentId: 'tradability-1',
    materialEvidenceFingerprint: ALERT_HASH_A,
    priorAlertRef: null,
    gateResults: [],
  };
  return { ...cloneFixture(base), ...overrides };
}

// --- canonical per-class inputs ---------------------------------------------

/** Routes to `EARLY_WATCH` (no prior, WATCH decision, no gate inputs). */
export function earlyWatchClassificationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return classificationRequest({
    decision: 'WATCH',
    alertClassRecommendation: null,
    lifecycleState: 'EMERGING',
    now: ALERT_FIXTURE_T0,
    ...overrides,
  });
}

/** Routes to `CONFIRMED_OPPORTUNITY` only through the complete §26.3 gate set. */
export function confirmedOpportunityClassificationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return classificationRequest({
    decision: 'ALERT',
    alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
    lifecycleState: 'CONFIRMED',
    gateInputs: PASSING_GATE_INPUT,
    now: ALERT_FIXTURE_T0,
    ...overrides,
  });
}

/** Routes to `THESIS_STRENGTHENING` (actionable prior, lifecycle CONFIRMED). */
export function thesisStrengtheningClassificationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return classificationRequest({
    decision: 'ALERT',
    alertClassRecommendation: null,
    lifecycleState: 'CONFIRMED',
    priorAlertRef: 'aalt-prior-strengthening',
    materialEvidenceFingerprint: ALERT_HASH_B,
    now: ALERT_FIXTURE_T0,
    ...overrides,
  });
}

/** Routes to `THESIS_WEAKENING` (actionable prior, lifecycle DECAYING). */
export function thesisWeakeningClassificationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return classificationRequest({
    decision: 'ALERT',
    alertClassRecommendation: null,
    lifecycleState: 'DECAYING',
    priorAlertRef: 'aalt-prior-weakening',
    materialEvidenceFingerprint: ALERT_HASH_B,
    now: ALERT_FIXTURE_T0,
    ...overrides,
  });
}

/** Routes to `OPPORTUNITY_EXPIRED` (actionable prior in its expiry window). */
export function opportunityExpiredClassificationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return classificationRequest({
    decision: 'ALERT',
    alertClassRecommendation: null,
    lifecycleState: 'MONITORING',
    priorAlertRef: 'aalt-prior-expiring',
    now: ALERT_FIXTURE_EXPIRING_AT,
    ...overrides,
  });
}

/** Routes to `RISK_ALERT` (actionable prior whose risk state went HIGH). */
export function riskAlertClassificationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return classificationRequest({
    decision: 'ALERT',
    alertClassRecommendation: null,
    lifecycleState: 'CONFIRMED',
    riskState: 'HIGH',
    priorAlertRef: 'aalt-prior-risk',
    now: ALERT_FIXTURE_T0,
    ...overrides,
  });
}

/** The canonical class → request builder registry, total over the six classes. */
export const CANONICAL_CLASSIFICATION_REQUESTS: Readonly<
  Record<AlertClass, () => AlertClassificationRequest>
> = deepFreeze({
  EARLY_WATCH: earlyWatchClassificationRequest,
  CONFIRMED_OPPORTUNITY: confirmedOpportunityClassificationRequest,
  THESIS_STRENGTHENING: thesisStrengtheningClassificationRequest,
  THESIS_WEAKENING: thesisWeakeningClassificationRequest,
  OPPORTUNITY_EXPIRED: opportunityExpiredClassificationRequest,
  RISK_ALERT: riskAlertClassificationRequest,
});

// --- EARLY_WATCH content fixtures (AC-140/142) -------------------------------

/** A compliant EARLY_WATCH headline: no high-conviction or buy language. */
export const EARLY_WATCH_COMPLIANT_HEADLINE =
  'Emerging candidate with incomplete deep-evidence coverage' as const;

/** Explicit missing-data disclosure EARLY_WATCH MUST render (§26.2). */
export const EARLY_WATCH_MISSING_DATA: readonly string[] = deepFreeze([
  'holder_concentration_snapshot',
  'market_depth_snapshot',
  'wallet_alpha_artifact_lifecycle',
]);

/**
 * High-conviction / buy-language bodies. Every entry must be refused for
 * EARLY_WATCH (FR-ALERT-002) and none may reach a rendered watch notification.
 */
export const EARLY_WATCH_HIGH_CONVICTION_HEADLINES: readonly string[] = deepFreeze([
  'This candidate is guaranteed to re-rate',
  'Risk-free entry before the next leg',
  'Buy now before the crowd arrives',
  'A sure thing at this market cap',
  'This will moon once liquidity returns',
  'A 100x setup with no downside',
]);

/** A compliant counter-thesis for watch content (no conviction language). */
export const EARLY_WATCH_COUNTER_THESIS =
  'The pattern may be a false positive; coverage and holder depth are incomplete' as const;

// --- SOCIAL_UNAVAILABLE fixtures (AC-142, PRD §67.2-§67.4) -------------------

/** Paid/missing social capability states; `SOCIAL_UNAVAILABLE` is the unknown one. */
export const SOCIAL_COVERAGE_STATES: readonly string[] = deepFreeze([
  'SOCIAL_FULL',
  'SOCIAL_AGGREGATED',
  'SOCIAL_USER_CURATED',
  'SOCIAL_PARTIAL',
  'SOCIAL_UNAVAILABLE',
  'SOCIAL_LICENSE_BLOCKED',
]);

/** A watch request under unavailable social coverage with NO organic claim. */
export function socialUnavailableRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return earlyWatchClassificationRequest({
    socialCapabilityState: 'SOCIAL_UNAVAILABLE',
    ...overrides,
  });
}

/** A request that (wrongly) claims organic confirmation while coverage is absent. */
export function socialUnavailableOrganicConfirmationRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return socialUnavailableRequest({ organicConfirmationClaimed: true, ...overrides });
}

/** A fully gated confirmation under unavailable social coverage (not blocked). */
export function socialUnavailableConfirmedRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return confirmedOpportunityClassificationRequest({
    socialCapabilityState: 'SOCIAL_UNAVAILABLE',
    ...overrides,
  });
}

// --- unauthorized adapter fixtures (AC-143, PRD §67.3) -----------------------

/** §67.3 capability references that must never be enabled. */
export const PROHIBITED_CAPABILITY_REFS: readonly string[] = deepFreeze([
  'scraping-adapter-v1',
  'private-endpoint-adapter',
  'undocumented-endpoint-adapter',
  'reverse-engineering-adapter',
]);

/** Only official / authorized / user-curated capability references. */
export const AUTHORIZED_CAPABILITY_REFS: readonly string[] = deepFreeze([
  'official-api-v1',
  'provider-authorized-aggregate-v2',
  'public-channel-collector',
  'user-curated-source-list',
]);

/**
 * Case/separator obfuscations of the same prohibited capabilities. The §67.3
 * detector normalizes case and non-alphanumerics, so these must be refused
 * exactly like the canonical spellings.
 */
export const OBFUSCATED_PROHIBITED_CAPABILITY_REFS: readonly string[] = deepFreeze([
  'SCRAPING',
  'Scrape_Data',
  'Private_Endpoint',
  'private-api',
  'Undocumented_API',
  'reverse_engineering',
]);

/** A request naming a prohibited scraping adapter. */
export function prohibitedCapabilityRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return earlyWatchClassificationRequest({
    requestedCapabilityRefs: [...PROHIBITED_CAPABILITY_REFS],
    ...overrides,
  });
}

/** A request naming only authorized adapters. */
export function authorizedCapabilityRequest(
  overrides: Partial<AlertClassificationRequest> = {},
): AlertClassificationRequest {
  return earlyWatchClassificationRequest({
    requestedCapabilityRefs: [...AUTHORIZED_CAPABILITY_REFS],
    ...overrides,
  });
}

/**
 * An `alert.alert_policies.config` payload that tries to smuggle a prohibited
 * adapter reference (and an extra adapter key) into alert configuration. The
 * config is inert data: the resolver must never surface it as capability.
 */
export const PROHIBITED_POLICY_CONFIG: Readonly<Record<string, unknown>> = deepFreeze({
  contentPolicyVersion: 1,
  template: 'EARLY_WATCH',
  capabilityRefs: PROHIBITED_CAPABILITY_REFS,
  alertAdapter: 'private-endpoint-adapter',
});
