/**
 * Objective comparison (FR-OBJ-002): identical candidate universes,
 * population claims, capital, time windows, execution scenarios, delay
 * policies, data cutoffs, and correlated-exposure constraints.
 *
 * Incomparable runs are labeled exploratory and cannot promote a policy;
 * a missing record refuses comparison outright (never a verdict).
 */
import {
  ObjError,
  ObjErrorCode,
  assertIntegerMicros,
  comparabilityRequiresAllDimensions,
  type ComparisonDimension,
  type RunComparability,
} from '@foresift/domain';

/** Frozen run header carrying every comparison dimension. */
export interface ComparableRunRecord {
  readonly runId: string;
  readonly candidateUniverseId: string;
  readonly candidateUniverseHash: string;
  readonly populationClaimId: string;
  readonly capitalMicros: number | bigint;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly executionScenarioId: string;
  readonly executionScenarioVersion: string;
  readonly delayPolicyId: string;
  readonly delayPolicyVersion: string;
  readonly dataCutoff: string;
  readonly correlatedExposureConstraints: readonly string[];
}

/** Project one run header onto its eight dimension values. */
export function comparisonDimensions(
  record: ComparableRunRecord,
): Readonly<Record<ComparisonDimension, string>> {
  if (record.runId.length === 0)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'comparison requires a run id', {});
  return {
    CANDIDATE_UNIVERSE: `${record.candidateUniverseId}@${record.candidateUniverseHash}`,
    POPULATION_CLAIM: record.populationClaimId,
    CAPITAL: assertIntegerMicros(record.capitalMicros, 'capitalMicros').toString(),
    TIME_WINDOW: `${record.windowStart}/${record.windowEnd}`,
    EXECUTION_SCENARIO: `${record.executionScenarioId}@${record.executionScenarioVersion}`,
    DELAY_POLICY: `${record.delayPolicyId}@${record.delayPolicyVersion}`,
    DATA_CUTOFF: record.dataCutoff,
    CORRELATED_EXPOSURE: [...record.correlatedExposureConstraints].sort().join(','),
  };
}

/**
 * Pairwise equality over all eight dimensions: `COMPARABLE` only on
 * exact match, else `EXPLORATORY_ONLY`. A null or missing record
 * refuses via the domain law.
 */
export function assessComparability(
  left: ComparableRunRecord | null | undefined,
  right: ComparableRunRecord | null | undefined,
): RunComparability {
  const leftRecord =
    left === null || left === undefined
      ? left
      : { runId: left.runId, dimensions: comparisonDimensions(left) };
  const rightRecord =
    right === null || right === undefined
      ? right
      : { runId: right.runId, dimensions: comparisonDimensions(right) };
  return comparabilityRequiresAllDimensions(leftRecord, rightRecord);
}
