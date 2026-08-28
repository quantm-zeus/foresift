/**
 * AC-226 acceptance (positive) — Cost & Latency Decomposition facet.
 * Traces: FR-COST-006, FR-LAT.
 * AC text: "First-seen latency is decomposed into event-to-collector, collector-to-feature,
 * feature-to-decision, decision-to-delivery, and provider comparison spans for the verified collector scope."
 *
 * Facet scope (Cost control plane):
 * - First-seen latency spans computed through cost-admission include provider comparison alternative metrics.
 * - Reserve routing and cost estimation overhead does NOT inflate latency beyond strict bounds.
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

describe('AC-226 acceptance (cost facet): cost-path latency decomposition and low reserve overhead', () => {
  it('records provider comparison alternative span and preserves low reserve routing latency', async () => {
    let CostRouterModule: Record<string, unknown>;
    try {
      CostRouterModule = (await import(
        '../../packages/cost-router/src/reserve-router.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const measureCostAdmissionLatency = CostRouterModule.measureCostAdmissionLatency as (req: {
      provider: string;
      operation: string;
      workloadClass: string;
    }) => Promise<{
      providerComparisonSpanMs: number;
      reserveRoutingSpanMs: number;
      totalAdmissionMs: number;
    }>;

    const metrics = await measureCostAdmissionLatency({
      provider: 'helius',
      operation: 'raw_asset_query',
      workloadClass: 'RISK_MONITORING',
    });

    expect(metrics.providerComparisonSpanMs).toBeGreaterThanOrEqual(0);
    expect(metrics.reserveRoutingSpanMs).toBeLessThan(10); // Less than 10ms overhead
    expect(metrics.totalAdmissionMs).toBeLessThan(50);
  });
});
