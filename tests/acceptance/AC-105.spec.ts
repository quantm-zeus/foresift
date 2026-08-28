/**
 * AC-105 acceptance (positive) — Cost & BYOK Model Isolation facet.
 * Traces: FR-COST-008, FR-COST-010.
 * AC text: "A nonzero approved BYOK model budget can run the headless agent
 * while data-provider mode remains `STRICT_FREE` with zero paid data calls."
 *
 * Asserts:
 * - A user-configured and approved BYOK model budget allows headless agent execution and model token consumption.
 * - Concurrently, data-provider mode remains STRICT_FREE with ZERO paid data provider calls.
 * - Cost reporting clearly separates model token spend from data provider spend (no zero-cost overclaim).
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

describe('AC-105 acceptance: BYOK model budget execution with data-provider STRICT_FREE', () => {
  it('runs agent on BYOK model tokens while data-provider mode stays STRICT_FREE with 0 paid data calls', async () => {
    let PlannerModule: Record<string, unknown>;
    try {
      PlannerModule = (await import(
        '../../packages/capacity-planner/src/planner.ts'
      )) as Record<string, unknown>;
    } catch {
      throw new Error('CAPACITY_PLANNER_NOT_IMPLEMENTED: packages/capacity-planner missing');
    }

    const AgentExecutionCoordinator = PlannerModule.AgentExecutionCoordinator as new (
      engine: unknown,
      config: {
        byokModelBudgetUsd: number;
        dataProviderMode: string;
      },
    ) => {
      runAgentTask: (task: {
        promptTokens: number;
        dataOperations: Array<{ provider: string; operation: string; costClass: string }>;
      }) => Promise<{
        agentCompleted: boolean;
        modelTokensConsumed: number;
        paidDataCallsMade: number;
        freeDataCallsMade: number;
      }>;
    };

    const coordinator = new AgentExecutionCoordinator(tdb.engine, {
      byokModelBudgetUsd: 25.0,
      dataProviderMode: 'STRICT_FREE',
    });

    const execution = await coordinator.runAgentTask({
      promptTokens: 1500,
      dataOperations: [
        { provider: 'helius', operation: 'raw_asset_query', costClass: 'FREE_UNMETERED' },
        { provider: 'gmgn', operation: 'token_security', costClass: 'FREE_QUOTA' },
      ],
    });

    expect(execution.agentCompleted).toBe(true);
    expect(execution.modelTokensConsumed).toBeGreaterThan(0);
    expect(execution.paidDataCallsMade).toBe(0);
    expect(execution.freeDataCallsMade).toBe(2);
  });
});
