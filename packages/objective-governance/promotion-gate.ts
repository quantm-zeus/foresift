/** Normative nine-stage objective promotion gate (FR-OBJ-001…009). */
import { PromotionVerdict } from '@foresift/domain';

export const PromotionGateStage = {
  HARD_CONSTRAINTS: 'HARD_CONSTRAINTS',
  COMPARABILITY: 'COMPARABILITY',
  MATURITY_ESS_MINIMUMS: 'MATURITY_ESS_MINIMUMS',
  NEGATIVE_CONTROLS: 'NEGATIVE_CONTROLS',
  INTEGRITY: 'INTEGRITY',
  LCB_COMPARISON: 'LCB_COMPARISON',
  ROBUST_DELAY: 'ROBUST_DELAY',
  CLAIM_SCOPE: 'CLAIM_SCOPE',
  VERDICT: 'VERDICT',
} as const;
export type PromotionGateStage = (typeof PromotionGateStage)[keyof typeof PromotionGateStage];

export interface ConsumedGateResult {
  readonly passed: boolean;
  readonly evidenceRef?: string | null;
  readonly reason?: string | null;
}

export interface ConsumedComparabilityResult extends ConsumedGateResult {
  readonly comparable: boolean;
}

export interface ConsumedLcbComparison extends ConsumedGateResult {
  /** Candidate and incumbent LCB values are integer micro-units. */
  readonly candidateLowerBoundMicros: bigint;
  readonly incumbentLowerBoundMicros: bigint;
}

/** Diagnostics are intentionally absent from this governing input type. */
export interface PromotionGateInput {
  readonly hardConstraints: ConsumedGateResult;
  readonly comparability: ConsumedComparabilityResult;
  readonly maturityEssMinimums: ConsumedGateResult;
  readonly negativeControls: ConsumedGateResult;
  readonly integrity: ConsumedGateResult;
  readonly lcbComparison: ConsumedLcbComparison;
  readonly robustDelay: ConsumedGateResult;
  readonly claimScope: ConsumedGateResult;
}

export interface PromotionGateTrailEntry {
  readonly stage: PromotionGateStage;
  readonly passed: boolean;
  readonly evidenceRef: string | null;
  readonly reason: string | null;
}

export interface PromotionGateDecision {
  readonly verdict: PromotionVerdict;
  readonly trail: readonly PromotionGateTrailEntry[];
}

function entry(
  stage: PromotionGateStage,
  result: ConsumedGateResult,
  passed = result.passed,
): PromotionGateTrailEntry {
  return Object.freeze({
    stage,
    passed,
    evidenceRef: result.evidenceRef ?? null,
    reason: passed ? null : (result.reason ?? `${stage}_FAILED`),
  });
}

/**
 * Compose already-evaluated package outputs in the fixed ADR-OBJ-03 order.
 * Evaluation stops at the first blocking stage, so utility cannot compensate
 * for an earlier hard failure. Incomparability is the sole HOLD outcome.
 */
export function evaluatePromotionGate(input: PromotionGateInput): PromotionGateDecision {
  const trail: PromotionGateTrailEntry[] = [];
  const finish = (verdict: PromotionVerdict): PromotionGateDecision => {
    trail.push(
      Object.freeze({
        stage: PromotionGateStage.VERDICT,
        passed: verdict === PromotionVerdict.PROMOTE,
        evidenceRef: null,
        reason: verdict,
      }),
    );
    return Object.freeze({ verdict, trail: Object.freeze(trail) });
  };

  const hardConstraints = entry(PromotionGateStage.HARD_CONSTRAINTS, input.hardConstraints);
  trail.push(hardConstraints);
  if (!hardConstraints.passed) return finish(PromotionVerdict.BLOCK);

  const comparable = input.comparability.passed && input.comparability.comparable;
  trail.push(entry(PromotionGateStage.COMPARABILITY, input.comparability, comparable));
  if (!comparable) return finish(PromotionVerdict.HOLD_EXPLORATORY_ONLY);

  const orderedBlockingStages: readonly [PromotionGateStage, ConsumedGateResult][] = [
    [PromotionGateStage.MATURITY_ESS_MINIMUMS, input.maturityEssMinimums],
    [PromotionGateStage.NEGATIVE_CONTROLS, input.negativeControls],
    [PromotionGateStage.INTEGRITY, input.integrity],
  ];
  for (const [stage, result] of orderedBlockingStages) {
    const evaluated = entry(stage, result);
    trail.push(evaluated);
    if (!evaluated.passed) return finish(PromotionVerdict.BLOCK);
  }

  const lcbPassed =
    input.lcbComparison.passed &&
    input.lcbComparison.candidateLowerBoundMicros > input.lcbComparison.incumbentLowerBoundMicros;
  trail.push(entry(PromotionGateStage.LCB_COMPARISON, input.lcbComparison, lcbPassed));
  if (!lcbPassed) return finish(PromotionVerdict.BLOCK);

  const trailingStages: readonly [PromotionGateStage, ConsumedGateResult][] = [
    [PromotionGateStage.ROBUST_DELAY, input.robustDelay],
    [PromotionGateStage.CLAIM_SCOPE, input.claimScope],
  ];
  for (const [stage, result] of trailingStages) {
    const evaluated = entry(stage, result);
    trail.push(evaluated);
    if (!evaluated.passed) return finish(PromotionVerdict.BLOCK);
  }
  return finish(PromotionVerdict.PROMOTE);
}

export const promotionGate = evaluatePromotionGate;
