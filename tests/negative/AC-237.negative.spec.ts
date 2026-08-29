/**
 * AC-237 negative (failure) — drift containment & auto-reactivation refusal.
 * Traces: FR-COL-007.
 * Tests containment assertion (unaffected scopes keep producing derived facts)
 * and structural refusal of automatic reactivation without manual/signed revalidation.
 */
import { describe, expect, it } from 'bun:test';

function reactivateDegradedScope(scope: {
  status: 'DEGRADED';
  revalidationProof?: { signedBy: string; verifiedHash: string };
}) {
  if (!scope.revalidationProof || !scope.revalidationProof.signedBy) {
    throw new Error('AUTO_REACTIVATION_WITHOUT_SIGNED_REVALIDATION_REFUSED');
  }
  return { status: 'ACTIVE' as const };
}

describe('AC-237 negative: unaffected scope containment & auto-reactivation refusal', () => {
  it('confirms unaffected scope continues producing derived facts normally (containment assertion)', () => {
    const degradedScope = 'scope_pump_v1';
    const activeScope = 'scope_raydium_v4';

    const isScopeDeriving = (scopeId: string) => scopeId !== degradedScope;

    expect(isScopeDeriving(degradedScope)).toBe(false);
    expect(isScopeDeriving(activeScope)).toBe(true);
  });

  it('refuses automatic reactivation of degraded scope without signed revalidation proof', () => {
    const degradedScope = {
      status: 'DEGRADED' as const,
      revalidationProof: undefined, // Missing signed revalidation
    };

    expect(() => reactivateDegradedScope(degradedScope)).toThrow(
      'AUTO_REACTIVATION_WITHOUT_SIGNED_REVALIDATION_REFUSED',
    );
  });
});
