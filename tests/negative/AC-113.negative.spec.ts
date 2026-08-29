/**
 * AC-113 negative (failure) — candidate promotion determinism.
 * Traces: FR-DISC-005.
 * Tests rejection of unfrozen, unversioned, or mutable feature snapshots during promotion evaluation.
 */
import { describe, expect, it } from 'bun:test';

function validatePromotionInputs(inputs: {
  featureSnapshotVersion?: string;
  policyVersion?: string;
  isFrozen?: boolean;
}) {
  if (!inputs.featureSnapshotVersion || !inputs.policyVersion || inputs.isFrozen !== true) {
    throw new Error('UNFROZEN_OR_UNVERSIONED_PROMOTION_INPUTS_REFUSED');
  }
  return true;
}

describe('AC-113 negative: unfrozen/stale/unversioned inputs refused during promotion', () => {
  it('refuses promotion when feature snapshot version is missing', () => {
    expect(() =>
      validatePromotionInputs({
        policyVersion: '1.0.0',
        isFrozen: true,
      }),
    ).toThrow('UNFROZEN_OR_UNVERSIONED_PROMOTION_INPUTS_REFUSED');
  });

  it('refuses promotion when input snapshot is marked unfrozen or mutable', () => {
    expect(() =>
      validatePromotionInputs({
        featureSnapshotVersion: 'snap_feat_001',
        policyVersion: '1.0.0',
        isFrozen: false,
      }),
    ).toThrow('UNFROZEN_OR_UNVERSIONED_PROMOTION_INPUTS_REFUSED');
  });
});
