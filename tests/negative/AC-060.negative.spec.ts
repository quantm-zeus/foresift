/**
 * AC-060 negative / failure-path.
 * Traces: FR-DATA-001, FR-DATA-003, FR-DR-001.
 * The benchmark harness must be able to FAIL: under an artificial over-budget
 * delay injected at the engine seam, its budget verdicts trip. A benchmark
 * that cannot fail is decoration, not measurement.
 */
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { parseChainId, utcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  applyMigrations,
  createEngine,
  ensureChain,
  insertDex,
  insertPool,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  IDENTITY_LOOKUP_BUDGET_MS,
  MIGRATIONS_DIR,
  makeTestDatabase,
  runPersistenceBenchmark,
  seedPool,
  type TestDatabase,
} from '../acceptance/helpers.ts';

/**
 * Wrap every engine call with a fixed artificial delay (deterministic
 * slowdown). Transactions recurse through the same wrapper so nested work is
 * delayed identically.
 */
function delayEngine(inner: DatabaseEngine, delayMs: number): DatabaseEngine {
  const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));
  return {
    engineKind: inner.engineKind,
    query: async (sql, params) => {
      await wait();
      return inner.query(sql, params);
    },
    exec: async (sql) => {
      await wait();
      return inner.exec(sql);
    },
    transaction: (work) => inner.transaction((tx) => work(delayEngine(tx, delayMs))),
  };
}

let tdb: TestDatabase | undefined;
let slowDb: PGlite | undefined;

afterAll(async () => {
  if (tdb) await closeTestDatabase(tdb);
  if (slowDb) await slowDb.close();
});

describe('AC-060 negative: the harness fails under artificial over-budget delay', () => {
  it('a delayed engine trips the identity budget the positive suite asserts', async () => {
    tdb = await makeTestDatabase();
    // Seed one observation so replay resolves non-empty work.
    const poolId = await seedPool(tdb.engine, {
      chainId: 'eip155:1',
      dexId: 'uniswap-v2',
      poolAddress: '0x00000000000000000000000000000000000ac061',
    });
    await appendObservation(tdb.engine, {
      observationId: 'ac060n-obs',
      subjectPoolId: poolId,
      eventAt: utcTimestamp('2026-06-01T08:00:00Z'),
      availableAt: utcTimestamp('2026-06-01T09:00:00Z'),
      availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
      rawAmount: '1',
      decimals: 2,
    });

    // Fresh engine seam wrapped with a 150ms per-call artificial delay.
    slowDb = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    const slow = delayEngine(createEngine(slowDb, 'pglite'), 150);
    await applyMigrations({ engine: slow, migrationsDir: MIGRATIONS_DIR });
    await ensureChain(slow, 'eip155:1');
    await insertDex(slow, 'eip155:1', 'uniswap-v2');
    const slowPoolId = await insertPool(slow, {
      chainId: parseChainId('eip155:1'),
      dexId: 'uniswap-v2',
      poolAddress: '0x00000000000000000000000000000000000ac062',
    });
    await appendObservation(slow, {
      observationId: 'ac060n-slow-obs',
      subjectPoolId: slowPoolId,
      eventAt: utcTimestamp('2026-06-01T08:30:00Z'),
      availableAt: utcTimestamp('2026-06-01T09:30:00Z'),
      availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
      rawAmount: '2',
      decimals: 2,
    });

    // THE same harness as the positive suite, now against a slowed engine.
    const bench = await runPersistenceBenchmark(slow, {
      chainId: 'eip155:137',
      dexId: 'uniswap-v3',
      poolAddress: '0x00000000000000000000000000000000000ac063',
    });
    // Each identity pass makes ≥6 engine calls → ≥900ms against a 250ms budget.
    expect(bench.identity.worstMs).toBeGreaterThan(IDENTITY_LOOKUP_BUDGET_MS);
    expect(bench.identity.withinBudget).toBe(false);
    // Each replay read makes ≥2 calls → ≥300ms… under the 500ms budget this
    // one may legitimately still pass; the identity breach alone proves the
    // harness can fail. For replay we assert the injected cost is observable.
    expect(bench.replay.worstMs).toBeGreaterThan(150);
  }, 120_000);

  it('a single call through the delay wrapper measurably exceeds the delay floor', async () => {
    const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    try {
      const slow = delayEngine(createEngine(db, 'pglite'), 150);
      const start = performance.now();
      await slow.query('SELECT 1 AS one');
      const elapsed = performance.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(140);
    } finally {
      await db.close();
    }
  });
});
