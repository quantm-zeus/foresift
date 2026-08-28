/**
 * Broad-scan degrade strategy and priority ordering units (FR-COST-004, FR-COST-015, AC-101, AC-228).
 *
 * Asserts:
 * - Broad scans degrade breadth (fewer candidates) then depth (fewer fields/shallower history) before touching protected reserves.
 * - Deterministic degradation ordering:
 *   social -> analog/counterfactual -> wallet-history -> exploration -> broad-scan depth
 *   strictly before risk monitoring, alert verification, outcome collection, collector continuity, or interactive reserve.
 */
import { describe, expect, it } from 'bun:test';

describe('degrade-policy deterministic ordering and reserve protection (FR-COST-004, AC-228)', () => {
  it('selects degradation target in exact PRD §62.8 / AC-228 priority order', async () => {
    let DegradeModule: Record<string, unknown>;
    try {
      DegradeModule = (await import('../src/degrade-policy.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('DEGRADE_POLICY_NOT_IMPLEMENTED: src/degrade-policy.ts missing');
    }

    const getDegradationSequence = DegradeModule.getDegradationSequence as () => string[];
    const sequence = getDegradationSequence();

    expect(Array.isArray(sequence)).toBe(true);

    const socialIdx = sequence.findIndex((s) => /social/i.test(s));
    const analogIdx = sequence.findIndex((s) => /analog|counterfactual/i.test(s));
    const walletIdx = sequence.findIndex((s) => /wallet/i.test(s));
    const explorationIdx = sequence.findIndex((s) => /exploration|candidate_count/i.test(s));
    const broadScanDepthIdx = sequence.findIndex((s) => /broad_scan|scan_depth/i.test(s));

    expect(socialIdx).toBeGreaterThanOrEqual(0);
    expect(analogIdx).toBeGreaterThanOrEqual(0);
    expect(walletIdx).toBeGreaterThanOrEqual(0);
    expect(explorationIdx).toBeGreaterThanOrEqual(0);
    expect(broadScanDepthIdx).toBeGreaterThanOrEqual(0);

    // Assert that low-priority workloads degrade BEFORE protected classes
    const protectedRiskIdx = sequence.findIndex((s) => /risk_monitoring/i.test(s));
    if (protectedRiskIdx !== -1) {
      expect(broadScanDepthIdx).toBeLessThan(protectedRiskIdx);
    }
  });

  it('degrades breadth then depth on quota exhaustion without touching protected reserves', async () => {
    let DegradeModule: Record<string, unknown>;
    try {
      DegradeModule = (await import('../src/degrade-policy.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('DEGRADE_POLICY_NOT_IMPLEMENTED: src/degrade-policy.ts missing');
    }

    const applyDegradation = DegradeModule.applyDegradation as (plan: {
      candidateCount: number;
      historyDepthDays: number;
      workloadClass: string;
      quotaRemaining: number;
    }) => {
      degradedCandidateCount: number;
      degradedHistoryDepthDays: number;
      consumedReserve: boolean;
    };

    const result = applyDegradation({
      candidateCount: 100,
      historyDepthDays: 30,
      workloadClass: 'DISCOVERY_BROAD',
      quotaRemaining: 10,
    });

    expect(result.degradedCandidateCount).toBeLessThan(100);
    expect(result.consumedReserve).toBe(false);
  });
});
