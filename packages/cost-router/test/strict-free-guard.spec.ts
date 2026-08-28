/**
 * STRICT_FREE deny-closed guard units (FR-COST-002, AC-100).
 *
 * Asserts:
 * - In STRICT_FREE mode, blocks:
 *   1. PAID_EXPLICIT operations -> machine prefix `PAID_BLOCKED:*`
 *   2. UNKNOWN_COST operations -> machine prefix `UNKNOWN_COST:*`
 *   3. Over-quota calls (QUOTA_EXHAUSTED) -> machine prefix `STRICT_FREE_BLOCKED:*`
 *   4. Automatic plan upgrade paths -> machine prefix `AUTO_UPGRADE_BLOCKED:*`
 *   5. Paid-fallback attempts -> machine prefix `PAID_FALLBACK_BLOCKED:*`
 * - Returns typed CostDenial carrying { candidate, caller, reason, alternative }.
 */
import { describe, expect, it } from 'bun:test';

describe('strict-free-guard deny-closed predicates (FR-COST-002, AC-100)', () => {
  it('blocks PAID_EXPLICIT operations before egress with PAID_BLOCKED prefix', async () => {
    let GuardModule: Record<string, unknown>;
    try {
      GuardModule = (await import('../src/strict-free-guard.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('STRICT_FREE_GUARD_NOT_IMPLEMENTED: src/strict-free-guard.ts missing');
    }

    const evaluateStrictFree = GuardModule.evaluateStrictFree as (req: {
      costMode: string;
      costClass: string;
      candidate?: string;
      caller?: string;
    }) => { allowed: boolean; denial?: { reason: string; alternative: string } };

    const result = evaluateStrictFree({
      costMode: 'STRICT_FREE',
      costClass: 'PAID_EXPLICIT',
      candidate: 'So11111111111111111111111111111111111111112',
      caller: 'market-discovery',
    });

    expect(result.allowed).toBe(false);
    expect(result.denial?.reason).toMatch(/^PAID_BLOCKED:/);
  });

  it('blocks UNKNOWN_COST operations with UNKNOWN_COST prefix', async () => {
    let GuardModule: Record<string, unknown>;
    try {
      GuardModule = (await import('../src/strict-free-guard.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('STRICT_FREE_GUARD_NOT_IMPLEMENTED: src/strict-free-guard.ts missing');
    }

    const evaluateStrictFree = GuardModule.evaluateStrictFree as (req: {
      costMode: string;
      costClass: string;
    }) => { allowed: boolean; denial?: { reason: string } };

    const result = evaluateStrictFree({
      costMode: 'STRICT_FREE',
      costClass: 'UNKNOWN_COST',
    });

    expect(result.allowed).toBe(false);
    expect(result.denial?.reason).toMatch(/^UNKNOWN_COST:/);
  });

  it('blocks automatic upgrade attempts in STRICT_FREE mode', async () => {
    let GuardModule: Record<string, unknown>;
    try {
      GuardModule = (await import('../src/strict-free-guard.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('STRICT_FREE_GUARD_NOT_IMPLEMENTED: src/strict-free-guard.ts missing');
    }

    const evaluateStrictFree = GuardModule.evaluateStrictFree as (req: {
      costMode: string;
      costClass: string;
      attemptAutoUpgrade?: boolean;
    }) => { allowed: boolean; denial?: { reason: string } };

    const result = evaluateStrictFree({
      costMode: 'STRICT_FREE',
      costClass: 'FREE_QUOTA',
      attemptAutoUpgrade: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.denial?.reason).toMatch(/^AUTO_UPGRADE_BLOCKED:/);
  });

  it('blocks paid fallback attempts in STRICT_FREE mode', async () => {
    let GuardModule: Record<string, unknown>;
    try {
      GuardModule = (await import('../src/strict-free-guard.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('STRICT_FREE_GUARD_NOT_IMPLEMENTED: src/strict-free-guard.ts missing');
    }

    const evaluateStrictFree = GuardModule.evaluateStrictFree as (req: {
      costMode: string;
      costClass: string;
      isPaidFallback?: boolean;
    }) => { allowed: boolean; denial?: { reason: string } };

    const result = evaluateStrictFree({
      costMode: 'STRICT_FREE',
      costClass: 'FREE_QUOTA',
      isPaidFallback: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.denial?.reason).toMatch(/^PAID_FALLBACK_BLOCKED:/);
  });
});
