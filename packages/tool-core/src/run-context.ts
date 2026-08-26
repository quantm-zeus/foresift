/**
 * Per-run execution context for the 24-stage pipeline (FR-CORE-002; PRD
 * §16.2). The orchestrator hands every stage the same `PipelineRunState`;
 * the engine attaches a mutable `ToolCallContext` to it and each stage module
 * reads/writes exactly its own slice. Stages between a recorded exit and
 * stage 23 short-circuit (no-ops) while stages 23–24 still run — this is how
 * "write audit for success AND every failure/blocked exit" holds without any
 * stage ever executing out of order.
 */
import type {
  ActionClass,
  AcquisitionState,
  BackpressureAction,
  CacheOutcome,
  HolderMode,
  ToolProfileId,
  UtcTimestamp,
  WorkloadClass,
} from '@foresift/domain';
import type { BlockedStatePayload, ProviderConflictRef } from '@foresift/shared-schemas';
import type { ExactCacheKey } from './cache-key.ts';
import type { CacheLookupResult } from './stages/cache.ts';
import type { LeaseHandle } from './single-flight.ts';
import type { QuotaEstimate, QuotaAdmissionDecision } from './quota-contract.ts';
import type { LicenseVerdict } from '@foresift/shared-schemas';
import type { AuthenticatedActor } from './stages/authn.ts';
import type { RegistryEntry } from './registry.ts';
import type { NormalizedPayload } from './stages/dispatch.ts';

/** Deterministic acquisition decision made by UPSTREAM policy (never the model). */
export interface AcquisitionDecision {
  readonly action: 'REQUEST' | 'NOT_REQUESTED';
  readonly policyVersion: string;
  /** Machine-readable policy reason; audited verbatim (never secret material). */
  readonly reason: string;
  /** Randomized-probe assignment probability ∈ (0,1); default fixture-grade 0.5. */
  readonly assignmentProbability?: number;
  /** Estimated decision impact ∈ [0,1]; default 0.5 until policy supplies one. */
  readonly estimatedDecisionImpact?: number;
}

/** THE caller-facing request shape entering stage 1. */
export interface ToolCallRequest {
  readonly toolName: string;
  readonly toolVersion?: string;
  readonly input: unknown;
  /** Opaque credential material — forwarded verbatim to the authn primitive. */
  readonly actorToken?: unknown;
  readonly workloadClass: WorkloadClass;
  readonly holderMode: HolderMode;
  readonly profileId: ToolProfileId;
  readonly acquisitionDecision?: AcquisitionDecision;
  /**
   * Provider-resolution DATA (§16.9: selection is deterministic upstream; the
   * agent never names a paid provider). Defaults keep composite domain tools
   * cacheable without provider knowledge.
   */
  readonly provider?: string;
  readonly operation?: string;
  readonly operationVersion?: string;
  readonly chain?: string;
  readonly canonicalEntityIdentity?: string;
  readonly fieldProjection?: readonly string[];
  /** Explicit as-of semantics; defaults to execution time (live read). */
  readonly asOf?: string;
  /** External endpoint egress wrapping must authorize before dispatch. */
  readonly egress?: { readonly url: string; readonly plane: string };
  readonly tenantEntity?: string;
}

/**
 * A terminal exit recorded mid-pipeline. Later stages no-op except stages
 * whose cleanup semantics must still settle (lease release, quota release,
 * audit, return).
 */
export interface StageExit {
  readonly payload: BlockedStatePayload;
  readonly auditOutcome: 'BLOCKED' | 'ERROR';
  /** True when stage 5 must persist an acquisition row for this exit. */
  readonly persistAcquisitionRow: boolean;
  readonly backpressure?: BackpressureAction;
}

/** Mutable per-run state accumulated by the stage modules. */
export interface ToolCallContext {
  readonly runId: string;
  readonly request: ToolCallRequest;
  /** Injectable clock; every persisted stamp flows through the UtcTimestamp brand. */
  readonly now: () => UtcTimestamp;

  // stages 1–4
  actor: AuthenticatedActor | null;
  entry: RegistryEntry | null;
  actionClass: ActionClass | null;
  licenseVerdict: LicenseVerdict | null;
  canonicalInput: unknown;
  canonicalEntityIdentity: string;
  acquisitionDecision: AcquisitionDecision | null;

  // exits
  exit: StageExit | null;

  // stage 5
  decisionId: string;
  /** How stage 5 persisted the row: REQUESTED vs the applicable blocked state. */
  acquisitionPersistedAs: AcquisitionState | null;

  // stages 6–11
  keyComponents: import('@foresift/shared-schemas').CacheKeyComponents | null;
  cacheKey: ExactCacheKey | null;
  cacheOutcome: CacheOutcome;
  cacheResult: CacheLookupResult | null;
  lease: LeaseHandle | null;
  fenceRefused: boolean;

  // stages 12–13
  quotaEstimate: QuotaEstimate | null;
  quotaAdmission: QuotaAdmissionDecision | null;
  reservationId: string | null;
  reservationSettledAs: 'COMMITTED' | 'RELEASED' | null;
  backpressure: BackpressureAction | null;

  // stages 14–17
  rawResponse: unknown;
  rawContentType: string;
  rawByteLength: number;
  normalized: NormalizedPayload | null;

  // stages 18–22
  evidenceIds: string[];
  sourceFingerprint: string | null;
  actualUnits: number | null;
  storedInCache: boolean;
  retrievalCompleted: boolean;
  observedAt: string | null;
  availableAt: string | null;
  fetchedAt: string | null;
  qualityCodes: string[];
  conflicts: ProviderConflictRef[];
  degradedMarkers: string[];

  // stage 23–24
  /** Stage ids that completed, appended by the orchestrator in pinned order. */
  completedTrace: string[];
  auditSeq: number | null;
  /** The stage-24 product — the returned structured result. */
  result: import('@foresift/shared-schemas').ToolResultEnvelope | null;
}

export function createContext(
  runId: string,
  request: ToolCallRequest,
  now: () => UtcTimestamp,
): ToolCallContext {
  return {
    runId,
    request,
    now,
    actor: null,
    entry: null,
    actionClass: null,
    licenseVerdict: null,
    canonicalInput: undefined,
    canonicalEntityIdentity: '',
    acquisitionDecision: null,
    exit: null,
    decisionId: `acq-${runId}`,
    acquisitionPersistedAs: null,
    keyComponents: null,
    cacheKey: null,
    cacheOutcome: 'MISS',
    cacheResult: null,
    lease: null,
    fenceRefused: false,
    quotaEstimate: null,
    quotaAdmission: null,
    reservationId: null,
    reservationSettledAs: null,
    backpressure: null,
    rawResponse: undefined,
    rawContentType: '',
    rawByteLength: 0,
    normalized: null,
    evidenceIds: [],
    sourceFingerprint: null,
    actualUnits: null,
    storedInCache: false,
    retrievalCompleted: false,
    observedAt: null,
    availableAt: null,
    fetchedAt: null,
    qualityCodes: [],
    conflicts: [],
    degradedMarkers: [],
    completedTrace: [],
    auditSeq: null,
    result: null,
  };
}

export const BLOCKED_ACQUISITION_STATES: ReadonlySet<AcquisitionState> = new Set([
  'NOT_REQUESTED_BY_POLICY',
  'COST_BLOCKED',
  'QUOTA_BLOCKED',
  'CAPABILITY_UNAVAILABLE',
  'RIGHTS_BLOCKED',
]);

/** Record a typed blocked exit (idempotent: the FIRST exit wins). */
export function block(ctx: ToolCallContext, exit: StageExit): void {
  if (ctx.exit !== null) return;
  ctx.exit = exit;
}

/**
 * True when the stage should do its work. Stages after an exit skip unless
 * they carry settlement semantics handled by their own guards.
 */
export function exited(ctx: ToolCallContext): boolean {
  return ctx.exit !== null;
}
