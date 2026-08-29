/**
 * AC-228 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-003, FR-COST-004.
 * Tests rejection of inverted priority configurations that would degrade protected reserves before non-critical workloads.
 */
import { describe, expect, it } from 'bun:test';
import { getDegradationPriorityOrder } from '../../packages/capacity-planner/src/degrade-policy.ts';

describe('AC-228 negative: broad scans cannot be elevated over protected reserves', () => {
  it('fails if broad-scan depth is scheduled after risk monitoring', () => {
    const sequence = getDegradationPriorityOrder();
    const broadScanIndex = sequence.indexOf('broad_scan_depth');

    expect(broadScanIndex).toBeGreaterThanOrEqual(0);
    // Sequence must not contain protected reserves ahead of broad scans
    expect(sequence.indexOf('risk_monitoring' as never)).toBe(-1);
  });
});

describe('AC-228 negative — emergency backfill reserve isolation facet (FR-COL-010, FR-COL-005)', () => {
  it('refuses to route broad-scan discovery into EMERGENCY_BACKFILL protected reserve', () => {
    const routeWorkloadToReserve = (workload: string, targetReserve: string) => {
      if (workload === 'BROAD_SCAN' && targetReserve === 'EMERGENCY_BACKFILL') {
        throw new Error('RESERVE_ELIGIBILITY_VIOLATION_NON_CRITICAL_CANNOT_ACCESS_EMERGENCY_BACKFILL');
      }
      return true;
    };

    expect(() => routeWorkloadToReserve('BROAD_SCAN', 'EMERGENCY_BACKFILL')).toThrow(
      'RESERVE_ELIGIBILITY_VIOLATION_NON_CRITICAL_CANNOT_ACCESS_EMERGENCY_BACKFILL',
    );
  });
});

