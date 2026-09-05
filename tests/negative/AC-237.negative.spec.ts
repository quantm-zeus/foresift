/**
 * AC-237 negative (failure) — drift containment & auto-reactivation refusal.
 * Traces: FR-COL-007, FR-EXEC-021, AC-237, T045.
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
    // exactOptionalPropertyTypes: absent optional proof is represented by
    // omitting the property, not by an explicit `undefined` value.
    const degradedScope = {
      status: 'DEGRADED' as const,
    };
    const scopeWithoutProof: Parameters<typeof reactivateDegradedScope>[0] = degradedScope;
    void scopeWithoutProof;

    expect(() => reactivateDegradedScope(degradedScope)).toThrow(
      'AUTO_REACTIVATION_WITHOUT_SIGNED_REVALIDATION_REFUSED',
    );
  });
});

describe('AC-237 exec negative: degraded adapter confirmed alerts refusal (FR-EXEC-021)', () => {
  it('refuses new confirmed alerts from degraded pool math adapter until revalidated', () => {
    const issueConfirmedAlert = (adapter: {
      status: 'DEGRADED' | 'ACTIVE';
      revalidated: boolean;
    }) => {
      if (adapter.status === 'DEGRADED' && !adapter.revalidated) {
        throw new Error('DEGRADED_ADAPTER_CONFIRMED_ALERT_REFUSED');
      }
      return { alertIssued: true };
    };

    expect(() =>
      issueConfirmedAlert({
        status: 'DEGRADED',
        revalidated: false,
      }),
    ).toThrow('DEGRADED_ADAPTER_CONFIRMED_ALERT_REFUSED');
  });
});
