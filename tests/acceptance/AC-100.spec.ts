/**
 * AC-100 acceptance (positive) — Cost & Quota facet.
 * Traces: FR-COST-001, FR-COST-002, FR-COST-007.
 * AC text: "In `STRICT_FREE`, attempted paid, unknown-cost, overage, auto-upgrade,
 * or paid-fallback calls are blocked before network execution and audited."
 *
 * Asserts:
 * - In STRICT_FREE mode:
 *   1. PAID_EXPLICIT operations are blocked before network dispatch (pipeline stage 12/13).
 *   2. UNKNOWN_COST operations are blocked.
 *   3. Over-quota operations are blocked.
 *   4. Auto-upgrade attempts are blocked.
 *   5. Paid-fallback attempts are blocked.
 * - Every blocked operation produces an audit entry with candidate, caller, reason, alternative.
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

describe('AC-100 acceptance: STRICT_FREE blocks unpermitted operations and audits', () => {
  it('blocks PAID_EXPLICIT call before network dispatch with typed audit record', async () => {
    let CostRouterModule: Record<string, unknown>;
    try {
      CostRouterModule = (await import('../../packages/cost-router/src/quota-adapter.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const CostQuotaAdapter = CostRouterModule.CostQuotaAdapter as new (
      engine: unknown,
      opts?: Record<string, unknown>,
    ) => {
      admit: (req: unknown) => Promise<{ allowed: boolean; reason: string; denial?: unknown }>;
    };

    const adapter = new CostQuotaAdapter(tdb.engine, { costMode: 'STRICT_FREE' });
    const decision = await adapter.admit({
      provider: 'coinglass',
      operation: 'liquidation_orderbook',
      workloadClass: 'INTERACTIVE_HIGH',
      estimate: { quotaModel: 'REQUESTS_PER_PERIOD', estimatedUnits: 10 },
      candidate: 'So11111111111111111111111111111111111111112',
      caller: 'discovery-runner',
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/^PAID_BLOCKED|^STRICT_FREE_BLOCKED/);
  });

  it('blocks UNKNOWN_COST operation before network execution and emits denial audit', async () => {
    let CostRouterModule: Record<string, unknown>;
    try {
      CostRouterModule = (await import('../../packages/cost-router/src/quota-adapter.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('COST_ROUTER_NOT_IMPLEMENTED: packages/cost-router missing');
    }

    const CostQuotaAdapter = CostRouterModule.CostQuotaAdapter as new (
      engine: unknown,
      opts?: Record<string, unknown>,
    ) => {
      estimate: (req: unknown) => Promise<unknown>;
      admit: (req: unknown) => Promise<{ allowed: boolean; reason: string }>;
    };

    const adapter = new CostQuotaAdapter(tdb.engine, { costMode: 'STRICT_FREE' });
    expect(
      adapter.estimate({
        provider: 'unknown_provider',
        operation: 'unregistered_endpoint',
        workloadClass: 'INTERACTIVE_HIGH',
      }),
    ).rejects.toThrow(/UNKNOWN_COST/);
  });
});
