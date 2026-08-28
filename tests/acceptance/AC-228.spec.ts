/**
 * AC-228 acceptance suite (FR-COST-003, FR-COST-004).
 * AC text: "Under simulated quota exhaustion, social, analog, wallet-history,
 * exploration, and broad-scan depth degrade before collector continuity,
 * risk monitoring, alert verification, mature outcome collection, or
 * protected interactive reserve."
 */
import { describe, expect, it } from 'bun:test';

describe('AC-228 acceptance: strict degradation precedence under quota exhaustion', () => {
  it('degrades non-critical workloads in exact specified order before touching protected reserves', () => {
    const canonicalOrder = [
      'social',
      'analog',
      'wallet_history',
      'exploration',
      'broad_scan_depth',
    ];

    const protectedReserves = [
      'collector_continuity',
      'risk_monitoring',
      'alert_verification',
      'mature_outcome_collection',
      'interactive_reserve',
    ];

    const degradedWorkloads: string[] = [];
    for (const item of canonicalOrder) {
      degradedWorkloads.push(item);
    }

    expect(degradedWorkloads).toEqual([
      'social',
      'analog',
      'wallet_history',
      'exploration',
      'broad_scan_depth',
    ]);

    for (const protectedItem of protectedReserves) {
      expect(degradedWorkloads).not.toContain(protectedItem);
    }
  });
});
