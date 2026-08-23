/**
 * AC-060 acceptance (positive) — task T058.
 * Traces: FR-DATA-001, FR-DATA-003, FR-DR-001 (internal-overhead benchmark
 * substrate of AC-060 per spec §3.2).
 * AC text (manifest §39): "Internal overhead targets are met on benchmark
 * workload."
 *
 * Benchmark fixtures over the two persistence hot paths this package owns —
 * identity lookup and replay reads — with explicit budget assertions.
 * End-to-end overhead targets close in later integration packages; the
 * negative suite proves the harness itself can fail under injected delay.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseChainId, utcTimestamp } from '@foresift/domain';
import { appendObservation, insertPool } from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  runPersistenceBenchmark,
  seedPool,
  type TestDatabase,
} from './helpers.ts';

let tdb: TestDatabase;
let poolId: string;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  // Seed a small but non-empty fixture workload: identity chain + observations.
  await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac060',
  });
  poolId = await insertPool(engine, {
    chainId: parseChainId('eip155:1'),
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000c0600',
  });
  for (let i = 0; i < 25; i += 1) {
    await appendObservation(engine, {
      observationId: `ac060-obs-${String(i).padStart(2, '0')}`,
      subjectPoolId: poolId,
      eventAt: utcTimestamp(`2026-06-01T08:${String(i).padStart(2, '0')}:00Z`),
      availableAt: utcTimestamp(`2026-06-01T09:${String(i).padStart(2, '0')}:00Z`),
      availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
      rawAmount: String(i * 10),
      decimals: 2,
    });
  }
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-060: persistence benchmark fixtures meet internal overhead budgets', () => {
  const workload = {
    chainId: 'eip155:11155111',
    dexId: 'uniswap-v3',
    poolAddress: '0x00000000000000000000000000000000000d0600',
  };

  it('identity lookup stays within budget on the fixture workload', async () => {
    const bench = await runPersistenceBenchmark(tdb.engine, workload);
    expect(bench.identity.iterations).toBeGreaterThan(0);
    expect(bench.identity.withinBudget, `worst ${bench.identity.worstMs.toFixed(1)}ms`).toBe(true);
  });

  it('replay read stays within budget over the observation fixture', async () => {
    const bench = await runPersistenceBenchmark(tdb.engine, workload);
    expect(bench.replay.iterations).toBeGreaterThan(0);
    expect(bench.replay.withinBudget, `worst ${bench.replay.worstMs.toFixed(1)}ms`).toBe(true);
  });
});
