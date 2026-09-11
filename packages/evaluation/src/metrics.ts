/** Deterministic evaluation metrics over disclosed matured denominators (FR-EVAL-003). */
import { ErrorCode, EvalError, MaturityState } from '@foresift/domain';
import {
  assertCompleteDenominatorDisclosure,
  type DenominatorDisclosureReport,
} from '@foresift/outcome-maturity';

export interface MetricCandidate {
  readonly candidateId: string;
  readonly rank: number;
  readonly predictedPositive: boolean;
  readonly eligibleGem: boolean;
  readonly successful: boolean;
  readonly maturityState: MaturityState;
  readonly actionableLeadTimeMs?: number;
  readonly mfe?: number;
  readonly mae?: number;
  readonly targetDurationMs?: number;
  readonly liquiditySurvived?: boolean;
  readonly securitySurvived?: boolean;
  readonly tradableSuccess?: boolean;
  readonly signalSuccess?: boolean;
  readonly filled?: boolean;
  readonly exited?: boolean;
  readonly partialFill?: boolean;
  readonly executableTargetFalsePositive?: boolean;
  readonly netReturn?: number;
  readonly capitalDeployed?: number;
  readonly capitalCapacity?: number;
}

export interface EvaluationCostLedger {
  readonly researchedCost: number;
  readonly usefulCost: number;
}

export interface MetricSuiteInput {
  readonly candidates: readonly MetricCandidate[];
  readonly k: number;
  readonly final: boolean;
  readonly denominatorDisclosure: DenominatorDisclosureReport;
  readonly populationClaim: string;
  readonly costLedger: EvaluationCostLedger;
  readonly cvarAlpha?: number;
}

export interface MetricSuiteResult {
  readonly values: Readonly<Record<string, number | null>>;
  readonly final: boolean;
  readonly denominatorDisclosureRef: string;
  readonly populationClaim: string;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function maximumDrawdown(returns: readonly number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

function conditionalValueAtRisk(returns: readonly number[], alpha: number): number | null {
  if (returns.length === 0) return null;
  const ordered = [...returns].sort((left, right) => left - right);
  const count = Math.max(1, Math.ceil(ordered.length * alpha));
  return average(ordered.slice(0, count));
}

function ndcgAtK(candidates: readonly MetricCandidate[], k: number): number | null {
  const top = [...candidates].sort((a, b) => a.rank - b.rank).slice(0, k);
  const dcg = top.reduce(
    (sum, item, index) => sum + (item.eligibleGem ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const relevant = Math.min(k, candidates.filter((item) => item.eligibleGem).length);
  const ideal = Array.from({ length: relevant }, (_, index) => 1 / Math.log2(index + 2)).reduce(
    (sum, value) => sum + value,
    0,
  );
  return ideal === 0 ? null : dcg / ideal;
}

/** Compute the §31.6 suite. FINAL mode admits only fully matured valid cases. */
export function computeMetricSuite(input: MetricSuiteInput): MetricSuiteResult {
  if (!Number.isInteger(input.k) || input.k <= 0 || !input.populationClaim)
    throw new EvalError(
      'invalid metric scope',
      { k: input.k },
      ErrorCode.EVAL_POPULATION_CLAIM_UNSUPPORTED,
    );
  assertCompleteDenominatorDisclosure(input.denominatorDisclosure);
  if (
    input.final &&
    input.candidates.some((candidate) => candidate.maturityState !== MaturityState.FULLY_MATURED)
  )
    throw new EvalError(
      'FINAL metrics require fully matured valid outcomes',
      {},
      ErrorCode.EVAL_POPULATION_CLAIM_UNSUPPORTED,
    );
  const ordered = [...input.candidates].sort((a, b) => a.rank - b.rank);
  const top = ordered.slice(0, input.k);
  const predicted = input.candidates.filter((candidate) => candidate.predictedPositive);
  const truePositives = predicted.filter((candidate) => candidate.successful).length;
  const positives = input.candidates.filter((candidate) => candidate.eligibleGem).length;
  const successes = input.candidates.filter((candidate) => candidate.successful);
  const tradable = input.candidates.filter((candidate) => candidate.tradableSuccess === true);
  const signal = input.candidates.filter((candidate) => candidate.signalSuccess === true);
  const returns = ordered.flatMap((candidate) =>
    candidate.netReturn === undefined ? [] : [candidate.netReturn],
  );
  const totalCapital = input.candidates.reduce(
    (sum, candidate) => sum + (candidate.capitalCapacity ?? 0),
    0,
  );
  const deployed = input.candidates.reduce(
    (sum, candidate) => sum + (candidate.capitalDeployed ?? 0),
    0,
  );
  const cvarAlpha = input.cvarAlpha ?? 0.05;
  const values: Record<string, number | null> = {
    PRECISION_AT_K: ratio(top.filter((candidate) => candidate.successful).length, top.length),
    RECALL_AT_ELIGIBLE_GEMS: ratio(successes.length, positives),
    NDCG_AT_K: ndcgAtK(input.candidates, input.k),
    FALSE_DISCOVERY_RATE: predicted.length === 0 ? null : 1 - truePositives / predicted.length,
    FALSE_REJECTION_RATE: ratio(
      input.candidates.filter((candidate) => !candidate.predictedPositive && candidate.eligibleGem)
        .length,
      positives,
    ),
    MEDIAN_SUCCESSFUL_ASSET_RANK: median(successes.map((candidate) => candidate.rank)),
    MEDIAN_ACTIONABLE_LEAD_TIME: median(
      input.candidates.flatMap((candidate) =>
        candidate.actionableLeadTimeMs === undefined ? [] : [candidate.actionableLeadTimeMs],
      ),
    ),
    MFE: average(
      input.candidates.flatMap((candidate) => (candidate.mfe === undefined ? [] : [candidate.mfe])),
    ),
    MAE: average(
      input.candidates.flatMap((candidate) => (candidate.mae === undefined ? [] : [candidate.mae])),
    ),
    TARGET_DURATION: average(
      input.candidates.flatMap((candidate) =>
        candidate.targetDurationMs === undefined ? [] : [candidate.targetDurationMs],
      ),
    ),
    LIQUIDITY_SURVIVAL: ratio(
      input.candidates.filter((candidate) => candidate.liquiditySurvived).length,
      input.candidates.filter((candidate) => candidate.liquiditySurvived !== undefined).length,
    ),
    SECURITY_SURVIVAL: ratio(
      input.candidates.filter((candidate) => candidate.securitySurvived).length,
      input.candidates.filter((candidate) => candidate.securitySurvived !== undefined).length,
    ),
    TRADABLE_SUCCESS_BY_NOTIONAL: ratio(tradable.length, input.candidates.length),
    FILL_EXIT_SURVIVAL: ratio(
      input.candidates.filter((candidate) => candidate.filled && candidate.exited).length,
      input.candidates.filter((candidate) => candidate.filled !== undefined).length,
    ),
    PARTIAL_FILL_RATE: ratio(
      input.candidates.filter((candidate) => candidate.partialFill).length,
      input.candidates.filter((candidate) => candidate.partialFill !== undefined).length,
    ),
    SIGNAL_TO_TRADABLE_DIVERGENCE: ratio(
      signal.filter((candidate) => candidate.tradableSuccess !== true).length,
      signal.length,
    ),
    OUTCOME_MATURITY_RATE: ratio(
      input.denominatorDisclosure.fullyMaturedValidCount,
      input.denominatorDisclosure.eligibleCount,
    ),
    OUTCOME_CENSORING_RATE: ratio(
      input.denominatorDisclosure.counts.CENSORED,
      input.denominatorDisclosure.eligibleCount,
    ),
    OUTCOME_INVALID_DATA_RATE: ratio(
      input.denominatorDisclosure.counts.INVALID_DATA,
      input.denominatorDisclosure.eligibleCount,
    ),
    EXECUTABLE_TARGET_FALSE_POSITIVE_RATE: ratio(
      input.candidates.filter((candidate) => candidate.executableTargetFalsePositive).length,
      input.candidates.length,
    ),
    COST_PER_RESEARCHED_CANDIDATE: ratio(input.costLedger.researchedCost, input.candidates.length),
    COST_PER_USEFUL_CANDIDATE: ratio(input.costLedger.usefulCost, successes.length),
    EXPECTANCY: average(returns),
    DRAWDOWN: maximumDrawdown(returns),
    CVAR: conditionalValueAtRisk(returns, cvarAlpha),
    CAPITAL_UTILIZATION: ratio(deployed, totalCapital),
  };
  return Object.freeze({
    values: Object.freeze(values),
    final: input.final,
    denominatorDisclosureRef: input.denominatorDisclosure.disclosureRef,
    populationClaim: input.populationClaim,
  });
}
