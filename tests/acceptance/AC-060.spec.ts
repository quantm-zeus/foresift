/**
 * AC-060 acceptance (positive).
 * Traces: FR-DATA-001, FR-DATA-003, FR-DR-001 (internal-overhead benchmark
 * substrate of AC-060 per spec §3.2).
 * AC text (manifest §39): "Internal overhead targets are met on benchmark
 * workload."
 *
 * Benchmark fixtures over the two persistence hot paths this package owns —
 * identity upsert path and replay reads — with explicit budget assertions.
 * End-to-end overhead targets close in later integration packages; the
 * negative suite proves the harness itself can fail under injected delay.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { performance } from 'node:perf_hooks';
import { parseChainId, utcTimestamp } from '@foresift/domain';
import { appendObservation, insertPool } from '@foresift/persistence';
import {
  applyScheduleControl,
  beginStep,
  checkpointStep,
  recordTriggerDelivery,
} from '@foresift/workflow-runtime';
import {
  closeTestDatabase,
  makeTestDatabase,
  runPersistenceBenchmark,
  seedPool,
  type TestDatabase,
} from './helpers.ts';
import {
  WF_BENCHMARK_ITERATIONS,
  WF_FORECASTS,
  WF_HOT_PATH_P95_BUDGET_MS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_PAYLOAD_HASH_B,
  WF_TEST_T0,
  WF_TRIGGER_ACK_P95_BUDGET_MS,
  percentile,
} from '../fixtures/wf/index.ts';

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
}, 120_000);

afterAll(() => closeTestDatabase(tdb));

describe('AC-060: persistence benchmark fixtures meet internal overhead budgets', () => {
  const workload = {
    chainId: 'eip155:11155111',
    dexId: 'uniswap-v3',
    poolAddress: '0x00000000000000000000000000000000000d0600',
  };

  it('identity upsert path stays within budget on the fixture workload', async () => {
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

/**
 * AC-060 wf-scoped extension (T037, FR-WF-001/002/003).
 *
 * On the benchmark workload the §25.3 trigger acknowledgement must satisfy the
 * PRD §33.1 target ("Schedule trigger acknowledgement < 2 seconds"), and the
 * inbox → run → checkpoint hot path must stay inside the documented internal
 * overhead budget. Both verdicts come from a measured loop over real SQL
 * samples (p95, nearest rank) — not from a recomputed constant.
 */
describe('AC-060 wf extension: trigger acknowledgement and inbox->run->checkpoint budgets', () => {
  it('keeps trigger ack p95 < 2s and the hot path p95 within the internal-overhead budget', async () => {
    const scheduleId = 'ac060-wf-bench';
    await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId,
      now: WF_TEST_T0,
      config: {
        name: 'ac060 wf benchmark schedule',
        cron: '*/5 * * * *',
        timezone: 'UTC',
        destination: 'https://internal.example.test/wf/trigger',
        concurrencyPolicy: 'ALLOW_PARALLEL',
      },
    });
    await applyScheduleControl(tdb.engine, {
      action: 'ENABLE',
      scheduleId,
      now: WF_TEST_T0,
      forecast: WF_FORECASTS.FRESH,
    });

    const ackSamples: number[] = [];
    const hotPathSamples: number[] = [];
    for (let i = 0; i < WF_BENCHMARK_ITERATIONS; i += 1) {
      const idempotencyKey = `ac060-wf-bench-step-${i}`;
      const hotStart = performance.now();
      const ackStart = performance.now();
      const delivery = await recordTriggerDelivery(tdb.engine, {
        source: 'qstash',
        externalMessageId: `ac060-wf-bench-msg-${i}`,
        scheduleId,
        scheduledFor: WF_TEST_T0,
        payloadHash: WF_TEST_PAYLOAD_HASH_A,
        receivedAt: WF_TEST_T0,
      });
      ackSamples.push(performance.now() - ackStart);
      if (delivery.runId === null) throw new Error('benchmark delivery did not start a run');

      await beginStep(tdb.engine, {
        runId: delivery.runId,
        stepType: 'discover_candidates',
        idempotencyKey,
      });
      await checkpointStep(tdb.engine, {
        runId: delivery.runId,
        idempotencyKey,
        status: 'SUCCEEDED',
        outputHash: WF_TEST_PAYLOAD_HASH_B,
      });
      hotPathSamples.push(performance.now() - hotStart);
    }

    expect(ackSamples).toHaveLength(WF_BENCHMARK_ITERATIONS);
    expect(hotPathSamples).toHaveLength(WF_BENCHMARK_ITERATIONS);

    const ackP95 = percentile(ackSamples, 0.95);
    const hotP95 = percentile(hotPathSamples, 0.95);
    // A real measurement: both regions consumed measurable wall-clock time.
    expect(ackP95).toBeGreaterThan(0);
    expect(hotP95).toBeGreaterThan(0);
    expect(ackP95, `trigger acknowledgement p95 ${ackP95.toFixed(1)}ms`).toBeLessThan(
      WF_TRIGGER_ACK_P95_BUDGET_MS,
    );
    expect(hotP95, `inbox->run->checkpoint p95 ${hotP95.toFixed(1)}ms`).toBeLessThan(
      WF_HOT_PATH_P95_BUDGET_MS,
    );
  }, 120_000);
});
