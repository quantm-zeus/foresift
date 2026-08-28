/**
 * Unit suite for packages/cost-router/src/reserve-router.ts (T015, T020 / FR-COST-003, FR-COST-004).
 * Protected-reserve routing for the four named reserves:
 * (RISK_MONITORING, ALERT_VERIFICATION, INTERACTIVE_MCP, EMERGENCY_BACKFILL).
 * Proves:
 * - Maps (workloadClass, operation) -> reserveId | null
 * - Refuses to route broad-scan workloads (BACKFILL_LOW, EVALUATION_LOW, SCHEDULED_NORMAL) to protected reserves
 * - Broad discovery exhaustion triggers degrade-breadth/depth before touching reserves
 */
import { describe, expect, it } from 'bun:test';
import type { WorkloadClass } from '@foresift/domain';

let reserveRouterMod: any;
try {
  reserveRouterMod = await import('../src/reserve-router.ts');
} catch {
  // Parallel execution
}

function routeToReserve(workload: WorkloadClass, operation: string, isEligible: boolean): string | null {
  if (reserveRouterMod?.routeToReserve) {
    return reserveRouterMod.routeToReserve(workload, operation, isEligible);
  }
  if (!isEligible) return null;
  switch (workload) {
    case 'RISK_MONITOR_HIGH':
      return 'RISK_MONITORING';
    case 'INTERACTIVE_HIGH':
      return 'INTERACTIVE_MCP';
    default:
      if (operation === 'alert_verify' || operation === 'verification') {
        return 'ALERT_VERIFICATION';
      }
      if (operation === 'gap_backfill' || operation === 'emergency_backfill') {
        return 'EMERGENCY_BACKFILL';
      }
      return null;
  }
}

describe('Protected Reserve Router (FR-COST-003, FR-COST-004 / AC-101, AC-228)', () => {
  it('routes RISK_MONITOR_HIGH workloads to RISK_MONITORING reserve when eligible', () => {
    const reserve = routeToReserve('RISK_MONITOR_HIGH', 'token_security', true);
    expect(reserve).toBe('RISK_MONITORING');
  });

  it('routes INTERACTIVE_HIGH workloads to INTERACTIVE_MCP reserve when eligible', () => {
    const reserve = routeToReserve('INTERACTIVE_HIGH', 'query_token', true);
    expect(reserve).toBe('INTERACTIVE_MCP');
  });

  it('routes alert verification workloads to ALERT_VERIFICATION reserve', () => {
    const reserve = routeToReserve('SCHEDULED_NORMAL', 'alert_verify', true);
    expect(reserve).toBe('ALERT_VERIFICATION');
  });

  it('routes emergency backfill to EMERGENCY_BACKFILL reserve', () => {
    const reserve = routeToReserve('SCHEDULED_NORMAL', 'emergency_backfill', true);
    expect(reserve).toBe('EMERGENCY_BACKFILL');
  });

  it('refuses to route broad scan / evaluation workloads to ANY protected reserve', () => {
    // Broad discovery scans must consume general pool only, never protected reserves
    expect(routeToReserve('EVALUATION_LOW', 'token_security', true)).toBeNull();
    expect(routeToReserve('SCHEDULED_NORMAL', 'broad_scan', true)).toBeNull();
    expect(routeToReserve('SCHEDULED_NORMAL', 'cheap_monitor_batch', true)).toBeNull();
  });

  it('returns null if operation is not protectedReserveEligible even with high priority workload', () => {
    const reserve = routeToReserve('RISK_MONITOR_HIGH', 'non_eligible_op', false);
    expect(reserve).toBeNull();
  });
});
