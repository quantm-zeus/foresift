/**
 * AC-012 acceptance (positive).
 * Traces: FR-WF-001, FR-WF-003.
 * AC text (manifest §39.2): "A stale worker cannot commit after lease fencing
 * changes."
 *
 * The §25.7 commit-time fence is enforced in the checkpoint statement itself:
 * once a takeover allocates a strictly larger `nextval` token, the previous
 * holder's token matches no live lease row and its commit updates zero rows —
 * a typed `LEASE_FENCING_TOKEN_STALE`. The fence is REQUIRED whenever a live
 * lease exists: a lease-less commit against a live lease also fails closed, so
 * omitting the fence can never choose an unfenced write path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  StepLeaseManager,
  applyScheduleControl,
  beginStep,
  checkpointStep,
  recordTriggerDelivery,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_PAYLOAD_HASH_B,
  WF_TEST_T0,
} from '../fixtures/wf/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';

const T0_MS = Date.parse(WF_TEST_T0);
const STEP_TYPE = 'discover_candidates';

let tdb: TestDatabase;
let clockMs = T0_MS;
let manager: StepLeaseManager;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  manager = new StepLeaseManager({
    engine: tdb.engine,
    now: () => new Date(clockMs).toISOString(),
  });
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

/** CREATE + ENABLE an ACTIVE schedule, then start one run through the inbox. */
async function seedRun(scheduleId: string, messageId: string): Promise<string> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: WF_TEST_T0,
    config: {
      name: `schedule ${scheduleId}`,
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
  const delivery = await recordTriggerDelivery(tdb.engine, {
    source: 'qstash',
    externalMessageId: messageId,
    scheduleId,
    scheduledFor: WF_TEST_T0,
    payloadHash: WF_TEST_PAYLOAD_HASH_A,
    receivedAt: WF_TEST_T0,
    verifiedAt: WF_TEST_T0,
  });
  if (delivery.runId === null) throw new Error('fixture run did not start');
  return delivery.runId;
}

function leaseKeyFor(runId: string): string {
  return StepLeaseManager.resourceKeyHash({ runId, stepType: STEP_TYPE });
}

function currentIso(): string {
  return new Date(clockMs).toISOString();
}

describe('AC-012: stale workers cannot commit after a fencing change', () => {
  it('refuses a stale-token checkpoint after a takeover and accepts the new holder', async () => {
    const runId = await seedRun('ac012-takeover', 'ac012-takeover-1');
    const resourceKey = leaseKeyFor(runId);
    const idempotencyKey = `ac012-takeover-${runId}`;

    clockMs = T0_MS;
    const stale = await manager.acquire({ resourceKey, owner: 'ac012-worker-a', ttlSeconds: 10 });
    await beginStep(tdb.engine, {
      runId,
      stepType: STEP_TYPE,
      idempotencyKey,
      lease: { resourceKey, fencingToken: stale.fencingToken },
      now: currentIso(),
    });

    // The lease expires and a recovery worker takes over: a strictly larger
    // token replaces the stale holder's.
    clockMs = T0_MS + 30_000;
    const fresh = await manager.acquire({ resourceKey, owner: 'ac012-worker-b', ttlSeconds: 60 });
    expect(fresh.fencingToken).toBeGreaterThan(stale.fencingToken);

    // The stale holder commits with its OLD token: refused typed.
    await expectForesiftError(
      checkpointStep(tdb.engine, {
        runId,
        idempotencyKey,
        status: 'SUCCEEDED',
        outputHash: WF_TEST_PAYLOAD_HASH_B,
        lease: { resourceKey, fencingToken: stale.fencingToken },
        now: currentIso(),
      }),
      ErrorCode.LEASE_FENCING_TOKEN_STALE,
    );

    const stillRunning = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.steps WHERE run_id = $1 AND idempotency_key = $2`,
      [runId, idempotencyKey],
    );
    expect(stillRunning.rows[0]?.status).toBe('RUNNING');

    // The current holder commits successfully.
    const committed = await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey,
      status: 'SUCCEEDED',
      outputHash: WF_TEST_PAYLOAD_HASH_B,
      lease: { resourceKey, fencingToken: fresh.fencingToken },
      now: currentIso(),
    });
    expect(committed.status).toBe('SUCCEEDED');
  });

  it('refuses a lease-less checkpoint while a live lease exists for the step', async () => {
    const runId = await seedRun('ac012-leaseless', 'ac012-leaseless-1');
    const resourceKey = leaseKeyFor(runId);
    const idempotencyKey = `ac012-leaseless-${runId}`;

    clockMs = T0_MS;
    // The step starts before any lease exists (a legitimate lease-less start).
    await beginStep(tdb.engine, {
      runId,
      stepType: STEP_TYPE,
      idempotencyKey,
      now: currentIso(),
    });

    // A live lease now exists. Presenting no fence must NOT be an escape hatch.
    const live = await manager.acquire({ resourceKey, owner: 'ac012-worker-a', ttlSeconds: 60 });
    expect(await manager.isLive(resourceKey)).toBe(true);

    await expectForesiftError(
      checkpointStep(tdb.engine, {
        runId,
        idempotencyKey,
        status: 'SUCCEEDED',
        outputHash: WF_TEST_PAYLOAD_HASH_B,
        // no lease fence at all
        now: currentIso(),
      }),
      ErrorCode.LEASE_FENCING_TOKEN_STALE,
    );

    // Presenting the live token commits.
    const committed = await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey,
      status: 'SUCCEEDED',
      outputHash: WF_TEST_PAYLOAD_HASH_B,
      lease: { resourceKey, fencingToken: live.fencingToken },
      now: currentIso(),
    });
    expect(committed.status).toBe('SUCCEEDED');
  });
});
