/**
 * Checkpointed-step suite (T019, FR-WF-001, FR-WF-003; PRD §25.4/§25.5).
 *
 * Proves the durability law on real SQL (PGlite): a replay of the same
 * `(run_id, idempotency_key)` returns the recorded output hash without
 * re-running the side effect, attempt/input/output bookkeeping is exact, status
 * transitions use the closed vocabulary, and the §25.4 order guard refuses an
 * out-of-order or unknown step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ALL_STEP_STATUSES, ErrorCode } from '@foresift/domain';
import {
  applyScheduleControl,
  assertStepOrder,
  assertStepTransition,
  beginStep,
  checkpointStep,
  readStepCheckpoint,
  recordTriggerDelivery,
  runStepOnce,
  stepOrderIndex,
  StepLeaseManager,
  WF_STANDARD_STEP_ORDER,
} from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  HASH_A,
  HASH_B,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';

const T0 = '2026-06-01T12:00:00.000Z';

let tdb: TestDatabase;
let runId: string;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const scheduleId = 'sched-steps';
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
    versionId: 'steps-v1',
    config: {
      name: 'steps schedule',
      cron: '*/5 * * * *',
      timezone: 'UTC',
      destination: 'https://example.test/trigger',
      concurrencyPolicy: 'ALLOW_PARALLEL',
    },
  });
  await applyScheduleControl(tdb.engine, {
    action: 'ENABLE',
    scheduleId,
    now: T0,
    forecast: {
      computedAt: T0,
      runsPerDay: 24,
      providerCallsPerDay: 100,
      modelTokensPerDay: 1000,
      estimatedModelSpendPerDay: '0.50',
      quotaExhaustionDate: null,
      storageGrowthPerMonth: 1024,
    },
  });
  const trigger = await recordTriggerDelivery(tdb.engine, {
    source: 'qstash',
    externalMessageId: 'steps-msg-1',
    scheduleId,
    scheduledFor: T0,
    payloadHash: HASH_A,
    receivedAt: T0,
  });
  runId = trigger.runId ?? '';
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('§25.5 checkpoint idempotency', () => {
  it('replays a SUCCEEDED step from its recorded output hash without re-running', async () => {
    let sideEffects = 0;
    const first = await runStepOnce(
      tdb.engine,
      {
        runId,
        stepType: 'discover_candidates',
        idempotencyKey: 'idem-1',
        inputHash: HASH_A,
        now: T0,
      },
      async () => {
        sideEffects += 1;
        return { outputHash: HASH_B };
      },
    );
    expect(first.executed).toBe(true);
    expect(first.replayed).toBe(false);
    expect(first.outputHash).toBe(HASH_B);
    expect(sideEffects).toBe(1);

    const replay = await runStepOnce(
      tdb.engine,
      {
        runId,
        stepType: 'discover_candidates',
        idempotencyKey: 'idem-1',
        inputHash: HASH_A,
        now: T0,
      },
      async () => {
        sideEffects += 1;
        return { outputHash: HASH_A };
      },
    );
    expect(replay.replayed).toBe(true);
    expect(replay.executed).toBe(false);
    expect(replay.outputHash).toBe(HASH_B);
    expect(sideEffects).toBe(1);

    const recorded = await readStepCheckpoint(tdb.engine, {
      runId,
      idempotencyKey: 'idem-1',
    });
    expect(recorded?.outputHash).toBe(HASH_B);
    expect(recorded?.attempt).toBe(1);
  });

  it('refuses reusing an idempotency key with a different input hash', async () => {
    await runStepOnce(
      tdb.engine,
      {
        runId,
        stepType: 'canonicalize_and_deduplicate',
        idempotencyKey: 'idem-2',
        inputHash: HASH_A,
        now: T0,
      },
      async () => ({ outputHash: HASH_B }),
    );
    await expectForesiftError(
      beginStep(tdb.engine, {
        runId,
        stepType: 'canonicalize_and_deduplicate',
        idempotencyKey: 'idem-2',
        inputHash: HASH_B,
        now: T0,
      }),
      ErrorCode.WF_STEP_INPUT_HASH_MISMATCH,
    );
  });
});

describe('§25.5 attempt and status bookkeeping', () => {
  it('increments the attempt on a retryable failure and records the error class', async () => {
    const first = await beginStep(tdb.engine, {
      runId,
      stepType: 'fetch_cheap_required_evidence',
      idempotencyKey: 'idem-3',
      inputHash: HASH_A,
      now: T0,
    });
    expect(first.attempt).toBe(1);

    const failed = await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey: 'idem-3',
      status: 'FAILED_RETRYABLE',
      errorClass: 'TIMEOUT_OR_5XX',
      now: T0,
    });
    expect(failed.status).toBe('FAILED_RETRYABLE');
    expect(failed.errorClass).toBe('TIMEOUT_OR_5XX');
    expect(failed.retryable).toBe(true);

    const second = await beginStep(tdb.engine, {
      runId,
      stepType: 'fetch_cheap_required_evidence',
      idempotencyKey: 'idem-3',
      inputHash: HASH_A,
      now: T0,
    });
    expect(second.attempt).toBe(2);
    expect(second.executed).toBe(true);

    const succeeded = await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey: 'idem-3',
      status: 'SUCCEEDED',
      outputHash: HASH_B,
      now: T0,
    });
    expect(succeeded.status).toBe('SUCCEEDED');
    expect(succeeded.outputHash).toBe(HASH_B);
  });

  it('requires an output hash for SUCCEEDED and refuses a re-checkpoint', async () => {
    await beginStep(tdb.engine, {
      runId,
      stepType: 'rank_and_select_candidates',
      idempotencyKey: 'idem-4',
      now: T0,
    });
    await expectForesiftError(
      checkpointStep(tdb.engine, {
        runId,
        idempotencyKey: 'idem-4',
        status: 'SUCCEEDED',
        now: T0,
      }),
      ErrorCode.WF_STEP_TRANSITION_INVALID,
    );
    await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey: 'idem-4',
      status: 'SKIPPED_POLICY',
      now: T0,
    });
    await expectForesiftError(
      beginStep(tdb.engine, {
        runId,
        stepType: 'rank_and_select_candidates',
        idempotencyKey: 'idem-4',
        now: T0,
      }),
      ErrorCode.WF_STEP_TRANSITION_INVALID,
    );
  });

  it('refuses a checkpoint for an unknown step and a PENDING/RUNNING target', async () => {
    await expectForesiftError(
      checkpointStep(tdb.engine, {
        runId,
        idempotencyKey: 'never-begun',
        status: 'SUCCEEDED',
        outputHash: HASH_B,
        now: T0,
      }),
      ErrorCode.WF_STEP_NOT_FOUND,
    );
    await beginStep(tdb.engine, {
      runId,
      stepType: 'validate_decision',
      idempotencyKey: 'idem-5',
      now: T0,
    });
    await expectForesiftError(
      checkpointStep(tdb.engine, {
        runId,
        idempotencyKey: 'idem-5',
        status: 'RUNNING',
        now: T0,
      }),
      ErrorCode.WF_STEP_TRANSITION_INVALID,
    );
  });

  it('reclaims a crash-orphaned RUNNING step as a new attempt (§25.5)', async () => {
    const first = await beginStep(tdb.engine, {
      runId,
      stepType: 'apply_eligibility_data_quality_gates',
      idempotencyKey: 'idem-running',
      inputHash: HASH_A,
      now: T0,
    });
    expect(first.attempt).toBe(1);
    expect(first.executed).toBe(true);

    // No checkpoint happened (the worker crashed): reclaiming must be possible.
    const reclaimed = await beginStep(tdb.engine, {
      runId,
      stepType: 'apply_eligibility_data_quality_gates',
      idempotencyKey: 'idem-running',
      inputHash: HASH_A,
      now: T0,
    });
    expect(reclaimed.attempt).toBe(2);
    expect(reclaimed.executed).toBe(true);
    expect(reclaimed.replayed).toBe(false);
  });

  it('covers every closed StepStatus in the transition law', () => {
    for (const status of ALL_STEP_STATUSES) {
      expect(() => assertStepTransition(status, status)).toThrow();
    }
    expect(() => assertStepTransition('RUNNING', 'SUCCEEDED')).not.toThrow();
    expect(() => assertStepTransition('FAILED_RETRYABLE', 'RUNNING')).not.toThrow();
  });
});

describe('§25.7 fenced step commits (AC-012)', () => {
  it('refuses a stale lease token at commit time and accepts the current one', async () => {
    let clockMs = Date.parse(T0);
    const leases = new StepLeaseManager({
      engine: tdb.engine,
      now: () => new Date(clockMs).toISOString(),
    });
    const resourceKey = StepLeaseManager.resourceKeyHash({
      runId,
      stepType: 'apply_lifecycle_risk_transitions',
    });
    const stale = await leases.acquire({ resourceKey, owner: 'worker-a', ttlSeconds: 10 });
    clockMs = Date.parse(T0) + 30_000;
    const current = await leases.acquire({ resourceKey, owner: 'worker-b', ttlSeconds: 60 });

    await beginStep(tdb.engine, {
      runId,
      stepType: 'apply_lifecycle_risk_transitions',
      idempotencyKey: 'idem-lease',
      now: T0,
    });

    await expectForesiftError(
      checkpointStep(tdb.engine, {
        runId,
        idempotencyKey: 'idem-lease',
        status: 'SUCCEEDED',
        outputHash: HASH_B,
        lease: { resourceKey, fencingToken: stale.fencingToken },
        now: T0,
      }),
      ErrorCode.LEASE_FENCING_TOKEN_STALE,
    );

    const committed = await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey: 'idem-lease',
      status: 'SUCCEEDED',
      outputHash: HASH_B,
      lease: { resourceKey, fencingToken: current.fencingToken },
      now: T0,
    });
    expect(committed.status).toBe('SUCCEEDED');
    expect(committed.outputHash).toBe(HASH_B);
  });
});

describe('§25.4 standard step order guard', () => {
  it('exposes the full standard order', () => {
    expect(WF_STANDARD_STEP_ORDER).toHaveLength(15);
    expect(WF_STANDARD_STEP_ORDER[0]).toBe('load_immutable_resolved_configuration');
    expect(WF_STANDARD_STEP_ORDER.at(-1)).toBe('complete_run_summary');
    expect(stepOrderIndex('discover_candidates')).toBeLessThan(
      stepOrderIndex('run_deep_research_within_budget'),
    );
  });

  it('accepts in-order steps and refuses out-of-order or unknown steps', () => {
    expect(() =>
      assertStepOrder('run_deep_research_within_budget', [
        'load_immutable_resolved_configuration',
        'discover_candidates',
      ]),
    ).not.toThrow();
    expect(() =>
      assertStepOrder('discover_candidates', ['run_deep_research_within_budget']),
    ).toThrow();
    expect(() => assertStepOrder('not_a_real_step', [])).toThrow();
    try {
      assertStepOrder('not_a_real_step', []);
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.WF_STEP_ORDER_INVALID);
    }
  });
});
