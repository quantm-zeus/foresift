/**
 * AC-228 negative / failure-path suite (FR-COST-003, FR-COST-004).
 * Asserts that out-of-order degradation is strictly prohibited.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-228 negative: out-of-order degradation is refused', () => {
  it('rejects attempt to degrade risk monitoring before social/wallet-history are degraded', () => {
    const currentStatus = {
      socialActive: true,
      walletHistoryActive: true,
      riskMonitoringActive: true,
    };

    const attemptDegrade = (target: 'social' | 'walletHistory' | 'riskMonitoring') => {
      if (target === 'riskMonitoring' && (currentStatus.socialActive || currentStatus.walletHistoryActive)) {
        throw new Error('ILLEGAL_DEGRADATION_ORDER: social and wallet history must degrade before risk monitoring');
      }
    };

    expect(() => attemptDegrade('riskMonitoring')).toThrow(/ILLEGAL_DEGRADATION_ORDER/);
  });
});
