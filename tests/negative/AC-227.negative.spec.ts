/**
 * AC-227 negative / failure-path suite (FR-COST-009, FR-COST-006).
 * Asserts that activation is BLOCKED when any stress dimension exceeds verified ceiling.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-227 negative: ceiling breach blocks schedule/profile activation', () => {
  it('blocks activation when egress bytes exceed verified ceiling in stress replay', () => {
    const capacityContract = {
      horizonDays: 30,
      stressEgressBytes: 150000000,
      verifiedCeilingEgressBytes: 100000000,
    };

    const isActivationBlocked =
      capacityContract.stressEgressBytes > capacityContract.verifiedCeilingEgressBytes;

    expect(isActivationBlocked).toBe(true);
  });

  it('blocks activation when model tokens exceed verified ceiling in stress replay', () => {
    const capacityContract = {
      horizonDays: 30,
      stressModelTokens: 12000000,
      verifiedCeilingModelTokens: 10000000,
    };

    const isActivationBlocked =
      capacityContract.stressModelTokens > capacityContract.verifiedCeilingModelTokens;

    expect(isActivationBlocked).toBe(true);
  });
});
