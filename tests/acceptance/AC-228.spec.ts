/**
 * AC-228 acceptance (positive) — Cost & Degradation Priority Ordering facet.
 * Traces: FR-COST-003, FR-COST-004.
 * AC text: "Under simulated quota exhaustion, social, analog, wallet-history, exploration,
 * and broad-scan depth degrade before collector continuity, risk monitoring, alert verification,
 * mature outcome collection, or protected interactive reserve."
 *
 * Asserts:
 * - Degradation order strictly follows:
 *   1. Social / narrative signals
 *   2. Analog / counterfactual enrichment
 *   3. Wallet-history deep trace
 *   4. Exploration candidate count
 *   5. Broad-scan depth
 *   STRICTLY BEFORE touching:
 *   - Collector continuity
 *   - Risk monitoring
 *   - Alert verification
 *   - Mature outcome collection
 *   - Protected interactive MCP reserve
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

describe('AC-228 acceptance: strict degradation order before protected workloads', () => {
  it('degrades low-priority tasks in exact declared order under progressive exhaustion', async () => {
    let CapacityModule: Record<string, unknown>;
    try {
      CapacityModule = (await import(
        '../../packages/capacity-planner/src/degrade-policy.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_PLANNER_NOT_IMPLEMENTED: packages/capacity-planner missing');
    }

    const simulateProgressiveExhaustion = CapacityModule.simulateProgressiveExhaustion as () => {
      degradationOrder: string[];
      protectedWorkloadsTouched: string[];
    };

    const sim = simulateProgressiveExhaustion();

    expect(sim.protectedWorkloadsTouched.length).toBe(0);

    const socialIdx = sim.degradationOrder.indexOf('SOCIAL_NARRATIVE');
    const analogIdx = sim.degradationOrder.indexOf('ANALOG_COUNTERFACTUAL');
    const walletIdx = sim.degradationOrder.indexOf('WALLET_HISTORY_DEPTH');
    const exploreIdx = sim.degradationOrder.indexOf('EXPLORATION_BREADTH');
    const broadScanIdx = sim.degradationOrder.indexOf('BROAD_SCAN_DEPTH');

    expect(socialIdx).toBeGreaterThanOrEqual(0);
    expect(analogIdx).toBeGreaterThan(socialIdx);
    expect(walletIdx).toBeGreaterThan(analogIdx);
    expect(exploreIdx).toBeGreaterThan(walletIdx);
    expect(broadScanIdx).toBeGreaterThan(exploreIdx);
  });
});
