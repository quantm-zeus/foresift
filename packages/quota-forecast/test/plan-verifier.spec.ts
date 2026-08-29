/**
 * Plan verifier unit tests (FR-COST-006, AC-103).
 * Verifies plan freshness check, determinism 1-second before and after expiry,
 * fail-closed UNVERIFIED transition on expired TTL, and clearing on re-verification.
 */
import { describe, expect, it } from 'bun:test';
import { isPlanMetadataVerified, verifyPlanFreshness } from '../src/plan-verifier.ts';
import {
  EXPIRED_FORECAST_SNAPSHOT,
  VERIFIED_FORECAST_SNAPSHOT,
} from '../../../tests/fixtures/cost/plans.ts';

describe('plan-verifier', () => {
  const tExpiry = new Date('2026-08-01T12:00:00Z');

  it('evaluates exactly 1 second before expiry as verified (fresh)', () => {
    const tBefore = new Date(tExpiry.getTime() - 1000).toISOString();
    const verified = isPlanMetadataVerified(tExpiry.toISOString(), tBefore);
    expect(verified).toBe(true);
  });

  it('evaluates exactly at expiry as expired (fail-closed boundary)', () => {
    const verified = isPlanMetadataVerified(tExpiry.toISOString(), tExpiry.toISOString());
    expect(verified).toBe(false);
  });

  it('evaluates exactly 1 second after expiry as unverified (stale)', () => {
    const tAfter = new Date(tExpiry.getTime() + 1000).toISOString();
    const verified = isPlanMetadataVerified(tExpiry.toISOString(), tAfter);
    expect(verified).toBe(false);
  });

  it('verifyPlanFreshness passes for valid unexpired forecast snapshot', () => {
    const result = verifyPlanFreshness(VERIFIED_FORECAST_SNAPSHOT, '2026-08-15T00:00:00Z');
    expect(result.verified).toBe(true);
    expect(result.status).toBe('VERIFIED');
  });

  it('verifyPlanFreshness refuses expired snapshot with UNVERIFIED status', () => {
    const result = verifyPlanFreshness(EXPIRED_FORECAST_SNAPSHOT, '2026-08-15T00:00:00Z');
    expect(result.verified).toBe(false);
    expect(result.status).toBe('UNVERIFIED');
  });

  it('re-verification with updated TTL clears UNVERIFIED state', () => {
    const updatedSnapshot = {
      ...EXPIRED_FORECAST_SNAPSHOT,
      expiresAt: '2027-01-01T00:00:00Z' as const,
    };
    const result = verifyPlanFreshness(updatedSnapshot, '2026-08-15T00:00:00Z');
    expect(result.verified).toBe(true);
    expect(result.status).toBe('VERIFIED');
  });
});
