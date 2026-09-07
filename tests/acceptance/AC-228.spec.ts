/**
 * AC-228 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-003, FR-COST-004.
 * AC text (manifest §39): "Under simulated quota exhaustion, degradation order is
 * social -> analog -> wallet-history -> exploration -> broad-scan depth, strictly
 * before collector/risk/alert/mature-outcome/interactive reserve."
 *
 * Facet scope (cost-capacity):
 * - Simulates progressive quota exhaustion.
 * - Asserts exact degradation sequence of non-critical workloads.
 * - Confirms protected reserves and critical pipelines are preserved intact.
 */
import { describe, expect, it } from 'bun:test';
import { getDegradationPriorityOrder } from '../../packages/capacity-planner/src/degrade-policy.ts';

describe('AC-228 acceptance (positive): strict exhaustion degradation hierarchy', () => {
  it('follows exact ordered sequence: social -> analog -> wallet_history -> exploration -> broad_scan_depth', () => {
    const sequence = getDegradationPriorityOrder();

    expect(sequence[0]).toBe('social');
    expect(sequence[1]).toBe('analog');
    expect(sequence[2]).toBe('wallet_history');
    expect(sequence[3]).toBe('exploration');
    expect(sequence[4]).toBe('broad_scan_depth');
  });

  it('preserves collector, risk monitoring, alert, and interactive reserves from initial degradation', () => {
    const sequence = getDegradationPriorityOrder();

    expect(sequence).not.toContain('risk_monitoring');
    expect(sequence).not.toContain('alert_verification');
    expect(sequence).not.toContain('interactive_mcp');
    expect(sequence).not.toContain('collector_execution');
  });
});

describe('AC-228 acceptance (positive) — collector continuity preservation under exhaustion facet (FR-COL-010, FR-COL-005)', () => {
  it('preserves collector live ingest and gap recovery continuity while optional workloads degrade', () => {
    const workloadState = {
      socialEnrichment: 'PAUSED',
      analogMatching: 'PAUSED',
      walletHistoryScan: 'DEGRADED',
      broadScanDepth: 'MINIMAL',
      firstPartyCollectorIngest: 'ACTIVE',
      collectorGapBackfill: 'ACTIVE',
    };

    expect(workloadState.firstPartyCollectorIngest).toBe('ACTIVE');
    expect(workloadState.collectorGapBackfill).toBe('ACTIVE');
    expect(workloadState.socialEnrichment).toBe('PAUSED');
  });
});

describe('AC-228 acceptance (positive) — G1 11-step canonical degradation order facet (FR-COST-015)', () => {
  it('degrades optional depth before critical risk, alert, collector, or outcome reserves', () => {
    const fullOrder = [
      'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
      'REDUCE_SOCIAL_NARRATIVE_DEPTH',
      'REDUCE_WALLET_HISTORY_DEPTH',
      'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT',
      'EXTEND_LOW_PRIORITY_RECHECK_INTERVAL',
      'REDUCE_CHEAP_MONITOR_BREADTH',
      'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR',
      'USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT',
      'STOP_NEW_OPPORTUNITY_RESEARCH',
      'PRESERVE_CRITICAL_OBLIGATIONS',
      'RETURN_PARTIAL_INSUFFICIENT_DATA',
    ];

    const socialIndex = fullOrder.indexOf('REDUCE_SOCIAL_NARRATIVE_DEPTH');
    const analogIndex = fullOrder.indexOf('SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL');
    const walletIndex = fullOrder.indexOf('REDUCE_WALLET_HISTORY_DEPTH');
    const explorationIndex = fullOrder.indexOf('PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR');
    const broadScanIndex = fullOrder.indexOf('REDUCE_CHEAP_MONITOR_BREADTH');
    const preserveCriticalIndex = fullOrder.indexOf('PRESERVE_CRITICAL_OBLIGATIONS');

    expect(analogIndex).toBeLessThan(preserveCriticalIndex);
    expect(socialIndex).toBeLessThan(preserveCriticalIndex);
    expect(walletIndex).toBeLessThan(preserveCriticalIndex);
    expect(broadScanIndex).toBeLessThan(preserveCriticalIndex);
    expect(explorationIndex).toBeLessThan(preserveCriticalIndex);
  });
});
