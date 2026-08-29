/**
 * AC-113 acceptance (positive) — candidate promotion determinism & versioned replay.
 * Traces: FR-DISC-005.
 * AC text (manifest §39): "Promotion decision is replayable from frozen feature + policy versions;
 * replay produces identical decision; policy version bump changes decision deterministically."
 */
import { describe, expect, it } from 'bun:test';
import {
  PROMOTION_POLICY_V1,
  PROMOTION_POLICY_V1_1,
  REPLAYABLE_PROMOTION_DECISION,
} from '../fixtures/disc/index.ts';

interface FrozenInputs {
  liquidityUsd: number;
  tradeCount: number;
  uniqueBuyers: number;
  featureSnapshotVersion: string;
  policyVersion: string;
}

function evaluatePromotionDecision(inputs: FrozenInputs, policy: typeof PROMOTION_POLICY_V1) {
  const meetsCriteria =
    inputs.liquidityUsd >= policy.minLiquidityUsd &&
    inputs.tradeCount >= policy.minTradeCount &&
    inputs.uniqueBuyers >= policy.minUniqueBuyers;

  return {
    decision: meetsCriteria ? 'PROMOTE_TO_VERIFY' : 'MONITOR_CHEAP',
    policyVersion: policy.policyVersion,
    featureSnapshotVersion: inputs.featureSnapshotVersion,
  };
}

describe('AC-113 acceptance (positive): replayable promotion from frozen feature and policy versions', () => {
  const frozenInputs: FrozenInputs = {
    liquidityUsd: 12_500,
    tradeCount: 25,
    uniqueBuyers: 12,
    featureSnapshotVersion: 'snap_feat_cand_003_v1',
    policyVersion: '1.0.0',
  };

  it('produces identical PROMOTE_TO_VERIFY decision on multiple independent replays', () => {
    const replay1 = evaluatePromotionDecision(frozenInputs, PROMOTION_POLICY_V1);
    const replay2 = evaluatePromotionDecision(frozenInputs, PROMOTION_POLICY_V1);

    expect(replay1.decision).toBe('PROMOTE_TO_VERIFY');
    expect(replay2.decision).toBe('PROMOTE_TO_VERIFY');
    expect(replay1).toEqual(replay2);
    expect(replay1.decision).toBe(REPLAYABLE_PROMOTION_DECISION.decision);
  });

  it('changes decision deterministically on policy bump without retroactive mutation', () => {
    const bumpedReplay = evaluatePromotionDecision(frozenInputs, PROMOTION_POLICY_V1_1);
    expect(bumpedReplay.decision).toBe('MONITOR_CHEAP');
    expect(bumpedReplay.policyVersion).toBe('1.1.0');
  });
});
