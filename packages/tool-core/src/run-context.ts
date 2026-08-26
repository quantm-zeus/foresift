/**
 * Engine-internal run context (FR-CORE-002). One mutable context per
 * pipeline run carries the request, the authorization artifacts, and every
 * stage's contribution toward the §16.3 envelope. Stage handlers coordinate
 * EXCLUSIVELY through this context — there is no other shared state.
 *
 * Blocked exits are DATA, not exceptions: a stage that refuses records a
 * typed `blocked` state and every later functional stage short-circuits,
 * while stages 21–24 still run their cleanup/settle/audit/result duties.
 */
import type {
  AcquisitionState,
  BackpressureAction,
  CacheOutcome,
  HolderMode,
  ReservationState,
  WorkloadClass,
} from '@foresift/domain';
import type { CacheKeyComponents, LicenseVerdict, ToolResultEnvelope } from '@foresift/shared-schemas';
import type { QuotaEstimate } from './quota-contract.ts';
import type { ExactCacheKey } from './cache-key.ts';
import type { LeaseHandle } from './single-flight.ts';
import type {
  NormalizedResult,
  OperationRoute,
  ProviderRawResponse,
} from './provider-contract.ts';

/** The caller-visible execution request (§16.2 preamble fields). */
export interface ToolExecutionRequest {
  /** Stable idempotency key; retries of one logical call reuse it. */
  readonly runId: string;
  /** Opaque credential material interpreted only by the injected authn primitive. */
  readonly authnMaterial: unknown;
  readonly holderMode: HolderMode;
  readonly workloadClass: WorkloadClass;
  readonly toolName: string;
  readonly toolVersion?: string | undefined;
  readonly tenantId: string;
  readonly arguments: unknown;
  /** Canonical entity identity — a §16.4 cache-key component. */
  readonly canonicalEntityIdentity: string;
  readonly fieldProjection?: readonly string[] | undefined;
  /** Explicit as-of for replay reads; defaults to decision time. */
  readonly asOf?: string | undefined;
}

/** Authenticated actor identity produced by the injected authn primitive. */
export interface ActorIdentity {
  readonly actorId: string;
  readonly profileId: string;
  readonly scopes: readonly string[];
}

/**
 * The acquisition states a pipeline may EXIT blocked in: every §16.2 refusal
 * state except the two lifecycle states (REQUESTED/RETURNED) that only ever
 * describe successful progress. Matches BlockedStatePayloadSchema exactly.
 */
export type RefusedAcquisitionState = Exclude<AcquisitionState, 'REQUESTED' | 'RETURNED'>;

/** Which stage a blocked exit happened at, and why (machine-readable). */
export interface BlockedExit {
  readonly state: RefusedAcquisitionState;
  readonly machineReason: string;
  readonly atStage: string;
  /** Explicit §16.8 backpressure action when capacity drove the exit. */
  readonly backpressure?: BackpressureAction | undefined;
}

/** One journal entry per ACTUALLY-executed stage (honest trace). */
export interface StageJournalEntry {
  readonly stage: string;
  readonly at: string;
  readonly note?: string | undefined;
}

/**
 * Live per-run state. Nothing here is secret material: audit payloads and
 * envelopes are built only from these fields.
 */
export interface ToolRunContext {
  readonly runId: string;
  request: ToolExecutionRequest;
  readonly startedAt: string;

  // stages 1–2
  actor?: ActorIdentity | undefined;
  registryEntryName?: string | undefined;
  /** Action class of the resolved registry entry (re-checked at stages 4/14). */
  actionClass?: string | undefined;
  route?: OperationRoute | undefined;
  licenseVerdict?: LicenseVerdict | undefined;

  // stage 3
  canonicalInput?: unknown;

  // stage 4
  /** Deterministic pre-persist acquisition decision. */
  decidedState?: AcquisitionState | undefined;

  // stage 5
  acquisitionDecisionId?: string | undefined;

  // stages 6–11
  cacheComponents?: CacheKeyComponents | undefined;
  cacheKey?: ExactCacheKey | undefined;
  cacheOutcome?: CacheOutcome | undefined;
  cachedPayloadRef?: string | undefined;
  cachedFreshnessSeconds?: number | undefined;
  lease?: LeaseHandle | undefined;
  waitedForLease?: boolean | undefined;

  // stages 12–13
  estimate?: QuotaEstimate | undefined;
  reservationId?: string | undefined;
  quotaState?: ReservationState | undefined;
  downgradedProjection?: boolean | undefined;

  // stages 14–17
  rawResponse?: ProviderRawResponse | undefined;
  /** JSON-parsed raw payload carried from stage 15 into stage 16. */
  rawParsed?: unknown;
  sourceFingerprint?: string | undefined;
  result?: NormalizedResult | undefined;

  // stages 18–22
  evidenceIds: string[];
  committedUnits?: number | null | undefined;
  /** True once stage 5 persisted a REQUESTED (retrieval-completable) row. */
  requestedAtPersisted?: boolean | undefined;
  leaseReleased?: boolean | undefined;
  outcomeState?: string | undefined;

  // exits
  blocked?: BlockedExit | undefined;
  servedFromCache: boolean;
  audited: boolean;
  /** Stage-23 chain position of this run's exit entry. */
  auditRecord?:
    | { readonly seq: number; readonly entryHash: string; readonly auditClass: string }
    | undefined;
  envelope?: ToolResultEnvelope | undefined;

  /** Stages that ACTUALLY executed their body (skips are not recorded). */
  journal: StageJournalEntry[];
}
