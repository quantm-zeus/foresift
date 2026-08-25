/**
 * The exact 24-stage execution pipeline orchestrator (FR-CORE-002; PRD
 * §16.2). RUNTIME_STAGE_SEQUENCE is written out verbatim against PRD §16.2
 * stages 1–24 and pinned by `test/pipeline.spec.ts` to stay byte-identical
 * with the domain authority (`PIPELINE_STAGE_ORDER`). Composition REQUIRES a
 * handler for every stage and REFUSES anything else, and execution walks the
 * frozen sequence unconditionally — there is deliberately NO configuration
 * that could skip or reorder a stage.
 */
import { ALL_PIPELINE_STAGES, ForesiftError, type PipelineStage } from '@foresift/domain';

/** THE §16.2 sequence, stages 1–24 verbatim. Frozen; never derived from input. */
export const RUNTIME_STAGE_SEQUENCE = Object.freeze([
  'AUTHENTICATE_ACTOR',
  'AUTHORIZE_SCOPE_ACTION_CLASS_PROFILE_TENANT_RIGHTS',
  'VALIDATE_AND_CANONICALIZE_INPUT',
  'VALIDATE_ACQUISITION_DECISION_AND_AUTHORIZATION_ENVELOPE',
  'PERSIST_REQUESTED_OR_PRE_EXECUTION_BLOCKED_STATE',
  'CALCULATE_EXACT_CACHE_KEY',
  'CHECK_REQUEST_LOCAL_MEMOIZATION',
  'CHECK_FRESH_CACHE',
  'CHECK_ACCEPTABLE_STALE_CACHE_IF_ALLOWED',
  'ACQUIRE_DISTRIBUTED_SINGLE_FLIGHT_LEASE',
  'RECHECK_CACHE_AFTER_LEASE',
  'ESTIMATE_QUOTA_COST_AND_VERIFY_CAPACITY_ADMISSION',
  'ATOMICALLY_RESERVE_QUOTA',
  'CALL_ALLOWLISTED_PROVIDER_COLLECTOR_OPERATION',
  'VALIDATE_CONTENT_TYPE_AND_RAW_SCHEMA',
  'NORMALIZE_IDENTITY_UNITS_TIMESTAMPS_AVAILABILITY_LINEAGE_QUALITY',
  'VALIDATE_NORMALIZED_SCHEMA_AND_SEMANTIC_INVARIANTS',
  'COMMIT_OR_RELEASE_ACTUAL_QUOTA_COST',
  'PERSIST_EVIDENCE_ARTIFACT_METADATA_AND_SOURCE_FINGERPRINT',
  'UPDATE_EXACT_CACHE_WHEN_RIGHTS_AND_POLICY_PERMIT',
  'RELEASE_LEASE_WITH_FENCING_VALIDATION',
  'PERSIST_ACQUISITION_OUTCOME_SOURCE_COST_EVIDENCE_IMPACT',
  'WRITE_AUDIT_AND_TRACE_FOR_SUCCESS_OR_EVERY_FAILURE_BLOCKED_EXIT',
  'RETURN_STRUCTURED_RESULT',
] as const) satisfies readonly PipelineStage[];

/** Live, orchestrator-owned view handed to each stage handler. */
export interface PipelineRunState {
  readonly runId: string;
  /** Append-only trace: stage ids in completion order up to the present. */
  readonly completedStages: readonly PipelineStage[];
}

export type StageHandler = (state: PipelineRunState) => Promise<void>;

/** A complete handler record — one handler per §16.2 stage, nothing else. */
export type PipelineHandlers = Record<PipelineStage, StageHandler>;

export class PipelineOrchestrator {
  private readonly handlers: PipelineHandlers;

  constructor(handlers: PipelineHandlers) {
    const provided = Object.keys(handlers) as PipelineStage[];
    const known = new Set<string>(ALL_PIPELINE_STAGES);
    const missing = RUNTIME_STAGE_SEQUENCE.filter((stage) => !(stage in handlers));
    const unknown = provided.filter((stage) => !known.has(stage));
    if (missing.length > 0 || unknown.length > 0) {
      throw new ForesiftError(
        'PIPELINE_STAGE_UNKNOWN',
        'pipeline handler set does not match the exact §16.2 sequence',
        {
          missing: missing.join(','),
          unknown: unknown.join(','),
        },
      );
    }
    this.handlers = { ...handlers };
  }

  /** THE frozen runtime sequence, exposed read-only. */
  get stageSequence(): readonly PipelineStage[] {
    return RUNTIME_STAGE_SEQUENCE;
  }

  /**
   * Execute every stage strictly in the pinned order. Each stage runs exactly
   * once per run; a throwing stage propagates AFTER its id stays unrecorded,
   * leaving the trace honest about how far the run reached.
   */
  async run(runId: string): Promise<PipelineRunState> {
    const completed: PipelineStage[] = [];
    const state: PipelineRunState = { runId, completedStages: completed };
    for (const stage of RUNTIME_STAGE_SEQUENCE) {
      await this.handlers[stage](state);
      completed.push(stage);
    }
    return state;
  }
}
