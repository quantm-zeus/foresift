/**
 * Objective-integrity detectors (FR-OBJ-006): denominator gaming,
 * selective-universe changes, reduced exploration, delayed outcome
 * omission, horizon switching, scenario cherry-picking, and repeated
 * holdout inspection.
 *
 * Seven deterministic detectors over consumed frozen-run evidence from
 * the maturity ledger, the experiment registry, and holdout states. Any
 * firing signal yields `FAIL_BLOCKS_PROMOTION`; all seven detectors must
 * report or the assessment refuses fail-closed.
 */
import {
  ALL_INTEGRITY_SIGNAL_KINDS,
  ObjError,
  ObjErrorCode,
  integrityFailureBlocksPromotion,
  type IntegritySignalKind,
  type IntegrityVerdict,
} from '@foresift/domain';

/** Consumed frozen-run evidence feeding all seven detectors. */
export interface FrozenIntegrityEvidence {
  readonly runId: string;
  /** Denominator counts: frozen vs evaluated (gaming changes the denominator post-hoc). */
  readonly recordedDenominatorCount: number;
  readonly evaluatedDenominatorCount: number;
  /** Candidate-universe identity: frozen vs evaluated. */
  readonly frozenUniverseHash: string;
  readonly evaluatedUniverseHash: string;
  /** Exploration rate in integer basis points: frozen vs observed. */
  readonly frozenExplorationRateBps: number;
  readonly observedExplorationRateBps: number;
  /** Pending outcomes at freeze vs outcomes omitted since. */
  readonly pendingOutcomesAtFreeze: number;
  readonly omittedPendingOutcomes: number;
  /** Evaluation horizon: frozen vs evaluated. */
  readonly frozenHorizon: string;
  readonly evaluatedHorizon: string;
  /** Execution-scenario sets: frozen vs evaluated. */
  readonly frozenScenarioSet: readonly string[];
  readonly evaluatedScenarioSet: readonly string[];
  /** Holdout inspections: repeated inspection exhausts the holdout. */
  readonly holdoutInspectionCount: number;
}

/** One integrity assessment: verdict plus the exact firing signals. */
export interface IntegrityAssessment {
  readonly runId: string;
  readonly verdict: IntegrityVerdict;
  readonly firing: readonly IntegritySignalKind[];
}

function assertCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ObjError(
      ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
      'integrity count must be a non-negative integer',
      {
        field,
      },
    );
  return value;
}

function assertBasisPoints(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000)
    throw new ObjError(
      ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
      'integrity rate must be integer basis points',
      {
        field,
      },
    );
  return value;
}

function sameScenarioSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return orderedLeft.every((scenario, index) => scenario === orderedRight[index]);
}

/**
 * Run all seven detectors over consumed frozen-run evidence. Every
 * detector reports a boolean; the record is complete by construction.
 */
export function detectIntegritySignals(
  evidence: FrozenIntegrityEvidence,
): Readonly<Record<IntegritySignalKind, boolean>> {
  if (evidence.runId.length === 0)
    throw new ObjError(
      ObjErrorCode.OBJ_DIMENSION_UNKNOWN,
      'integrity evidence requires a run id',
      {},
    );
  assertCount(evidence.recordedDenominatorCount, 'recordedDenominatorCount');
  assertCount(evidence.evaluatedDenominatorCount, 'evaluatedDenominatorCount');
  assertBasisPoints(evidence.frozenExplorationRateBps, 'frozenExplorationRateBps');
  assertBasisPoints(evidence.observedExplorationRateBps, 'observedExplorationRateBps');
  assertCount(evidence.pendingOutcomesAtFreeze, 'pendingOutcomesAtFreeze');
  assertCount(evidence.omittedPendingOutcomes, 'omittedPendingOutcomes');
  assertCount(evidence.holdoutInspectionCount, 'holdoutInspectionCount');
  return {
    DENOMINATOR_GAMING: evidence.evaluatedDenominatorCount !== evidence.recordedDenominatorCount,
    SELECTIVE_UNIVERSE_CHANGE: evidence.evaluatedUniverseHash !== evidence.frozenUniverseHash,
    REDUCED_EXPLORATION: evidence.observedExplorationRateBps < evidence.frozenExplorationRateBps,
    DELAYED_OUTCOME_OMISSION: evidence.omittedPendingOutcomes > 0,
    HORIZON_SWITCHING: evidence.evaluatedHorizon !== evidence.frozenHorizon,
    SCENARIO_CHERRY_PICKING: !sameScenarioSet(
      evidence.frozenScenarioSet,
      evidence.evaluatedScenarioSet,
    ),
    REPEATED_HOLDOUT_INSPECTION: evidence.holdoutInspectionCount > 1,
  };
}

/** Assess: any firing signal yields `FAIL_BLOCKS_PROMOTION`, else `PASS`. */
export function assessIntegrity(evidence: FrozenIntegrityEvidence): IntegrityAssessment {
  const signals = detectIntegritySignals(evidence);
  const firing = ALL_INTEGRITY_SIGNAL_KINDS.filter((signal) => signals[signal]);
  return {
    runId: evidence.runId,
    verdict: firing.length > 0 ? 'FAIL_BLOCKS_PROMOTION' : 'PASS',
    firing,
  };
}

/** Asserting form: a firing assessment refuses; a pass returns void. */
export function assertIntegrityPass(evidence: FrozenIntegrityEvidence): void {
  integrityFailureBlocksPromotion(detectIntegritySignals(evidence));
}
