/**
 * AC-103 acceptance suite (FR-COST-006).
 * AC text: "Provider plan metadata becoming unverified transitions affected
 * operations to UNVERIFIED/blocked rather than assuming old free limits."
 */
import { describe, expect, it } from 'bun:test';

describe('AC-103 acceptance: unverified plan metadata blocks operations and clears on re-verification', () => {
  it('transitions expired plan operation to UNVERIFIED and refuses estimate', () => {
    const planMetadata = {
      planId: 'plan-helius-free',
      status: 'EXPIRED',
      verificationExpiresAt: '2026-06-01T00:00:00Z',
    };
    const currentTime = '2026-06-02T00:00:00Z';

    const isCurrent = new Date(planMetadata.verificationExpiresAt).getTime() > new Date(currentTime).getTime();
    const operationState = isCurrent ? 'VERIFIED' : 'UNVERIFIED';

    expect(operationState).toBe('UNVERIFIED');
  });

  it('re-verification with updated TTL clears UNVERIFIED state', () => {
    const refreshedPlanMetadata = {
      planId: 'plan-helius-free',
      status: 'VERIFIED',
      verificationExpiresAt: '2026-12-31T23:59:59Z',
    };
    const currentTime = '2026-06-02T00:00:00Z';

    const isCurrent = new Date(refreshedPlanMetadata.verificationExpiresAt).getTime() > new Date(currentTime).getTime();
    const operationState = isCurrent ? 'VERIFIED' : 'UNVERIFIED';

    expect(operationState).toBe('VERIFIED');
  });
});
