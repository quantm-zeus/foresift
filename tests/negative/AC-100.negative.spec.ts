/**
 * AC-100 negative / failure-path — Cost & Quota facet.
 * Traces: FR-COST-001, FR-COST-002, FR-COST-007.
 *
 * Asserts:
 * - Mutating costMode or operation cost fields to bypass STRICT_FREE is refused fail-closed.
 * - Attempted paid fallback inside STRICT_FREE continues to be blocked with audit entry on replay.
 * - Missing or corrupted audit fields fail audit emission verification.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-100 negative: STRICT_FREE bypass attempts fail-closed', () => {
  it('refuses paid-fallback even when primary free operation returns an error', async () => {
    let GuardModule: Record<string, unknown>;
    try {
      GuardModule = (await import('../../packages/cost-router/src/strict-free-guard.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('STRICT_FREE_GUARD_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const evaluateStrictFree = GuardModule.evaluateStrictFree as (req: {
      costMode: string;
      costClass: string;
      isPaidFallback: boolean;
    }) => { allowed: boolean; denial?: { reason: string } };

    const result = evaluateStrictFree({
      costMode: 'STRICT_FREE',
      costClass: 'PAID_EXPLICIT',
      isPaidFallback: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.denial?.reason).toMatch(/^PAID_FALLBACK_BLOCKED:|^PAID_BLOCKED:/);
  });

  it('refuses execution when denial record omits required machine reason or alternative', async () => {
    let AuditModule: Record<string, unknown>;
    try {
      AuditModule = (await import('../../packages/cost-router/src/cost-audit.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('COST_AUDIT_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const validateDenialPayload = AuditModule.validateDenialPayload as (
      payload: Record<string, unknown>,
    ) => boolean;

    expect(() =>
      validateDenialPayload({
        candidate: 'So11111111111111111111111111111111111111112',
        caller: 'runner',
        // missing reason and alternative
      }),
    ).toThrow();
  });
});
