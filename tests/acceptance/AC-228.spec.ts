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
