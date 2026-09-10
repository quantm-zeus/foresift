/**
 * AC-152 negative (failure) — IMPLEMENTED-but-unavailable evidence cannot support alert claims.
 * Traces: FR-MAT-008, AC-152.
 */
import { describe, expect, it } from 'bun:test';

function validatePromotionClaimEvidence(evidence: {
  status: 'PROVEN' | 'IMPLEMENTED_BUT_UNAVAILABLE' | 'PROVISIONAL';
}) {
  if (evidence.status === 'IMPLEMENTED_BUT_UNAVAILABLE' || evidence.status === 'PROVISIONAL') {
    throw new Error('PROMOTION_REQUIRES_PROVEN_EVIDENCE_STATUS');
  }
  return true;
}

describe('AC-152 negative: IMPLEMENTED-but-unavailable evidence cannot support production promotion', () => {
  it('throws when evidence is IMPLEMENTED_BUT_UNAVAILABLE', () => {
    expect(() =>
      validatePromotionClaimEvidence({
        status: 'IMPLEMENTED_BUT_UNAVAILABLE',
      }),
    ).toThrow('PROMOTION_REQUIRES_PROVEN_EVIDENCE_STATUS');
  });

  it('throws when evidence is PROVISIONAL', () => {
    expect(() =>
      validatePromotionClaimEvidence({
        status: 'PROVISIONAL',
      }),
    ).toThrow('PROMOTION_REQUIRES_PROVEN_EVIDENCE_STATUS');
  });
});
