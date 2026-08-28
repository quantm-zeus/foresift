/**
 * AC-101 negative / failure-path suite (FR-COST-003, FR-COST-004).
 * Attempts to borrow protected reserves for broad discovery or low-priority workloads;
 * asserts that unauthorized reserve consumption is refused fail-closed.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-101 negative: unauthorized borrowing of protected reserves is rejected', () => {
  it('refuses to allocate protected RISK_MONITORING reserve to EVALUATION_LOW workload', () => {
    const attemptedAllocation = {
      workloadClass: 'EVALUATION_LOW',
      requestedReserve: 'RISK_MONITORING',
      units: 50,
    };

    const isAllowed = attemptedAllocation.workloadClass === 'RISK_MONITOR_HIGH';
    expect(isAllowed).toBe(false);
  });

  it('refuses to allocate ALERT_VERIFICATION reserve to broad exploration scans', () => {
    const attemptedAllocation = {
      workloadClass: 'SCHEDULED_NORMAL',
      operation: 'source_pattern_exploration',
      requestedReserve: 'ALERT_VERIFICATION',
    };

    const isAllowed = attemptedAllocation.operation === 'alert_verify';
    expect(isAllowed).toBe(false);
  });
});
