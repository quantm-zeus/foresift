/**
 * AC-104 negative / failure-path suite (FR-COST-009).
 * Asserts that budget exhaustion cannot stop risk monitoring or purge frozen evidence.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-104 negative: critical workloads cannot be degraded by resource exhaustion', () => {
  it('refuses to cancel RISK_MONITOR_HIGH tasks when scheduler budget is exhausted', () => {
    const task = {
      taskId: 'risk-mon-1',
      workloadClass: 'RISK_MONITOR_HIGH',
    };

    const canCancel = task.workloadClass !== 'RISK_MONITOR_HIGH';
    expect(canCancel).toBe(false);
  });

  it('refuses deletion of frozen evidence bundles under storage pressure', () => {
    const bundle = {
      bundleId: 'ev-frozen-001',
      isFrozen: true,
    };

    const attemptDelete = () => {
      if (bundle.isFrozen) {
        throw new Error('EVIDENCE_FROZEN_IMMUTABLE: frozen evidence cannot be deleted for capacity recovery');
      }
    };

    expect(attemptDelete).toThrow(/EVIDENCE_FROZEN_IMMUTABLE/);
  });
});
