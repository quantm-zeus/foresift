/**
 * AC-012 negative (failure path).
 * Traces: FR-WF-001, FR-WF-003.
 * AC text (manifest §39.2): "A stale worker cannot commit after lease fencing
 * changes."
 *
 * The fencing law has a precise failure boundary that must not over-refuse:
 * EXPIRY ALONE IS NOT FENCING — an expired-but-not-taken-over lease still
 * permits its current holder, because only a takeover allocates a new token.
 * Conversely, tokens must strictly increase across takeovers (monotonic
 * fencing is a storage guarantee), and a superseded holder can neither commit
 * nor release.
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
} from '../acceptance/helpers.ts';

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

describe('AC-012 negative: expiry alone is not fencing, tokens are monotonic', () => {
  it('still permits the current holder after expiry WITHOUT a takeover', async () => {
    const runId = await seedRun('ac012n-expiry', 'ac012n-expiry-1');
    const resourceKey = leaseKeyFor(runId);
    const idempotencyKey = `ac012n-expiry-${runId}`;

    clockMs = T0_MS;
    const holder = await manager.acquire({
      resourceKey,
      owner: 'ac012n-worker-a',
      ttlSeconds: 10,
    });
    await beginStep(tdb.engine, {
      runId,
      stepType: STEP_TYPE,
      idempotencyKey,
      lease: { resourceKey, fencingToken: holder.fencingToken },
      now: currentIso(),
    });

    // Well past expiry, but nobody took over: the lease is not live, yet its
    // holder may still commit.
    clockMs = T0_MS + 60_000;
    expect(await manager.isLive(resourceKey)).toBe(false);
    await manager.assertLeaseCurrent(holder);

    const committed = await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey,
      status: 'SUCCEEDED',
      outputHash: WF_TEST_PAYLOAD_HASH_B,
      lease: { resourceKey, fencingToken: holder.fencingToken },
      now: currentIso(),
    });
    expect(committed.status).toBe('SUCCEEDED');
  });

  it('allocates strictly increasing fencing tokens across repeated takeovers', async () => {
    const runId = await seedRun('ac012n-monotonic', 'ac012n-monotonic-1');
    const resourceKey = leaseKeyFor(runId);

    const tokens: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      clockMs = T0_MS + i * 120_000;
      const handle = await manager.acquire({
        resourceKey,
        owner: `ac012n-worker-${i}`,
        ttlSeconds: 60,
      });
      tokens.push(handle.fencingToken);
    }
    for (let i = 1; i < tokens.length; i += 1) {
      expect(tokens[i]).toBeGreaterThan(tokens[i - 1] ?? 0);
    }

    // The last (current) holder still owns the live lease; every earlier token
    // is refused by the commit-time compare.
    const staleToken = tokens[0] ?? 0;
    await expectForesiftError(
      manager.assertLeaseCurrent({
        resourceKey,
        fencingToken: staleToken,
        expiresAt: currentIso(),
      }),
      ErrorCode.LEASE_FENCING_TOKEN_STALE,
    );
  });

  it('refuses release by a stale token and accepts the current holder', async () => {
    const runId = await seedRun('ac012n-release', 'ac012n-release-1');
    const resourceKey = leaseKeyFor(runId);

    clockMs = T0_MS;
    const stale = await manager.acquire({ resourceKey, owner: 'ac012n-worker-a', ttlSeconds: 10 });
    clockMs = T0_MS + 60_000;
    const fresh = await manager.acquire({ resourceKey, owner: 'ac012n-worker-b', ttlSeconds: 60 });
    expect(fresh.fencingToken).toBeGreaterThan(stale.fencingToken);

    await expectForesiftError(manager.release(stale), ErrorCode.LEASE_FENCING_TOKEN_STALE);
    // The refused release left the fresh lease live.
    expect(await manager.isLive(resourceKey)).toBe(true);

    await manager.release(fresh);
    expect(await manager.isLive(resourceKey)).toBe(false);
    // A double release is refused too.
    await expectForesiftError(manager.release(fresh), ErrorCode.LEASE_FENCING_TOKEN_STALE);
  });
});
