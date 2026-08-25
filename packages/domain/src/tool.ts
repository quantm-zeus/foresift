/**
 * §16 Shared Tool Core pure contracts (FR-CORE-001…008).
 *
 * Every vocabulary here is the exact PRD set; fail-closed resolution helpers
 * follow the existing `acquisitionState()` style — an unknown external string
 * is a typed refusal, never a guess. These are CONTRACTS only: cost, quota,
 * and license-policy SEMANTICS live outside packages/tool-core/** (they plug
 * in through the seams), so nothing in this module decides admission.
 */
import { ErrorCode, ForesiftError } from './errors.ts';

// --- §5.3 internal write classification --------------------------------------

/**
 * The §5.3 capability classification vocabulary. A tool definition's
 * action class states what kind of capability it is; registration admits
 * READ-ONLY classes ONLY (`ADMISSIBLE_ACTION_CLASSES`) and refuses
 * `PROHIBITED_FINANCIAL` outright (FR-CORE-005). The prohibited value stays
 * IN the vocabulary so screens can name what they refused.
 */
export const ActionClass = {
  EXTERNAL_READ: 'EXTERNAL_READ',
  INTERNAL_STATE_WRITE: 'INTERNAL_STATE_WRITE',
  NOTIFICATION: 'NOTIFICATION',
  ADMINISTRATIVE: 'ADMINISTRATIVE',
  PROHIBITED_FINANCIAL: 'PROHIBITED_FINANCIAL',
} as const;

export type ActionClass = (typeof ActionClass)[keyof typeof ActionClass];

export const ALL_ACTION_CLASSES: readonly ActionClass[] = Object.values(ActionClass);

/** Classes a registry definition may carry; PROHIBITED_FINANCIAL is never one. */
export const ADMISSIBLE_ACTION_CLASSES: readonly ActionClass[] = [
  ActionClass.EXTERNAL_READ,
  ActionClass.INTERNAL_STATE_WRITE,
  ActionClass.NOTIFICATION,
  ActionClass.ADMINISTRATIVE,
];

export function isProhibitedFinancialActionClass(value: ActionClass): boolean {
  return value === ActionClass.PROHIBITED_FINANCIAL;
}

/** True iff this class may appear on a registered tool definition. */
export function isAdmissibleActionClass(value: ActionClass): boolean {
  return ADMISSIBLE_ACTION_CLASSES.includes(value);
}

/** Fail-closed resolution of an external action-class string. */
export function actionClass(value: string): ActionClass {
  const resolved = (ALL_ACTION_CLASSES as readonly string[]).includes(value)
    ? (value as ActionClass)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.ACTION_CLASS_UNKNOWN, 'unknown action class', { value });
  }
  return resolved;
}

// --- §16.8 workload classes ----------------------------------------------------

/** Every tool execution belongs to exactly one of these classes. */
export const WorkloadClass = {
  INTERACTIVE_HIGH: 'INTERACTIVE_HIGH',
  RISK_MONITOR_HIGH: 'RISK_MONITOR_HIGH',
  SCHEDULED_NORMAL: 'SCHEDULED_NORMAL',
  EVALUATION_LOW: 'EVALUATION_LOW',
  BACKFILL_LOW: 'BACKFILL_LOW',
} as const;

export type WorkloadClass = (typeof WorkloadClass)[keyof typeof WorkloadClass];

export const ALL_WORKLOAD_CLASSES: readonly WorkloadClass[] = Object.values(WorkloadClass);

/** Fail-closed resolution of an external workload-class string. */
export function workloadClass(value: string): WorkloadClass {
  const resolved = (ALL_WORKLOAD_CLASSES as readonly string[]).includes(value)
    ? (value as WorkloadClass)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.WORKLOAD_CLASS_UNKNOWN, 'unknown workload class', {
      value,
    });
  }
  return resolved;
}

// --- §16.3 cache outcome --------------------------------------------------------

export const CacheOutcome = {
  MISS: 'MISS',
  HIT_FRESH: 'HIT_FRESH',
  HIT_STALE: 'HIT_STALE',
  REFRESHED: 'REFRESHED',
} as const;

export type CacheOutcome = (typeof CacheOutcome)[keyof typeof CacheOutcome];

export const ALL_CACHE_OUTCOMES: readonly CacheOutcome[] = Object.values(CacheOutcome);

/** Fail-closed resolution of an external cache-outcome string. */
export function cacheOutcome(value: string): CacheOutcome {
  const resolved = (ALL_CACHE_OUTCOMES as readonly string[]).includes(value)
    ? (value as CacheOutcome)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.CACHE_OUTCOME_UNKNOWN, 'unknown cache outcome', { value });
  }
  return resolved;
}

// --- §16.7 quota model -------------------------------------------------------------

export const QuotaModel = {
  RATE_ONLY: 'RATE_ONLY',
  REQUESTS_PER_PERIOD: 'REQUESTS_PER_PERIOD',
  COMPUTE_UNITS_PER_PERIOD: 'COMPUTE_UNITS_PER_PERIOD',
  WEIGHTED_BUCKET: 'WEIGHTED_BUCKET',
  CREDIT_BALANCE: 'CREDIT_BALANCE',
  UNKNOWN_CONFIGURABLE: 'UNKNOWN_CONFIGURABLE',
} as const;

export type QuotaModel = (typeof QuotaModel)[keyof typeof QuotaModel];

export const ALL_QUOTA_MODELS: readonly QuotaModel[] = Object.values(QuotaModel);

/** Fail-closed resolution of an external quota-model string. */
export function quotaModel(value: string): QuotaModel {
  const resolved = (ALL_QUOTA_MODELS as readonly string[]).includes(value)
    ? (value as QuotaModel)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.QUOTA_MODEL_UNKNOWN, 'unknown quota model', { value });
  }
  return resolved;
}

// --- §16.7 reservation lifecycle -----------------------------------------------------

export const ReservationState = {
  PENDING: 'PENDING',
  RESERVED: 'RESERVED',
  COMMITTED: 'COMMITTED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
} as const;

export type ReservationState = (typeof ReservationState)[keyof typeof ReservationState];

export const ALL_RESERVATION_STATES: readonly ReservationState[] = Object.values(ReservationState);

/**
 * Legal transitions of the §16.7 lifecycle:
 *
 *   PENDING -> RESERVED -> COMMITTED
 *   PENDING | RESERVED -> RELEASED
 *   RESERVED -> EXPIRED
 *
 * plus the idempotent retry replays COMMITTED->COMMITTED and
 * RELEASED->RELEASED (INV-009: retries of commit/release converge to the
 * same terminal state instead of erroring or double-counting). Everything
 * else is refused — including any transition out of EXPIRED and any
 * resurrection from a terminal state.
 */
const RESERVATION_TRANSITIONS: Readonly<Record<ReservationState, readonly ReservationState[]>> = {
  [ReservationState.PENDING]: [ReservationState.RESERVED, ReservationState.RELEASED],
  [ReservationState.RESERVED]: [
    ReservationState.COMMITTED,
    ReservationState.RELEASED,
    ReservationState.EXPIRED,
  ],
  [ReservationState.COMMITTED]: [ReservationState.COMMITTED],
  [ReservationState.RELEASED]: [ReservationState.RELEASED],
  [ReservationState.EXPIRED]: [],
};

/** True iff `from → to` is legal (including idempotent retry replays). */
export function isLegalReservationTransition(
  from: ReservationState,
  to: ReservationState,
): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to);
}

/** Fail-closed resolution of an external reservation-state string. */
export function reservationState(value: string): ReservationState {
  const resolved = (ALL_RESERVATION_STATES as readonly string[]).includes(value)
    ? (value as ReservationState)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.RESERVATION_STATE_UNKNOWN, 'unknown reservation state', {
      value,
    });
  }
  return resolved;
}

// --- §16.8 backpressure responses -------------------------------------------------------

/** Backpressure exits are explicit; uncontrolled parallel calls are not an option. */
export const BackpressureAction = {
  QUEUE: 'QUEUE',
  RETURN_CACHE: 'RETURN_CACHE',
  DOWNGRADE_DEPTH: 'DOWNGRADE_DEPTH',
  SKIP_LOW_PRIORITY: 'SKIP_LOW_PRIORITY',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
} as const;

export type BackpressureAction = (typeof BackpressureAction)[keyof typeof BackpressureAction];

export const ALL_BACKPRESSURE_ACTIONS: readonly BackpressureAction[] =
  Object.values(BackpressureAction);

/** Fail-closed resolution of an external backpressure-action string. */
export function backpressureAction(value: string): BackpressureAction {
  const resolved = (ALL_BACKPRESSURE_ACTIONS as readonly string[]).includes(value)
    ? (value as BackpressureAction)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.BACKPRESSURE_ACTION_UNKNOWN, 'unknown backpressure action', {
      value,
    });
  }
  return resolved;
}

// --- §16.6 single-flight holder modes ------------------------------------------------------

/** Single-flight works across ALL of these modes — never in-memory alone. */
export const HolderMode = {
  MCP_MANUAL: 'MCP_MANUAL',
  CHATGPT: 'CHATGPT',
  ADMIN_CHAT: 'ADMIN_CHAT',
  AUTOMATION: 'AUTOMATION',
} as const;

export type HolderMode = (typeof HolderMode)[keyof typeof HolderMode];

export const ALL_HOLDER_MODES: readonly HolderMode[] = Object.values(HolderMode);

/** Fail-closed resolution of an external holder-mode string. */
export function holderMode(value: string): HolderMode {
  const resolved = (ALL_HOLDER_MODES as readonly string[]).includes(value)
    ? (value as HolderMode)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.HOLDER_MODE_UNKNOWN, 'unknown single-flight holder mode', {
      value,
    });
  }
  return resolved;
}

// --- §16.9 tool profiles ------------------------------------------------------------------------

/**
 * The eight default profiles (§16.9). Profile ids are kebab-case strings;
 * the headless agent NEVER receives the entire catalog — binding is narrow.
 */
export const ToolProfileId = {
  DISCOVERY: 'discovery',
  MARKET_RESEARCH: 'market-research',
  SECURITY_RESEARCH: 'security-research',
  HOLDER_WALLET: 'holder-wallet',
  SOCIAL_RESEARCH: 'social-research',
  MACRO_CONTEXT: 'macro-context',
  RUN_INVESTIGATION: 'run-investigation',
  ADMIN_READ: 'admin-read',
} as const;

export type ToolProfileId = (typeof ToolProfileId)[keyof typeof ToolProfileId];

export const ALL_TOOL_PROFILE_IDS: readonly ToolProfileId[] = Object.values(ToolProfileId);

/** Profiles that may see provider-specific atomic tools (§16.9 exclusion rule). */
export const ATOMIC_TOOL_PROFILES: readonly ToolProfileId[] = [ToolProfileId.ADMIN_READ];

/** Fail-closed resolution of an external profile-id string. */
export function toolProfileId(value: string): ToolProfileId {
  const resolved = (ALL_TOOL_PROFILE_IDS as readonly string[]).includes(value)
    ? (value as ToolProfileId)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.TOOL_PROFILE_UNKNOWN, 'unknown tool profile id', { value });
  }
  return resolved;
}

// --- §16.5 field-level freshness ------------------------------------------------------------------

/**
 * Field families of the §16.5 example freshness table. Keys are stable
 * identifiers (not display labels) so cache policy references survive copy edits.
 */
export const FreshnessFieldFamily = {
  PRICE_TRADES: 'price-trades',
  LIQUIDITY_POOL: 'liquidity-pool',
  HOLDER_SUMMARY: 'holder-summary',
  SECURITY_SCAN: 'security-scan',
  DEVELOPER_HISTORY: 'developer-history',
  METADATA: 'metadata',
} as const;

export type FreshnessFieldFamily = (typeof FreshnessFieldFamily)[keyof typeof FreshnessFieldFamily];

export const ALL_FRESHNESS_FIELD_FAMILIES: readonly FreshnessFieldFamily[] =
  Object.values(FreshnessFieldFamily);

/** Who may admit a STALE read for this family (§16.5: price stale is manual-only). */
export const StaleAdmissionScope = {
  AUTOMATED: 'AUTOMATED',
  MANUAL_ONLY: 'MANUAL_ONLY',
} as const;

export type StaleAdmissionScope = (typeof StaleAdmissionScope)[keyof typeof StaleAdmissionScope];

/** One §16.5 table row: fresh TTL + acceptable-stale window + stale scope. */
export interface FreshnessPolicyEntry {
  /** Seconds a stored value stays FRESH after `storedAt`. */
  readonly freshTtlSeconds: number;
  /** Seconds beyond freshUntil during which a stale hit MAY be admitted. */
  readonly acceptableStaleSeconds: number;
  /** Whether automated flows may admit stale reads or only manual ones. */
  readonly staleAdmission: StaleAdmissionScope;
}

/** Per-deployment override table: family → entry. Missing families fail closed. */
export type FreshnessPolicyTable = Readonly<Record<FreshnessFieldFamily, FreshnessPolicyEntry>>;

/**
 * THE §16.5 example defaults, verbatim (30 s / 2 min manual-only price row,
 * 2 min / 10 min liquidity, 10 min / 60 min holders, 6 h / 24 h security,
 * 24 h / 7 d developer history, 7 d / 30 d metadata). Composition roots may
 * override per deployment with configuration data — never by editing code.
 */
export const DEFAULT_FRESHNESS_POLICY_TABLE: FreshnessPolicyTable = Object.freeze({
  [FreshnessFieldFamily.PRICE_TRADES]: Object.freeze({
    freshTtlSeconds: 30,
    acceptableStaleSeconds: 120,
    staleAdmission: StaleAdmissionScope.MANUAL_ONLY,
  }),
  [FreshnessFieldFamily.LIQUIDITY_POOL]: Object.freeze({
    freshTtlSeconds: 120,
    acceptableStaleSeconds: 600,
    staleAdmission: StaleAdmissionScope.AUTOMATED,
  }),
  [FreshnessFieldFamily.HOLDER_SUMMARY]: Object.freeze({
    freshTtlSeconds: 600,
    acceptableStaleSeconds: 3600,
    staleAdmission: StaleAdmissionScope.AUTOMATED,
  }),
  [FreshnessFieldFamily.SECURITY_SCAN]: Object.freeze({
    freshTtlSeconds: 21_600,
    acceptableStaleSeconds: 86_400,
    staleAdmission: StaleAdmissionScope.AUTOMATED,
  }),
  [FreshnessFieldFamily.DEVELOPER_HISTORY]: Object.freeze({
    freshTtlSeconds: 86_400,
    acceptableStaleSeconds: 604_800,
    staleAdmission: StaleAdmissionScope.AUTOMATED,
  }),
  [FreshnessFieldFamily.METADATA]: Object.freeze({
    freshTtlSeconds: 604_800,
    acceptableStaleSeconds: 2_592_000,
    staleAdmission: StaleAdmissionScope.AUTOMATED,
  }),
});

/** Fail-closed resolution of an external field-family string. */
export function freshnessFieldFamily(value: string): FreshnessFieldFamily {
  const resolved = (ALL_FRESHNESS_FIELD_FAMILIES as readonly string[]).includes(value)
    ? (value as FreshnessFieldFamily)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(
      ErrorCode.FRESHNESS_FIELD_FAMILY_UNKNOWN,
      'unknown freshness field family',
      { value },
    );
  }
  return resolved;
}

// --- §16.2 pipeline stage identifiers ---------------------------------------------------------------

/**
 * The 24 execution-pipeline stages (§16.2), named. The ORDER is held by
 * `PIPELINE_STAGE_ORDER` below; no configuration may skip or reorder stages.
 */
export const PipelineStage = {
  AUTHENTICATE_ACTOR: 'AUTHENTICATE_ACTOR',
  AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS:
    'AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS',
  VALIDATE_AND_CANONICALIZE_INPUT: 'VALIDATE_AND_CANONICALIZE_INPUT',
  VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE:
    'VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE',
  PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE:
    'PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE',
  CALCULATE_EXACT_CACHE_KEY: 'CALCULATE_EXACT_CACHE_KEY',
  CHECK_REQUEST_LOCAL_MEMOIZATION: 'CHECK_REQUEST_LOCAL_MEMOIZATION',
  CHECK_FRESH_CACHE: 'CHECK_FRESH_CACHE',
  CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED: 'CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED',
  ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE: 'ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE',
  RECHECK_CACHE_AFTER_LEASE: 'RECHECK_CACHE_AFTER_LEASE',
  ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION:
    'ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION',
  ATOMICALLY_RESERVE_QUOTA: 'ATOMICALLY_RESERVE_QUOTA',
  CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION: 'CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION',
  VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA: 'VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA',
  NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY:
    'NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY',
  VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS:
    'VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS',
  COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST: 'COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST',
  PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT:
    'PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT',
  UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT:
    'UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT',
  RELEASE_LEASE_WITH_FENCING_VALIDATION: 'RELEASE_LEASE_WITH_FENCING_VALIDATION',
  PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT:
    'PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT',
  WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT:
    'WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT',
  RETURN_STRUCTURED_RESULT: 'RETURN_STRUCTURED_RESULT',
} as const;

export type PipelineStage = (typeof PipelineStage)[keyof typeof PipelineStage];

export const ALL_PIPELINE_STAGES: readonly PipelineStage[] = Object.values(PipelineStage);

/**
 * THE exact §16.2 order, stages 1–24 verbatim. `packages/tool-core` pins its
 * runtime sequence against THIS list — the two must stay byte-identical.
 */
export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = [
  PipelineStage.AUTHENTICATE_ACTOR,
  PipelineStage.AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS,
  PipelineStage.VALIDATE_AND_CANONICALIZE_INPUT,
  PipelineStage.VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE,
  PipelineStage.PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE,
  PipelineStage.CALCULATE_EXACT_CACHE_KEY,
  PipelineStage.CHECK_REQUEST_LOCAL_MEMOIZATION,
  PipelineStage.CHECK_FRESH_CACHE,
  PipelineStage.CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED,
  PipelineStage.ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE,
  PipelineStage.RECHECK_CACHE_AFTER_LEASE,
  PipelineStage.ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION,
  PipelineStage.ATOMICALLY_RESERVE_QUOTA,
  PipelineStage.CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION,
  PipelineStage.VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA,
  PipelineStage.NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY,
  PipelineStage.VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS,
  PipelineStage.COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST,
  PipelineStage.PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT,
  PipelineStage.UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT,
  PipelineStage.RELEASE_LEASE_WITH_FENCING_VALIDATION,
  PipelineStage.PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT,
  PipelineStage.WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT,
  PipelineStage.RETURN_STRUCTURED_RESULT,
] as const;

/** Fail-closed resolution of an external stage identifier. */
export function pipelineStage(value: string): PipelineStage {
  const resolved = (ALL_PIPELINE_STAGES as readonly string[]).includes(value)
    ? (value as PipelineStage)
    : undefined;
  if (resolved === undefined) {
    throw new ForesiftError(ErrorCode.PIPELINE_STAGE_UNKNOWN, 'unknown pipeline stage', {
      value,
    });
  }
  return resolved;
}
