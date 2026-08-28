/**
 * AC-101 acceptance (positive) — Cost & Capacity facet.
 * Traces: FR-COST-003, FR-COST-004.
 * AC text: "Broad discovery quota exhaustion reduces scan breadth or returns cache;
 * it cannot consume protected risk/alert reserves."
 *
 * Asserts:
 * - When general quota pool is exhausted during broad discovery, system degrades breadth (fewer candidates)
 *   or serves from exact/stale cache.
 * - All four named protected reserves (RISK_MONITORING, ALERT_VERIFICATION, INTERACTIVE_MCP, EMERGENCY_BACKFILL)
 *   remain strictly unmodified.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-101 acceptance: broad discovery exhaustion preserves protected reserves', () => {
  it('reduces scan breadth or serves from cache without modifying reserve balances', async () => {
    let CapacityModule: Record<string, unknown>;
    try {
      CapacityModule = (await import(
        '../../packages/capacity-planner/src/degrade-policy.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_PLANNER_NOT_IMPLEMENTED: packages/capacity-planner missing');
    }

    const handleQuotaExhaustion = CapacityModule.handleQuotaExhaustion as (req: {
      workloadClass: string;
      requestedCandidates: number;
      generalQuotaAvailable: number;
      reserveBalances: {
        RISK_MONITORING: number;
        ALERT_VERIFICATION: number;
        INTERACTIVE_MCP: number;
        EMERGENCY_BACKFILL: number;
      };
    }) => {
      admittedCandidates: number;
      servedFromCache: boolean;
      finalReserveBalances: {
        RISK_MONITORING: number;
        ALERT_VERIFICATION: number;
        INTERACTIVE_MCP: number;
        EMERGENCY_BACKFILL: number;
      };
    };

    const initialReserves = {
      RISK_MONITORING: 100,
      ALERT_VERIFICATION: 75,
      INTERACTIVE_MCP: 50,
      EMERGENCY_BACKFILL: 50,
    };

    const outcome = handleQuotaExhaustion({
      workloadClass: 'DISCOVERY_BROAD',
      requestedCandidates: 50,
      generalQuotaAvailable: 0,
      reserveBalances: { ...initialReserves },
    });

    expect(outcome.admittedCandidates).toBeLessThan(50);
    expect(outcome.finalReserveBalances.RISK_MONITORING).toBe(initialReserves.RISK_MONITORING);
    expect(outcome.finalReserveBalances.ALERT_VERIFICATION).toBe(
      initialReserves.ALERT_VERIFICATION,
    );
    expect(outcome.finalReserveBalances.INTERACTIVE_MCP).toBe(initialReserves.INTERACTIVE_MCP);
    expect(outcome.finalReserveBalances.EMERGENCY_BACKFILL).toBe(
      initialReserves.EMERGENCY_BACKFILL,
    );
  });
});
