/**
 * AC-060 negative / failure-path.
 * Traces: FR-DATA-001, FR-DATA-003, FR-DR-001.
 * The benchmark harness must be able to FAIL: under an artificial over-budget
 * delay injected at the engine seam, its budget verdicts trip. A benchmark
 * that cannot fail is decoration, not measurement.
 */
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'bun:test';
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
import {
  applyScheduleControl,
  beginStep,
  checkpointStep,
  recordTriggerDelivery,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_HOT_PATH_P95_BUDGET_MS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_PAYLOAD_HASH_B,
  WF_TEST_T0,
  WF_TRIGGER_ACK_P95_BUDGET_MS,
  percentile,
} from '../fixtures/wf/index.ts';

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

/**
 * AC-060 wf negative (T037, FR-WF-001/002/003).
 *
 * The wf-scoped benchmark harness must also be able to FAIL: against an engine
 * seam that adds a fixed artificial delay to every call, the measured
 * trigger-acknowledgement p95 and the inbox → run → checkpoint p95 both exceed
 * the budgets the positive wf extension asserts. A benchmark that cannot fail
 * is decoration, not measurement.
 */
describe('AC-060 wf negative: a delayed engine trips the wf budget harness', () => {
  it('breaches the trigger-acknowledgement and hot-path budgets under injected delay', async () => {
    const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    try {
      // Schema + fixture setup run UN-delayed: only the measured hot path is
      // artificially slowed (migrations are not the workload under test).
      const fast = createEngine(db, 'pglite');
      await applyMigrations({ engine: fast, migrationsDir: MIGRATIONS_DIR });

      const scheduleId = 'ac060n-wf-delay';
      await applyScheduleControl(fast, {
        action: 'CREATE',
        scheduleId,
        now: WF_TEST_T0,
        config: {
          name: 'ac060 wf delayed benchmark',
          cron: '*/5 * * * *',
          timezone: 'UTC',
          destination: 'https://internal.example.test/wf/trigger',
          concurrencyPolicy: 'ALLOW_PARALLEL',
        },
      });
      await applyScheduleControl(fast, {
        action: 'ENABLE',
        scheduleId,
        now: WF_TEST_T0,
        forecast: WF_FORECASTS.FRESH,
      });

      // 400 ms per engine call: one trigger acknowledgement makes ≥7 delayed
      // calls, so even the acknowledgement alone exceeds the 2 s PRD target.
      const slow = delayEngine(fast, 400);

      const ackSamples: number[] = [];
      const hotPathSamples: number[] = [];
      // One measured iteration suffices: a trigger acknowledgement makes ≥7
      // delayed engine calls, so the injected 400 ms/call cost alone puts the
      // single-sample p95 far above the 2 s target (and the hot path above its
      // internal-overhead budget). Kept small so the negative stays fast.
      const iterations = 1;
      for (let i = 0; i < iterations; i += 1) {
        const idempotencyKey = `ac060n-wf-delay-step-${i}`;
        const hotStart = performance.now();
        const ackStart = performance.now();
        const delivery = await recordTriggerDelivery(slow, {
          source: 'qstash',
          externalMessageId: `ac060n-wf-delay-msg-${i}`,
          scheduleId,
          scheduledFor: WF_TEST_T0,
          payloadHash: WF_TEST_PAYLOAD_HASH_A,
          receivedAt: WF_TEST_T0,
        });
        ackSamples.push(performance.now() - ackStart);
        if (delivery.runId === null) throw new Error('delayed delivery did not start a run');
        await beginStep(slow, {
          runId: delivery.runId,
          stepType: 'discover_candidates',
          idempotencyKey,
        });
        await checkpointStep(slow, {
          runId: delivery.runId,
          idempotencyKey,
          status: 'SUCCEEDED',
          outputHash: WF_TEST_PAYLOAD_HASH_B,
        });
        hotPathSamples.push(performance.now() - hotStart);
      }

      const ackP95 = percentile(ackSamples, 0.95);
      const hotP95 = percentile(hotPathSamples, 0.95);
      // The same budgets the positive suite asserts, now observably breached.
      expect(ackP95).toBeGreaterThan(WF_TRIGGER_ACK_P95_BUDGET_MS);
      expect(hotP95).toBeGreaterThan(WF_HOT_PATH_P95_BUDGET_MS);
    } finally {
      await db.close();
    }
  }, 120_000);
});
