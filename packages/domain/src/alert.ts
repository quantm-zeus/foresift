/**
 * Closed alert-lifecycle vocabularies and pure laws (FR-ALERT-001…005, PRD §26,
 * §12.3–12.5, §23.7, §67.2, §33.9).
 *
 * The PRD literal lists — §26.2 alert classes, §26.4 fingerprint fields, §26.3
 * confirmed-opportunity rules, §12.3 candidate lifecycle, §12.4 candidate risk,
 * §12.5 alert state, §23.7 agent-decision/multi-view/novelty/cost vocabularies,
 * §67.2 social capability — are the vocabulary authority. The const objects
 * below transcribe them verbatim; the SQL CHECK lists in `migrations/g2_alert_*.sql`
 * copy the same members. No writer may invent, rename, or omit members.
 *
 * Every parser refuses fail-closed with a stable `ErrorCode` so callers branch
 * on `code`, never on prose. Every law below is total and deterministic: it
 * either returns a pure value or throws a typed `ForesiftError`.
 *
 * Hashing boundary (layering): `fingerprintOf` returns the canonical,
 * byte-stable §26.4 fingerprint PREIMAGE — this package has zero runtime
 * dependencies and never links a crypto primitive. The `sha256:<hex>` content
 * address stored in `alert.alert_fingerprints` is `sha256Text(fingerprintOf(...))`
 * computed at the persistence seam, exactly like `computeExactCacheKey`
 * (packages/tool-core) hashes its canonical component JSON.
 *
 * Strictly read-only: nothing here can trade, hold custody, sign, handle
 * private keys, or submit a transaction.
 */
import { ErrorCode, ForesiftError } from './errors.ts';
import { compareTimestamps, toEpochMs, utcTimestamp } from './timestamps.ts';

// --- §26.2 alert classes ----------------------------------------------------

/** PRD §26.2 closed alert-class vocabulary, verbatim and in order. */
export const AlertClass = {
  EARLY_WATCH: 'EARLY_WATCH',
  CONFIRMED_OPPORTUNITY: 'CONFIRMED_OPPORTUNITY',
  THESIS_STRENGTHENING: 'THESIS_STRENGTHENING',
  THESIS_WEAKENING: 'THESIS_WEAKENING',
  OPPORTUNITY_EXPIRED: 'OPPORTUNITY_EXPIRED',
  RISK_ALERT: 'RISK_ALERT',
} as const;
export type AlertClass = (typeof AlertClass)[keyof typeof AlertClass];
export const ALL_ALERT_CLASSES: readonly AlertClass[] = Object.values(AlertClass);

// --- §12.3 candidate lifecycle ---------------------------------------------

/** PRD §12.3 candidate lifecycle, verbatim and in order. */
export const CandidateLifecycleState = {
  DISCOVERED: 'DISCOVERED',
  QUALIFIED: 'QUALIFIED',
  EMERGING: 'EMERGING',
  CONFIRMED: 'CONFIRMED',
  MONITORING: 'MONITORING',
  DECAYING: 'DECAYING',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CandidateLifecycleState =
  (typeof CandidateLifecycleState)[keyof typeof CandidateLifecycleState];
export const ALL_CANDIDATE_LIFECYCLE_STATES: readonly CandidateLifecycleState[] =
  Object.values(CandidateLifecycleState);

// --- §12.4 candidate risk state --------------------------------------------

/** PRD §12.4 candidate risk state, verbatim and in order. */
export const CandidateRiskState = {
  UNKNOWN: 'UNKNOWN',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
  CONFLICTING: 'CONFLICTING',
} as const;
export type CandidateRiskState = (typeof CandidateRiskState)[keyof typeof CandidateRiskState];
export const ALL_CANDIDATE_RISK_STATES: readonly CandidateRiskState[] =
  Object.values(CandidateRiskState);

// --- §12.5 alert state ------------------------------------------------------

/** PRD §12.5 alert state (persisted lifecycle), verbatim and in order. */
export const AlertState = {
  DRAFT: 'DRAFT',
  SUPPRESSED: 'SUPPRESSED',
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  EXPIRED: 'EXPIRED',
} as const;
export type AlertState = (typeof AlertState)[keyof typeof AlertState];
export const ALL_ALERT_STATES: readonly AlertState[] = Object.values(AlertState);

// --- §26.2 update kinds / cancellation / actionability ----------------------

/** Explicit update-notification kinds (§26.2, plan data model). */
export const AlertUpdateKind = {
  MATERIAL_DETERIORATION: 'MATERIAL_DETERIORATION',
  CANCELLATION: 'CANCELLATION',
  EXPIRY: 'EXPIRY',
  RISK: 'RISK',
} as const;
export type AlertUpdateKind = (typeof AlertUpdateKind)[keyof typeof AlertUpdateKind];
export const ALL_ALERT_UPDATE_KINDS: readonly AlertUpdateKind[] = Object.values(AlertUpdateKind);

/**
 * Cancellation state carried by every opportunity notification (§26.2/§26.7).
 * A cancellation is an explicit, recorded event — never inferred from prose.
 */
export const AlertCancellationState = {
  NONE: 'NONE',
  CANCELLED: 'CANCELLED',
} as const;
export type AlertCancellationState =
  (typeof AlertCancellationState)[keyof typeof AlertCancellationState];
export const ALL_ALERT_CANCELLATION_STATES: readonly AlertCancellationState[] =
  Object.values(AlertCancellationState);

/**
 * The derived actionability verdict for an alert at a given instant. Distinct
 * from `cancellationState` (the recorded event) and from `AlertState` (the
 * delivery lifecycle): this answers "may this alert still be acted on?".
 * `EXPIRING` is the final window before `valid_until`, so a caller can apply the
 * §33.9 budget instead of delivering late.
 */
export const ActionabilityState = {
  ACTIONABLE: 'ACTIONABLE',
  EXPIRING: 'EXPIRING',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type ActionabilityState = (typeof ActionabilityState)[keyof typeof ActionabilityState];
export const ALL_ACTIONABILITY_STATES: readonly ActionabilityState[] =
  Object.values(ActionabilityState);

// --- §23.7 structured-decision vocabularies --------------------------------

/** PRD §23.7 agent decision, verbatim and in order. */
export const AgentDecisionKind = {
  ALERT: 'ALERT',
  WATCH: 'WATCH',
  IGNORE: 'IGNORE',
  REJECT: 'REJECT',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
} as const;
export type AgentDecisionKind = (typeof AgentDecisionKind)[keyof typeof AgentDecisionKind];
export const ALL_AGENT_DECISION_KINDS: readonly AgentDecisionKind[] =
  Object.values(AgentDecisionKind);

/** PRD §23.7 multi-view state, verbatim and in order. */
export const MultiViewState = {
  CONSENSUS_POSITIVE: 'CONSENSUS_POSITIVE',
  CONSENSUS_NEGATIVE: 'CONSENSUS_NEGATIVE',
  MIXED_NONCRITICAL: 'MIXED_NONCRITICAL',
  HIGH_DISAGREEMENT: 'HIGH_DISAGREEMENT',
  CRITICAL_CONTRADICTION: 'CRITICAL_CONTRADICTION',
  INSUFFICIENT_INDEPENDENCE: 'INSUFFICIENT_INDEPENDENCE',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
} as const;
export type MultiViewState = (typeof MultiViewState)[keyof typeof MultiViewState];
export const ALL_MULTI_VIEW_STATES: readonly MultiViewState[] = Object.values(MultiViewState);

/** PRD §23.7 novelty/OOD applicability state, verbatim and in order. */
export const NoveltyState = {
  IN_DISTRIBUTION: 'IN_DISTRIBUTION',
  WEAKLY_NOVEL: 'WEAKLY_NOVEL',
  HIGHLY_NOVEL: 'HIGHLY_NOVEL',
  UNSUPPORTED: 'UNSUPPORTED',
} as const;
export type NoveltyState = (typeof NoveltyState)[keyof typeof NoveltyState];
export const ALL_NOVELTY_STATES: readonly NoveltyState[] = Object.values(NoveltyState);

/** PRD §23.7 cost-policy result, verbatim and in order. */
export const CostPolicyResult = {
  PASS: 'PASS',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED',
} as const;
export type CostPolicyResult = (typeof CostPolicyResult)[keyof typeof CostPolicyResult];
export const ALL_COST_POLICY_RESULTS: readonly CostPolicyResult[] = Object.values(CostPolicyResult);

// --- §67.2 social capability ------------------------------------------------

/** PRD §67.2 capability states, verbatim and in order. */
export const SocialCapabilityState = {
  SOCIAL_FULL: 'SOCIAL_FULL',
  SOCIAL_AGGREGATED: 'SOCIAL_AGGREGATED',
  SOCIAL_USER_CURATED: 'SOCIAL_USER_CURATED',
  SOCIAL_PARTIAL: 'SOCIAL_PARTIAL',
  SOCIAL_UNAVAILABLE: 'SOCIAL_UNAVAILABLE',
  SOCIAL_LICENSE_BLOCKED: 'SOCIAL_LICENSE_BLOCKED',
} as const;
export type SocialCapabilityState =
  (typeof SocialCapabilityState)[keyof typeof SocialCapabilityState];
export const ALL_SOCIAL_CAPABILITY_STATES: readonly SocialCapabilityState[] =
  Object.values(SocialCapabilityState);

// --- §26.3 confirmed-opportunity gates --------------------------------------

/**
 * The fourteen §26.3 conditions, in the PRD's numbered order. Membership of
 * this set is closed: a CONFIRMED_OPPORTUNITY classification requires every
 * gate evaluated exactly once and passing (§26.3).
 */
export const ConfirmedOpportunityGate = {
  DECISION_ALERT: 'DECISION_ALERT',
  NO_CRITICAL_RISK: 'NO_CRITICAL_RISK',
  PROFILE_ELIGIBILITY: 'PROFILE_ELIGIBILITY',
  MINIMUM_DATA_COVERAGE: 'MINIMUM_DATA_COVERAGE',
  MINIMUM_INDEPENDENT_EVIDENCE_GROUPS: 'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS',
  FRESHNESS: 'FRESHNESS',
  SEMANTIC_VALIDATION: 'SEMANTIC_VALIDATION',
  UNRESOLVED_CONFLICT_THRESHOLD: 'UNRESOLVED_CONFLICT_THRESHOLD',
  FINGERPRINT_COOLDOWN: 'FINGERPRINT_COOLDOWN',
  DAILY_SCHEDULE_BUDGET: 'DAILY_SCHEDULE_BUDGET',
  EXECUTION_AWARE_TRADABILITY: 'EXECUTION_AWARE_TRADABILITY',
  ALERT_NOT_EXPIRED: 'ALERT_NOT_EXPIRED',
  SOLANA_SECURITY_CHECKS: 'SOLANA_SECURITY_CHECKS',
  STRICT_FREE_COST_POLICY: 'STRICT_FREE_COST_POLICY',
} as const;
export type ConfirmedOpportunityGate =
  (typeof ConfirmedOpportunityGate)[keyof typeof ConfirmedOpportunityGate];
export const ALL_CONFIRMED_OPPORTUNITY_GATES: readonly ConfirmedOpportunityGate[] =
  Object.values(ConfirmedOpportunityGate);

/** A §26.3 gate evaluation outcome. A refusal always names a typed reason. */
export interface ConfirmedOpportunityGateResult {
  readonly gate: ConfirmedOpportunityGate;
  readonly passed: boolean;
  /** Non-null exactly when `passed` is false. */
  readonly reason: AlertSuppressionReason | null;
}

// --- suppression reasons and fingerprint outcomes --------------------------

/**
 * Closed suppression vocabulary. Every path that decides NOT to deliver an
 * otherwise-eligible alert records one of these machine reasons (never prose),
 * so a suppressed alert is observable rather than silently dropped.
 */
export const AlertSuppressionReason = {
  DUPLICATE_FINGERPRINT: 'DUPLICATE_FINGERPRINT',
  WITHIN_COOLDOWN: 'WITHIN_COOLDOWN',
  IMMATERIAL_CHANGE: 'IMMATERIAL_CHANGE',
  GATE_REFUSED: 'GATE_REFUSED',
  DAILY_SCHEDULE_BUDGET_EXHAUSTED: 'DAILY_SCHEDULE_BUDGET_EXHAUSTED',
  EXPIRED_ACTIONABILITY: 'EXPIRED_ACTIONABILITY',
  CRITICAL_CONTRADICTION: 'CRITICAL_CONTRADICTION',
  FAILED_REQUIRED_DELAY_SCENARIO: 'FAILED_REQUIRED_DELAY_SCENARIO',
  UNSUPPORTED_ADAPTER: 'UNSUPPORTED_ADAPTER',
  UNAUTHORIZED_PERFORMANCE_CLAIM: 'UNAUTHORIZED_PERFORMANCE_CLAIM',
  HIGH_CONVICTION_LANGUAGE: 'HIGH_CONVICTION_LANGUAGE',
  SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION: 'SOCIAL_UNAVAILABLE_ORGANIC_CONFIRMATION',
  SHADOW_MODE: 'SHADOW_MODE',
} as const;
export type AlertSuppressionReason =
  (typeof AlertSuppressionReason)[keyof typeof AlertSuppressionReason];
export const ALL_ALERT_SUPPRESSION_REASONS: readonly AlertSuppressionReason[] =
  Object.values(AlertSuppressionReason);

/**
 * The fingerprint/cooldown ledger verdict for a proposed repeat. `ALLOW` is the
 * only outcome that may reach the commit boundary; the three suppressions are
 * ordered by precedence in `fingerprintOutcome` (duplicate, cooldown, material).
 */
export const FingerprintOutcome = {
  ALLOW: 'ALLOW',
  SUPPRESS_DUPLICATE: 'SUPPRESS_DUPLICATE',
  SUPPRESS_COOLDOWN: 'SUPPRESS_COOLDOWN',
  SUPPRESS_IMMATERIAL: 'SUPPRESS_IMMATERIAL',
} as const;
export type FingerprintOutcome = (typeof FingerprintOutcome)[keyof typeof FingerprintOutcome];
export const ALL_FINGERPRINT_OUTCOMES: readonly FingerprintOutcome[] =
  Object.values(FingerprintOutcome);

/**
 * §33.9 latency-budget verdict. An alert whose budget is exceeded becomes
 * expired or suppressed rather than sent late; `WITHIN_BUDGET` is the only
 * outcome that may proceed to delivery.
 */
export const AlertLatencyBudgetOutcome = {
  WITHIN_BUDGET: 'WITHIN_BUDGET',
  BUDGET_EXCEEDED_EXPIRED: 'BUDGET_EXCEEDED_EXPIRED',
  BUDGET_EXCEEDED_SUPPRESSED: 'BUDGET_EXCEEDED_SUPPRESSED',
} as const;
export type AlertLatencyBudgetOutcome =
  (typeof AlertLatencyBudgetOutcome)[keyof typeof AlertLatencyBudgetOutcome];
export const ALL_ALERT_LATENCY_BUDGET_OUTCOMES: readonly AlertLatencyBudgetOutcome[] =
  Object.values(AlertLatencyBudgetOutcome);

// --- per-class metric keys (§26.2/FR-ALERT-005) -----------------------------

/**
 * Closed, class-scoped metric-key vocabulary. Every key belongs to exactly one
 * alert class, so a metric can never be expressed without a class and
 * EARLY_WATCH can never be pooled into confirmed precision/recall (FR-ALERT-005).
 */
export const AlertMetricKey = {
  EARLY_WATCH_PRECISION: 'EARLY_WATCH_PRECISION',
  EARLY_WATCH_RECALL: 'EARLY_WATCH_RECALL',
  CONFIRMED_PRECISION: 'CONFIRMED_PRECISION',
  CONFIRMED_RECALL: 'CONFIRMED_RECALL',
  THESIS_STRENGTHENING_RECALL: 'THESIS_STRENGTHENING_RECALL',
  THESIS_WEAKENING_RECALL: 'THESIS_WEAKENING_RECALL',
  EXPIRY_TIMELINESS: 'EXPIRY_TIMELINESS',
  RISK_PRECISION: 'RISK_PRECISION',
  RISK_RECALL: 'RISK_RECALL',
} as const;
export type AlertMetricKey = (typeof AlertMetricKey)[keyof typeof AlertMetricKey];
export const ALL_ALERT_METRIC_KEYS: readonly AlertMetricKey[] = Object.values(AlertMetricKey);

/**
 * The class-scoped metric keys. This map is the authority the SQL composite
 * CHECK and the Zod refinement both mirror; EARLY_WATCH and
 * CONFIRMED_OPPORTUNITY never share a key.
 */
export const ALERT_METRIC_KEYS_BY_CLASS: Readonly<Record<AlertClass, readonly AlertMetricKey[]>> = {
  EARLY_WATCH: [AlertMetricKey.EARLY_WATCH_PRECISION, AlertMetricKey.EARLY_WATCH_RECALL],
  CONFIRMED_OPPORTUNITY: [AlertMetricKey.CONFIRMED_PRECISION, AlertMetricKey.CONFIRMED_RECALL],
  THESIS_STRENGTHENING: [AlertMetricKey.THESIS_STRENGTHENING_RECALL],
  THESIS_WEAKENING: [AlertMetricKey.THESIS_WEAKENING_RECALL],
  OPPORTUNITY_EXPIRED: [AlertMetricKey.EXPIRY_TIMELINESS],
  RISK_ALERT: [AlertMetricKey.RISK_PRECISION, AlertMetricKey.RISK_RECALL],
};

// --- fail-closed parsers ----------------------------------------------------

function parseClosed<T extends string>(
  values: readonly T[],
  value: unknown,
  code: ErrorCode,
  label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new ForesiftError(code, `unknown ${label}`, {
    value: typeof value === 'string' ? value : null,
  });
}

export const parseAlertClass = (value: unknown): AlertClass =>
  parseClosed(ALL_ALERT_CLASSES, value, ErrorCode.ALERT_CLASS_UNKNOWN, 'alert class');
export const parseAlertUpdateKind = (value: unknown): AlertUpdateKind =>
  parseClosed(
    ALL_ALERT_UPDATE_KINDS,
    value,
    ErrorCode.ALERT_UPDATE_KIND_UNKNOWN,
    'alert update kind',
  );
export const parseAlertState = (value: unknown): AlertState =>
  parseClosed(ALL_ALERT_STATES, value, ErrorCode.ALERT_STATE_UNKNOWN, 'alert state');
export const parseActionabilityState = (value: unknown): ActionabilityState =>
  parseClosed(
    ALL_ACTIONABILITY_STATES,
    value,
    ErrorCode.ALERT_ACTIONABILITY_UNKNOWN,
    'actionability state',
  );
export const parseAlertCancellationState = (value: unknown): AlertCancellationState =>
  parseClosed(
    ALL_ALERT_CANCELLATION_STATES,
    value,
    ErrorCode.ALERT_CANCELLATION_STATE_UNKNOWN,
    'alert cancellation state',
  );
export const parseCandidateLifecycleState = (value: unknown): CandidateLifecycleState =>
  parseClosed(
    ALL_CANDIDATE_LIFECYCLE_STATES,
    value,
    ErrorCode.ALERT_LIFECYCLE_STATE_UNKNOWN,
    'candidate lifecycle state',
  );
export const parseCandidateRiskState = (value: unknown): CandidateRiskState =>
  parseClosed(
    ALL_CANDIDATE_RISK_STATES,
    value,
    ErrorCode.ALERT_RISK_STATE_UNKNOWN,
    'candidate risk state',
  );
export const parseSocialCapabilityState = (value: unknown): SocialCapabilityState =>
  parseClosed(
    ALL_SOCIAL_CAPABILITY_STATES,
    value,
    ErrorCode.ALERT_SOCIAL_CAPABILITY_UNKNOWN,
    'social capability state',
  );
export const parseAgentDecisionKind = (value: unknown): AgentDecisionKind =>
  parseClosed(
    ALL_AGENT_DECISION_KINDS,
    value,
    ErrorCode.ALERT_DECISION_KIND_UNKNOWN,
    'agent decision',
  );
export const parseMultiViewState = (value: unknown): MultiViewState =>
  parseClosed(
    ALL_MULTI_VIEW_STATES,
    value,
    ErrorCode.ALERT_MULTIVIEW_STATE_UNKNOWN,
    'multi-view state',
  );
export const parseNoveltyState = (value: unknown): NoveltyState =>
  parseClosed(ALL_NOVELTY_STATES, value, ErrorCode.ALERT_NOVELTY_STATE_UNKNOWN, 'novelty state');
export const parseCostPolicyResult = (value: unknown): CostPolicyResult =>
  parseClosed(
    ALL_COST_POLICY_RESULTS,
    value,
    ErrorCode.ALERT_COST_POLICY_RESULT_UNKNOWN,
    'cost policy result',
  );
export const parseAlertMetricKey = (value: unknown): AlertMetricKey =>
  parseClosed(ALL_ALERT_METRIC_KEYS, value, ErrorCode.ALERT_METRIC_KEY_UNKNOWN, 'alert metric key');
export const parseConfirmedOpportunityGate = (value: unknown): ConfirmedOpportunityGate =>
  parseClosed(ALL_CONFIRMED_OPPORTUNITY_GATES, value, ErrorCode.ALERT_GATE_UNKNOWN, 'alert gate');
export const parseAlertSuppressionReason = (value: unknown): AlertSuppressionReason =>
  parseClosed(
    ALL_ALERT_SUPPRESSION_REASONS,
    value,
    ErrorCode.ALERT_SUPPRESSION_REASON_UNKNOWN,
    'alert suppression reason',
  );
export const parseFingerprintOutcome = (value: unknown): FingerprintOutcome =>
  parseClosed(
    ALL_FINGERPRINT_OUTCOMES,
    value,
    ErrorCode.ALERT_FINGERPRINT_OUTCOME_UNKNOWN,
    'fingerprint outcome',
  );
export const parseAlertLatencyBudgetOutcome = (value: unknown): AlertLatencyBudgetOutcome =>
  parseClosed(
    ALL_ALERT_LATENCY_BUDGET_OUTCOMES,
    value,
    ErrorCode.ALERT_LATENCY_OUTCOME_UNKNOWN,
    'alert latency budget outcome',
  );

/** Lowercase aliases mirroring the `wf.ts` convention. */
export const alertClass = parseAlertClass;
export const alertUpdateKind = parseAlertUpdateKind;
export const alertState = parseAlertState;
export const actionabilityState = parseActionabilityState;
export const alertCancellationState = parseAlertCancellationState;
export const candidateLifecycleState = parseCandidateLifecycleState;
export const candidateRiskState = parseCandidateRiskState;
export const socialCapabilityState = parseSocialCapabilityState;
export const agentDecisionKind = parseAgentDecisionKind;
export const multiViewState = parseMultiViewState;
export const noveltyState = parseNoveltyState;
export const costPolicyResult = parseCostPolicyResult;
export const alertMetricKey = parseAlertMetricKey;
export const confirmedOpportunityGate = parseConfirmedOpportunityGate;
export const alertSuppressionReason = parseAlertSuppressionReason;
export const fingerprintOutcome = parseFingerprintOutcome;
export const alertLatencyBudgetOutcome = parseAlertLatencyBudgetOutcome;

// --- per-class policy (D2/D3) ----------------------------------------------

/** Per-class material-change thresholds (§26.4). */
export interface AlertMaterialChangeThresholds {
  /** Minimum absolute severity delta in [0,1] that counts as material. */
  readonly severityDelta: number;
  /** Minimum absolute thesis-version delta that counts as material. */
  readonly thesisVersionDelta: number;
  /** True when a changed material-evidence fingerprint alone is material. */
  readonly materialEvidenceChangeIsMaterial: boolean;
}

/** One immutable per-class policy version (§26.1/§26.2, plan D2). */
export interface AlertClassPolicy {
  readonly alertClass: AlertClass;
  /** Time-to-live in seconds from decision commit. */
  readonly ttlSeconds: number;
  /** Minimum seconds between two delivered alerts under one fingerprint. */
  readonly cooldownSeconds: number;
  /** FR-ALERT-002: only CONFIRMED_OPPORTUNITY may use high-conviction language. */
  readonly highConvictionAllowed: boolean;
  /** FR-ALERT-005: true only for the class counted in confirmed precision/recall. */
  readonly confirmedDenominatorMember: boolean;
  readonly materialChangeThresholds: AlertMaterialChangeThresholds;
}

/**
 * The in-code default policy registry: total over the six §26.2 classes. The
 * durable rows in `alert.alert_policies` carry the versioned overrides; this
 * map is the deterministic fallback and the policy invariant source.
 *
 * TTL ordering is product law (D3): EARLY_WATCH is a low-commitment
 * short-TTL watch and MUST expire strictly sooner than a confirmed
 * opportunity. Cooldowns are per class so a watch cannot storm while a
 * confirmed alert stays quiet for longer.
 */
const ALERT_CLASS_POLICY: Readonly<Record<AlertClass, AlertClassPolicy>> = {
  EARLY_WATCH: {
    alertClass: 'EARLY_WATCH',
    ttlSeconds: 900,
    cooldownSeconds: 300,
    highConvictionAllowed: false,
    confirmedDenominatorMember: false,
    materialChangeThresholds: {
      severityDelta: 0.1,
      thesisVersionDelta: 1,
      materialEvidenceChangeIsMaterial: true,
    },
  },
  CONFIRMED_OPPORTUNITY: {
    alertClass: 'CONFIRMED_OPPORTUNITY',
    ttlSeconds: 3600,
    cooldownSeconds: 900,
    highConvictionAllowed: true,
    confirmedDenominatorMember: true,
    materialChangeThresholds: {
      severityDelta: 0.05,
      thesisVersionDelta: 1,
      materialEvidenceChangeIsMaterial: true,
    },
  },
  THESIS_STRENGTHENING: {
    alertClass: 'THESIS_STRENGTHENING',
    ttlSeconds: 3600,
    cooldownSeconds: 900,
    highConvictionAllowed: false,
    confirmedDenominatorMember: false,
    materialChangeThresholds: {
      severityDelta: 0.05,
      thesisVersionDelta: 1,
      materialEvidenceChangeIsMaterial: true,
    },
  },
  THESIS_WEAKENING: {
    alertClass: 'THESIS_WEAKENING',
    ttlSeconds: 1800,
    cooldownSeconds: 600,
    highConvictionAllowed: false,
    confirmedDenominatorMember: false,
    materialChangeThresholds: {
      severityDelta: 0.05,
      thesisVersionDelta: 1,
      materialEvidenceChangeIsMaterial: true,
    },
  },
  OPPORTUNITY_EXPIRED: {
    alertClass: 'OPPORTUNITY_EXPIRED',
    ttlSeconds: 1800,
    cooldownSeconds: 3600,
    highConvictionAllowed: false,
    confirmedDenominatorMember: false,
    materialChangeThresholds: {
      severityDelta: 0.1,
      thesisVersionDelta: 1,
      materialEvidenceChangeIsMaterial: false,
    },
  },
  RISK_ALERT: {
    alertClass: 'RISK_ALERT',
    ttlSeconds: 7200,
    cooldownSeconds: 300,
    highConvictionAllowed: false,
    confirmedDenominatorMember: false,
    materialChangeThresholds: {
      severityDelta: 0.05,
      thesisVersionDelta: 1,
      materialEvidenceChangeIsMaterial: true,
    },
  },
};

/** Total pure law: every one of the six classes resolves to a policy. */
export function alertPolicyFor(alertClass: AlertClass): AlertClassPolicy {
  // Re-parse so an unknown literal reaching this boundary from untrusted state
  // refuses with the typed code instead of returning `undefined`.
  return ALERT_CLASS_POLICY[parseAlertClass(alertClass)];
}

/** §26.2/§26.3 law: the class TTL the alert/expiry policy defaults to. */
export function defaultTtlSeconds(alertClass: AlertClass): number {
  return alertPolicyFor(alertClass).ttlSeconds;
}

/**
 * D3 invariant, asserted mechanically by the unit suite: EARLY_WATCH's default
 * TTL is strictly shorter than CONFIRMED_OPPORTUNITY's.
 */
export function earlyWatchTtlIsShort(): boolean {
  return (
    defaultTtlSeconds(AlertClass.EARLY_WATCH) < defaultTtlSeconds(AlertClass.CONFIRMED_OPPORTUNITY)
  );
}

// --- §26.4 fingerprint ------------------------------------------------------

/** The exact §26.4 fingerprint field names, in PRD order. */
export const ALERT_FINGERPRINT_FIELDS = [
  'assetId',
  'profileId',
  'alertType',
  'lifecycleState',
  'riskState',
  'thesisVersion',
  'executionScenarioId',
  'validUntilGeneration',
  'materialEvidenceFingerprint',
] as const;
export type AlertFingerprintField = (typeof ALERT_FINGERPRINT_FIELDS)[number];

/** Version tag of the canonical fingerprint preimage encoding. */
export const ALERT_FINGERPRINT_VERSION = 'alert-fingerprint:v1' as const;

/**
 * §26.4 fingerprint input. `alertType` is the §26.2 alert class;
 * `materialEvidenceFingerprint` is the material-evidence fingerprint over the
 * selected material evidence.
 */
export interface AlertFingerprintInput {
  readonly assetId: string;
  readonly profileId: string;
  readonly alertType: AlertClass;
  readonly lifecycleState: CandidateLifecycleState;
  readonly riskState: CandidateRiskState;
  readonly thesisVersion: number;
  readonly executionScenarioId: string;
  readonly validUntilGeneration: number;
  readonly materialEvidenceFingerprint: string;
}

function requireIdentifier(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
      `${field} must be a non-empty string`,
      { field, value: typeof value === 'string' ? value : null },
    );
  }
  return value;
}

function requireNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
      `${field} must be a non-negative integer`,
      { field, value: Number.isFinite(value) ? value : null },
    );
  }
  return value;
}

/** Length-prefixed `name=length:value` part: separator-free and byte-stable. */
function fingerprintPart(field: string, value: string): string {
  return `${field}=${value.length}:${value}`;
}

/**
 * Deterministic §26.4 fingerprint preimage over exactly the nine field names in
 * `ALERT_FINGERPRINT_FIELDS`. Every field is length-prefixed and named, so no
 * field value can collide with a separator and changing any field changes the
 * result. Closed vocabularies are re-parsed fail-closed.
 *
 * Returns the canonical PREIMAGE; the `sha256:<hex>` content address is
 * `sha256Text(fingerprintOf(input))` at the persistence seam (see the module
 * header for the layering rationale).
 */
export function fingerprintOf(input: AlertFingerprintInput): string {
  const parts: readonly string[] = [
    fingerprintPart('assetId', requireIdentifier(input.assetId, 'assetId')),
    fingerprintPart('profileId', requireIdentifier(input.profileId, 'profileId')),
    fingerprintPart('alertType', parseAlertClass(input.alertType)),
    fingerprintPart('lifecycleState', parseCandidateLifecycleState(input.lifecycleState)),
    fingerprintPart('riskState', parseCandidateRiskState(input.riskState)),
    fingerprintPart(
      'thesisVersion',
      String(requireNonNegativeInteger(input.thesisVersion, 'thesisVersion')),
    ),
    fingerprintPart(
      'executionScenarioId',
      requireIdentifier(input.executionScenarioId, 'executionScenarioId'),
    ),
    fingerprintPart(
      'validUntilGeneration',
      String(requireNonNegativeInteger(input.validUntilGeneration, 'validUntilGeneration')),
    ),
    fingerprintPart(
      'materialEvidenceFingerprint',
      requireIdentifier(input.materialEvidenceFingerprint, 'materialEvidenceFingerprint'),
    ),
  ];
  return [ALERT_FINGERPRINT_VERSION, ...parts].join('|');
}

// --- §26.4 material change --------------------------------------------------

/** The minimal prior/next state a repeat decision compares. */
export interface AlertMaterialState {
  readonly alertClass: AlertClass;
  /** Severity in [0,1]. */
  readonly severity: number;
  readonly thesisVersion: number;
  readonly materialEvidenceFingerprint: string;
}

function assertUnitInterval(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ForesiftError(ErrorCode.ALERT_MATERIAL_STATE_INVALID, `${field} must lie in [0,1]`, {
      field,
      value: Number.isFinite(value) ? value : null,
    });
  }
  return value;
}

/**
 * §26.4 repeat law: a repeat is allowed only when severity, thesis, or material
 * evidence changes beyond the per-class configured thresholds. A class change
 * is always material (it is a different alert, not a repeat).
 */
export function materialChangeExceeds(
  prior: AlertMaterialState,
  next: AlertMaterialState,
): boolean {
  const priorClass = parseAlertClass(prior.alertClass);
  const nextClass = parseAlertClass(next.alertClass);
  const priorSeverity = assertUnitInterval(prior.severity, 'prior.severity');
  const nextSeverity = assertUnitInterval(next.severity, 'next.severity');
  const priorThesis = requireNonNegativeInteger(prior.thesisVersion, 'prior.thesisVersion');
  const nextThesis = requireNonNegativeInteger(next.thesisVersion, 'next.thesisVersion');
  const priorEvidence = requireIdentifier(
    prior.materialEvidenceFingerprint,
    'prior.materialEvidenceFingerprint',
  );
  const nextEvidence = requireIdentifier(
    next.materialEvidenceFingerprint,
    'next.materialEvidenceFingerprint',
  );

  if (priorClass !== nextClass) return true;

  const thresholds = alertPolicyFor(priorClass).materialChangeThresholds;
  if (Math.abs(nextSeverity - priorSeverity) >= thresholds.severityDelta) return true;
  if (Math.abs(nextThesis - priorThesis) >= thresholds.thesisVersionDelta) return true;
  return nextEvidence !== priorEvidence && thresholds.materialEvidenceChangeIsMaterial;
}

// --- actionability and update eligibility -----------------------------------

/**
 * The final actionability window before `valid_until`. Inside it the derived
 * state is `EXPIRING`, which is still eligible for an update but is delivered
 * under the §33.9 budget law rather than late.
 */
export const ACTIONABILITY_EXPIRING_WINDOW_SECONDS = 300 as const;

/**
 * Total actionability law. Cancellation (an explicit recorded event) wins over
 * the clock; then an elapsed `valid_until` is `EXPIRED`; then the trailing
 * `ACTIONABILITY_EXPIRING_WINDOW_SECONDS` is `EXPIRING`; otherwise `ACTIONABLE`.
 */
export function actionabilityFor(
  validUntil: string,
  cancellation: AlertCancellationState | null,
  now: string,
): ActionabilityState {
  const until = utcTimestamp(validUntil);
  const at = utcTimestamp(now);
  const cancellationState =
    cancellation === null ? AlertCancellationState.NONE : parseAlertCancellationState(cancellation);
  if (cancellationState === AlertCancellationState.CANCELLED) {
    return ActionabilityState.CANCELLED;
  }
  if (compareTimestamps(at, until) >= 0) return ActionabilityState.EXPIRED;
  const remainingMs = toEpochMs(until) - toEpochMs(at);
  if (remainingMs <= ACTIONABILITY_EXPIRING_WINDOW_SECONDS * 1000) {
    return ActionabilityState.EXPIRING;
  }
  return ActionabilityState.ACTIONABLE;
}

/**
 * FR-ALERT-004 update eligibility: only an actionable prior alert (or one in
 * its final expiry window) may receive a material-deterioration/cancellation/
 * risk update. Expired and cancelled priors emit nothing.
 */
export function updateIsEligible(actionability: ActionabilityState): boolean {
  const state = parseActionabilityState(actionability);
  return state === ActionabilityState.ACTIONABLE || state === ActionabilityState.EXPIRING;
}

// --- §26.3 gate-set membership ---------------------------------------------

/**
 * True iff the observed gate list is EXACTLY the fourteen §26.3 gates, each
 * present once. A missing, duplicated, or foreign gate fails closed.
 */
export function confirmedOpportunityGateSetComplete(
  observed: readonly ConfirmedOpportunityGate[],
): boolean {
  // Cardinality first: a duplicate would otherwise collapse in the Set below
  // and masquerade as a complete evaluation.
  if (observed.length !== ALL_CONFIRMED_OPPORTUNITY_GATES.length) return false;
  const parsed = new Set(observed.map(parseConfirmedOpportunityGate));
  if (parsed.size !== ALL_CONFIRMED_OPPORTUNITY_GATES.length) return false;
  return ALL_CONFIRMED_OPPORTUNITY_GATES.every((gate) => parsed.has(gate));
}

/** Refuses a gate set that is not exactly the closed §26.3 membership. */
export function assertConfirmedOpportunityGateSet(
  observed: readonly ConfirmedOpportunityGate[],
): void {
  if (!confirmedOpportunityGateSetComplete(observed)) {
    throw new ForesiftError(
      ErrorCode.ALERT_GATE_SET_INCOMPLETE,
      'the confirmed-opportunity gate set must evaluate exactly the fourteen §26.3 gates',
      { observed: observed.join(',') },
    );
  }
}

/**
 * Total §26.3 law: CONFIRMED_OPPORTUNITY requires the complete gate set AND
 * every gate passing. A passed result carrying a refusal reason is internally
 * inconsistent and therefore refused fail-closed.
 */
export function confirmedOpportunityEligible(
  results: readonly ConfirmedOpportunityGateResult[],
): boolean {
  if (!confirmedOpportunityGateSetComplete(results.map((result) => result.gate))) return false;
  for (const result of results) {
    if (!result.passed) return false;
    if (result.reason !== null) return false;
  }
  return true;
}

// --- §67.4 social unknown coverage -----------------------------------------

/**
 * §67.4: `SOCIAL_UNAVAILABLE` is unknown coverage. It can never be a negative
 * social feature, prove lack of interest, satisfy organic confirmation, or
 * block a profile without an explicit approved fallback.
 */
export function socialIsUnknownCoverage(state: SocialCapabilityState): boolean {
  return parseSocialCapabilityState(state) === SocialCapabilityState.SOCIAL_UNAVAILABLE;
}

// --- FR-ALERT-005 metric-class binding -------------------------------------

/** The class-scoped metric keys of one alert class. */
export function metricKeysForClass(alertClass: AlertClass): readonly AlertMetricKey[] {
  return ALERT_METRIC_KEYS_BY_CLASS[parseAlertClass(alertClass)];
}

/** True iff `metricKey` belongs to `alertClass`; a cross-class key is refused. */
export function metricKeyAllowedForClass(
  alertClass: AlertClass,
  metricKey: AlertMetricKey,
): boolean {
  return metricKeysForClass(alertClass).includes(parseAlertMetricKey(metricKey));
}

/** Refuses a metric observation whose key does not belong to its class. */
export function assertMetricKeyAllowedForClass(
  alertClass: AlertClass,
  metricKey: AlertMetricKey,
): void {
  const parsedClass = parseAlertClass(alertClass);
  const parsedKey = parseAlertMetricKey(metricKey);
  if (!metricKeyAllowedForClass(parsedClass, parsedKey)) {
    throw new ForesiftError(
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
      `metric ${parsedKey} is not a ${parsedClass} metric; alert metrics are class-scoped (FR-ALERT-005)`,
      { alertClass: parsedClass, metricKey: parsedKey },
    );
  }
}

// --- FR-ALERT-002 high-conviction language guard ---------------------------

/**
 * Deterministic high-conviction / buy-language terms. EARLY_WATCH (and every
 * class whose policy sets `highConvictionAllowed: false`) MUST NOT use any of
 * these; the check is mechanical, not a style convention.
 */
export const HIGH_CONVICTION_LANGUAGE_TERMS: readonly string[] = Object.freeze([
  'guaranteed',
  'guarantee',
  'risk-free',
  'riskless',
  'cannot lose',
  "can't lose",
  'cant lose',
  'sure thing',
  'surefire',
  'sure-fire',
  'will pump',
  'will moon',
  'to the moon',
  'moonshot',
  'buy now',
  'strong buy',
  'must buy',
  'ape in',
  'ape now',
  'no-brainer',
  'no brainer',
  'certain to rise',
  'certain profit',
  'easy money',
  'free money',
  'slam dunk',
  'all in',
  'load up',
  'guaranteed profit',
  'guaranteed returns',
  'guaranteed gains',
  '100x',
  '1000x',
]);

/** The first offending term in `text`, or null when the text is clean. */
export function firstHighConvictionTerm(text: string): string | null {
  if (typeof text !== 'string') {
    throw new ForesiftError(
      ErrorCode.ALERT_HIGH_CONVICTION_LANGUAGE,
      'alert body must be a string',
      { text: null },
    );
  }
  const normalized = text.toLowerCase();
  for (const term of HIGH_CONVICTION_LANGUAGE_TERMS) {
    if (normalized.includes(term)) return term;
  }
  return null;
}

/** True when `text` contains any high-conviction or buy-language term. */
export function containsHighConvictionLanguage(text: string): boolean {
  return firstHighConvictionTerm(text) !== null;
}

/**
 * The FR-ALERT-002 language law: refuse high-conviction/buy language for any
 * class whose policy does not permit it (notably EARLY_WATCH).
 */
export function assertHighConvictionLanguageAllowed(alertClass: AlertClass, text: string): void {
  const policy = alertPolicyFor(alertClass);
  if (policy.highConvictionAllowed) return;
  const term = firstHighConvictionTerm(text);
  if (term !== null) {
    throw new ForesiftError(
      ErrorCode.ALERT_HIGH_CONVICTION_LANGUAGE,
      `alert class ${policy.alertClass} must not use high-conviction or buy language`,
      { alertClass: policy.alertClass, term },
    );
  }
}

// --- fingerprint/cooldown ledger verdict ------------------------------------

export interface FingerprintDecisionInput {
  /** Prior material state under this fingerprint, or null when none exists. */
  readonly prior: AlertMaterialState | null;
  readonly next: AlertMaterialState;
  /** End of the per-class cooldown, or null when none is recorded. */
  readonly cooldownUntil: string | null;
  readonly now: string;
  /** True when the ledger already holds an undelivered row for this fingerprint. */
  readonly duplicateFingerprint: boolean;
}

/**
 * Deterministic §26.4 repeat verdict with a fixed precedence:
 * duplicate → cooldown → immaterial → ALLOW. Only ALLOW may reach the
 * transactional commit boundary.
 */
export function fingerprintOutcomeFor(input: FingerprintDecisionInput): FingerprintOutcome {
  if (input.duplicateFingerprint) return FingerprintOutcome.SUPPRESS_DUPLICATE;
  if (input.cooldownUntil !== null) {
    const until = utcTimestamp(input.cooldownUntil);
    const at = utcTimestamp(input.now);
    if (compareTimestamps(at, until) < 0) return FingerprintOutcome.SUPPRESS_COOLDOWN;
  }
  if (input.prior !== null && !materialChangeExceeds(input.prior, input.next)) {
    return FingerprintOutcome.SUPPRESS_IMMATERIAL;
  }
  return FingerprintOutcome.ALLOW;
}

// --- §33.9 latency budget ---------------------------------------------------

export interface LatencyBudgetInput {
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly actionability: ActionabilityState;
}

/**
 * §33.9: an alert whose decision→delivery budget is exceeded becomes expired
 * or suppressed rather than sent late. A non-positive budget or negative
 * elapsed time is a caller bug and refuses fail-closed.
 */
export function latencyBudgetOutcomeFor(input: LatencyBudgetInput): AlertLatencyBudgetOutcome {
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs < 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_LATENCY_OUTCOME_UNKNOWN,
      'elapsedMs must be a finite non-negative number',
      { elapsedMs: Number.isFinite(input.elapsedMs) ? input.elapsedMs : null },
    );
  }
  if (!Number.isFinite(input.budgetMs) || input.budgetMs <= 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_LATENCY_OUTCOME_UNKNOWN,
      'budgetMs must be a finite positive number',
      { budgetMs: Number.isFinite(input.budgetMs) ? input.budgetMs : null },
    );
  }
  if (input.elapsedMs <= input.budgetMs) {
    return AlertLatencyBudgetOutcome.WITHIN_BUDGET;
  }
  const actionability = parseActionabilityState(input.actionability);
  if (
    actionability === ActionabilityState.EXPIRED ||
    actionability === ActionabilityState.CANCELLED
  ) {
    return AlertLatencyBudgetOutcome.BUDGET_EXCEEDED_EXPIRED;
  }
  return AlertLatencyBudgetOutcome.BUDGET_EXCEEDED_SUPPRESSED;
}
