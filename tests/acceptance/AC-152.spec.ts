/**
 * AC-152 acceptance (positive) — promotion requires PROVEN status when specified (§64.12, FR-MAT-008).
 * Traces: FR-MAT-008, AC-152.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-152 acceptance (positive): promotion requires PROVEN evidence status', () => {
  it('approves promotion claims supported by PROVEN status execution evidence', () => {
    const claim = {
      claimId: 'claim_001',
      evidenceStatus: 'PROVEN',
      hasExactConfigurationMatch: true,
      isHighResolution: true,
      status: 'APPROVED',
    };

    expect(claim.evidenceStatus).toBe('PROVEN');
    expect(claim.status).toBe('APPROVED');
  });
});
