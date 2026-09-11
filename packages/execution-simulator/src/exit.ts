/**
 * §64.7 exit modeling (FR-EXEC-002, FR-EXEC-018, AC-238).
 *
 * Versioned exit policies (fixed horizon, take-profit/stop-loss, trailing,
 * staged, liquidity/risk deterioration, thesis invalidation) are evaluated
 * against contemporaneous executable state. Trigger time and completion
 * time are always separate fields — an exit that completed before it
 * triggered is refused. When coarse observation intervals allow both the
 * favorable and the adverse trigger to be reachable and the true ordering
 * is unknown, the primary result uses the ADVERSE_FEASIBLE ordering with
 * the path-ambiguity flag set; the optimistic ordering is secondary
 * analysis only and is never the primary record.
 *
 * Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, AC-238.
 */
import {
  ExecErrorCode,
  ExecVocabularyError,
  ExecutionStatus,
  ExitPolicyKind,
  adverseOrderingRequired,
  exitPolicyKind,
} from '@foresift/domain';
import type { PrimaryOrdering } from '@foresift/domain';
import { composeNetReturn } from './net-return.ts';
import type { NetReturnBreakdown, NetReturnInput } from './net-return.ts';

export type { NetReturnBreakdown, PrimaryOrdering };

/** A versioned exit policy binding a §64.7 kind to its pre-registered id. */
export interface ExitPolicy {
  readonly exitPolicyVersionId: string;
  readonly kind: ExitPolicyKind;
  /**
   * Pre-registered parameters (thresholds, horizons, stage splits).
   * Present only when the kind declares parameters.
   */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Contemporaneous executable state the exit was modeled against (§64.4). */
export interface ExitStateEvidence {
  /** The state snapshot is COMPLETE (executable), not INCOMPLETE_BLOCKING. */
  readonly stateComplete: boolean;
  /** The snapshot's slot — exits model against state at or after the trigger. */
  readonly stateSlot: number;
}

export interface ExitModelInput {
  readonly exitId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly policy: ExitPolicy;
  readonly state: ExitStateEvidence;
  /** When the policy condition triggered (ISO-8601 Z). */
  readonly triggeredAt: string;
  /** When the modeled exit completed (ISO-8601 Z). */
  readonly completedAt: string;
  readonly triggerSlot: number;
  readonly completionSlot: number;
  readonly requestedQuantity: string;
  readonly filledQuantity: string;
  readonly averageExecutionPrice: string;
  readonly status: ExecutionStatus;
  /** Net-return cost legs for this exit (§64.9). */
  readonly netReturn: NetReturnInput;
  /** §64.7/FR-MAT-009 coarse-interval ordering evidence. */
  readonly ordering: {
    readonly favorableReachable: boolean;
    readonly adverseReachable: boolean;
    readonly orderingKnown: boolean;
    /** Optimistic (favorable-first) secondary analysis, when produced. */
    readonly optimisticSecondary: boolean;
  };
}

export interface ExitModelResult {
  readonly exitId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly exitPolicyVersionId: string;
  readonly policyKind: ExitPolicyKind;
  readonly stateComplete: boolean;
  readonly stateSlot: number;
  readonly triggeredAt: string;
  readonly completedAt: string;
  readonly triggerSlot: number;
  readonly completionSlot: number;
  /** Strictly ordered: completion never precedes the trigger. */
  readonly triggerCompletionOrderValid: boolean;
  readonly requestedQuantity: string;
  readonly filledQuantity: string;
  readonly fillFraction: number;
  readonly averageExecutionPrice: string;
  readonly status: ExecutionStatus;
  readonly netReturn: NetReturnBreakdown;
  /** Primary ordering: ADVERSE_FEASIBLE when ambiguous (never optimistic). */
  readonly primaryOrdering: PrimaryOrdering;
  readonly pathAmbiguous: boolean;
  /** The optimistic ordering, when produced, is marked secondary. */
  readonly optimisticSecondary: boolean;
}

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function requireDecimal(value: string, label: string): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

function requireIsoZ(value: string, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

/**
 * Model a §64.7 exit: validate the policy binding, contemporaneous state,
 * trigger/completion ordering, fill quantities, and the adverse-feasible
 * primary ordering. Pure — a record, not an action.
 */
export function modelExit(input: ExitModelInput): ExitModelResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  const policyKind = exitPolicyKind(input.policy.kind);
  if (
    typeof input.policy.exitPolicyVersionId !== 'string' ||
    input.policy.exitPolicyVersionId.length === 0
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FIELD_INVALID',
      field: 'exitPolicyVersionId',
    });
  }
  if (typeof input.policy.parameters !== 'object' || input.policy.parameters === null) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FIELD_INVALID',
      field: 'policy.parameters',
    });
  }
  if (typeof input.state.stateComplete !== 'boolean') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FIELD_INVALID',
      field: 'state.stateComplete',
    });
  }

  const triggeredAt = requireIsoZ(input.triggeredAt, 'triggeredAt');
  const completedAt = requireIsoZ(input.completedAt, 'completedAt');
  if (!Number.isInteger(input.triggerSlot) || !Number.isInteger(input.completionSlot)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FIELD_INVALID',
      field: 'slots',
    });
  }
  const triggerCompletionOrderValid =
    input.completionSlot >= input.triggerSlot && Date.parse(completedAt) >= Date.parse(triggeredAt);
  if (!triggerCompletionOrderValid) {
    // §64.7: trigger and completion are separate instants; an exit recorded
    // as completing before it triggered is an invalid record, refused.
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_COMPLETION_PRECEDES_TRIGGER',
      triggerSlot: input.triggerSlot,
      completionSlot: input.completionSlot,
    });
  }
  if (!input.state.stateComplete && input.status === ExecutionStatus.EXECUTED_FULL) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FULL_STATUS_ON_INCOMPLETE_STATE',
    });
  }

  const requested = requireDecimal(input.requestedQuantity, 'requestedQuantity');
  const filled = requireDecimal(input.filledQuantity, 'filledQuantity');
  requireDecimal(input.averageExecutionPrice, 'averageExecutionPrice');
  const requestedValue = BigInt(requested.split('.')[0] ?? '0');
  const filledValue = BigInt(filled.split('.')[0] ?? '0');
  if (filledValue > requestedValue) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXIT_FILL_EXCEEDS_REQUESTED',
      filled,
      requested,
    });
  }
  const fillFraction =
    requestedValue === 0n ? 0 : Number((filledValue * 10_000n) / requestedValue) / 10_000;

  // §64.7 / FR-MAT-009: adverse-feasible primary ordering with the
  // path-ambiguity flag; optimistic ordering is secondary only.
  const ordering = adverseOrderingRequired(input.ordering);
  if (
    ordering.primaryOrdering === 'ADVERSE_FEASIBLE' &&
    ordering.pathAmbiguous &&
    !input.ordering.optimisticSecondary
  ) {
    // An ambiguous path requires the optimistic read to be demoted to
    // secondary analysis — an ambiguous path with a primary optimistic read
    // is structurally impossible here (refused, never silently accepted).
    throw new ExecVocabularyError(ExecErrorCode.EXEC_ORDERING_INPUT_INVALID, {
      refused: 'OPTIMISTIC_PRIMARY_ORDERING_UNDER_AMBIGUITY_REFUSED',
    });
  }

  return {
    exitId: input.exitId,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    exitPolicyVersionId: input.policy.exitPolicyVersionId,
    policyKind,
    stateComplete: input.state.stateComplete,
    stateSlot: input.state.stateSlot,
    triggeredAt,
    completedAt,
    triggerSlot: input.triggerSlot,
    completionSlot: input.completionSlot,
    triggerCompletionOrderValid,
    requestedQuantity: requested,
    filledQuantity: filled,
    fillFraction,
    averageExecutionPrice: input.averageExecutionPrice,
    status: input.status,
    netReturn: composeNetReturn(input.netReturn),
    primaryOrdering: ordering.primaryOrdering,
    pathAmbiguous: ordering.pathAmbiguous,
    optimisticSecondary: input.ordering.optimisticSecondary,
  };
}
