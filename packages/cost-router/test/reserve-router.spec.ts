/**
 * Reserve router unit tests (FR-COST-003, FR-COST-004, AC-101, AC-228).
 * Asserts mapping of (workloadClass, operation) to protected reserves,
 * strict refusal for broad-scan workloads, and eligibility constraints.
 */
import { describe, expect, it } from 'bun:test';
import {
  routeToReserve,
  type ReserveRouteResult,
} from '../src/reserve-router.ts';
import {
  FREE_QUOTA_OP,
  PAID_EXPLICIT_OP,
} from '../../../tests/fixtures/cost/operations.ts';

describe('routeToReserve', () => {
  it('routes RISK_MONITOR_HIGH workload to RISK_MONITORING reserve when eligible', () => {
    const result = routeToReserve({
      workloadClass: 'RISK_MONITOR_HIGH',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: true,
      },
    });

    expect(result.reserveId).toBe('RISK_MONITORING');
    expect(result.allowed).toBe(true);
  });

  it('routes INTERACTIVE_HIGH workload to INTERACTIVE_MCP reserve when eligible', () => {
    const result = routeToReserve({
      workloadClass: 'INTERACTIVE_HIGH',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: true,
      },
    });

    expect(result.reserveId).toBe('INTERACTIVE_MCP');
    expect(result.allowed).toBe(true);
  });

  it('refuses to route broad-scan BACKFILL_LOW workload to any reserve', () => {
    const result = routeToReserve({
      workloadClass: 'BACKFILL_LOW',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: true,
      },
    });

    // Broad scan must route to general pool (reserveId = null) or be blocked from reserves
    expect(result.reserveId).toBeNull();
  });

  it('refuses to route EVALUATION_LOW workload to any reserve', () => {
    const result = routeToReserve({
      workloadClass: 'EVALUATION_LOW',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: true,
      },
    });

    expect(result.reserveId).toBeNull();
  });

  it('refuses to route SCHEDULED_NORMAL workload to any reserve', () => {
    const result = routeToReserve({
      workloadClass: 'SCHEDULED_NORMAL',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: true,
      },
    });

    expect(result.reserveId).toBeNull();
  });

  it('never routes operation with protectedReserveEligible=false to a reserve', () => {
    const result = routeToReserve({
      workloadClass: 'RISK_MONITOR_HIGH',
      operation: {
        ...FREE_QUOTA_OP,
        protectedReserveEligible: false,
      },
    });

    expect(result.reserveId).toBeNull();
  });
});
