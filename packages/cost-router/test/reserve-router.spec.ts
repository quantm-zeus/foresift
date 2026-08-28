/**
 * Protected reserve routing units (FR-COST-003, FR-COST-004, AC-101, AC-228).
 *
 * Asserts:
 * - Maps (workloadClass, operation) -> reserveId | null.
 * - Protects the 4 primary named reserves:
 *   1. RISK_MONITORING
 *   2. ALERT_VERIFICATION
 *   3. INTERACTIVE_MCP
 *   4. EMERGENCY_BACKFILL
 * - Refuses broad-scan workloads (BACKFILL_LOW, EVALUATION_LOW, SCHEDULED_NORMAL) to any reserve.
 * - Enforces degrade-breadth/depth before touching protected quota.
 */
import { describe, expect, it } from 'bun:test';

describe('reserve-router protected-reserve routing (FR-COST-003, FR-COST-004, AC-101)', () => {
  it('routes high-priority risk and alert workloads to their designated reserves', async () => {
    let ReserveModule: Record<string, unknown>;
    try {
      ReserveModule = (await import('../src/reserve-router.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('RESERVE_ROUTER_NOT_IMPLEMENTED: src/reserve-router.ts missing');
    }

    const resolveReserveBucket = ReserveModule.resolveReserveBucket as (
      workloadClass: string,
      operation: string,
    ) => string | null;

    expect(resolveReserveBucket('RISK_MONITORING', 'token_security')).toBe('RISK_MONITORING');
    expect(resolveReserveBucket('ALERT_VERIFICATION', 'pool_reserves')).toBe('ALERT_VERIFICATION');
    expect(resolveReserveBucket('INTERACTIVE_MCP', 'query_identity')).toBe('INTERACTIVE_MCP');
    expect(resolveReserveBucket('EMERGENCY_BACKFILL', 'stream_transactions')).toBe(
      'EMERGENCY_BACKFILL',
    );
  });

  it('refuses to route broad-scan/low-priority workloads to any protected reserve', async () => {
    let ReserveModule: Record<string, unknown>;
    try {
      ReserveModule = (await import('../src/reserve-router.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('RESERVE_ROUTER_NOT_IMPLEMENTED: src/reserve-router.ts missing');
    }

    const resolveReserveBucket = ReserveModule.resolveReserveBucket as (
      workloadClass: string,
      operation: string,
    ) => string | null;

    expect(resolveReserveBucket('BACKFILL_LOW', 'token_security')).toBeNull();
    expect(resolveReserveBucket('EVALUATION_LOW', 'pool_reserves')).toBeNull();
    expect(resolveReserveBucket('SCHEDULED_NORMAL', 'token_price')).toBeNull();
    expect(resolveReserveBucket('DISCOVERY_BROAD', 'discover_candidates')).toBeNull();
  });

  it('exhaustion of general pool does NOT consume protected reserve quota for low-priority tasks', async () => {
    let ReserveModule: Record<string, unknown>;
    try {
      ReserveModule = (await import('../src/reserve-router.ts')) as Record<string, unknown>;
    } catch {
      throw new Error('RESERVE_ROUTER_NOT_IMPLEMENTED: src/reserve-router.ts missing');
    }

    const canAdmitFromReserve = ReserveModule.canAdmitFromReserve as (
      workloadClass: string,
      reserveBalances: Record<string, number>,
    ) => boolean;

    const balances = {
      RISK_MONITORING: 100,
      ALERT_VERIFICATION: 100,
      INTERACTIVE_MCP: 50,
      EMERGENCY_BACKFILL: 50,
      GENERAL_POOL: 0, // Exhausted general pool
    };

    expect(canAdmitFromReserve('BACKFILL_LOW', balances)).toBe(false);
    expect(canAdmitFromReserve('SCHEDULED_NORMAL', balances)).toBe(false);
    expect(canAdmitFromReserve('RISK_MONITORING', balances)).toBe(true);
    expect(canAdmitFromReserve('ALERT_VERIFICATION', balances)).toBe(true);
  });
});
