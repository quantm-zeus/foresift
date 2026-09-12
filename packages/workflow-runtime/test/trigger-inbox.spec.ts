/**
 * Engine-core trigger-inbox suite (T019, FR-WF-001, FR-WF-002, AC-010; PRD
 * §25.2/§25.3) plus the scheduler delivery trust boundary (ADR-G2WF-2).
 *
 * Proves the exactly-one-run law on real SQL (PGlite):
 * - duplicate and CONCURRENT deliveries converge to exactly one run;
 * - distinct message ids create distinct runs;
 * - canonicalization collapses equivalent ids;
 * - a delivery to a nonexistent/DRAFT/PAUSED/DISABLED schedule is refused;
 * - a concurrency policy skip is recorded distinctly from a duplicate collapse;
 * - inbound replay outside the window and forged/expired/replayed scheduler
 *   deliveries are refused before any state write.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode, type ConcurrencyPolicy } from '@foresift/domain';
import {
  applyScheduleControl,
  canonicalizeExternalMessageId,
  computeDeliveryMac,
  recordTriggerDelivery,
  verifySchedulerDelivery,
  type RecordTriggerDeliveryInput,
} from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  HASH_A,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';

const T0 = '2026-06-01T12:00:00.000Z';
const SECRET = 'local-test-delivery-secret';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

function forecast(computedAt: string) {
  return {
    computedAt,
    runsPerDay: 24,
    providerCallsPerDay: 100,
    modelTokensPerDay: 1000,
    estimatedModelSpendPerDay: '0.50',
    quotaExhaustionDate: null,
    storageGrowthPerMonth: 1024,
  };
}

/** CREATE + ENABLE an ACTIVE schedule at `scheduleId`. */
async function seedActiveSchedule(
  scheduleId: string,
  concurrencyPolicy: ConcurrencyPolicy = 'ALLOW_PARALLEL',
): Promise<string> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
    config: {
      name: `schedule ${scheduleId}`,
      cron: '*/5 * * * *',
      timezone: 'UTC',
      destination: 'https://example.test/trigger',
      concurrencyPolicy,
    },
  });
  const enabled = await applyScheduleControl(tdb.engine, {
    action: 'ENABLE',
    scheduleId,
    now: T0,
    forecast: forecast(T0),
  });
  return enabled.versionId ?? '';
}

function delivery(
  scheduleId: string,
  externalMessageId: string,
  overrides: Partial<RecordTriggerDeliveryInput> = {},
): RecordTriggerDeliveryInput {
  return {
    source: 'qstash',
    externalMessageId,
    scheduleId,
    scheduledFor: T0,
    payloadHash: HASH_A,
    receivedAt: T0,
    verifiedAt: T0,
    ...overrides,
  };
}

async function countRuns(scheduleId: string): Promise<number> {
  const rows = await tdb.engine.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wf.runs WHERE schedule_id = $1`,
    [scheduleId],
  );
  return Number(rows.rows[0]?.n ?? '0');
}

describe('§25.3 canonicalization of external message ids', () => {
  it('trims, collapses whitespace, drops URL query/fragment, and lowercases hex ids', () => {
    expect(canonicalizeExternalMessageId('qstash', '  msg-1  ')).toBe('msg-1');
    expect(canonicalizeExternalMessageId('QSTASH', 'Msg\t1\n')).toBe('Msg 1');
    expect(
      canonicalizeExternalMessageId('qstash', 'https://q.stash.test/v2/trigger?id=1#frag'),
    ).toBe('https://q.stash.test/v2/trigger');
    expect(canonicalizeExternalMessageId('qstash', 'AABBCCDD-1122-3344-5566-778899AABBCC')).toBe(
      'aabbccdd-1122-3344-5566-778899aabbcc',
    );
    expect(canonicalizeExternalMessageId('qstash', 'QUJDRA==')).toBe('QUJDRA==');
    // Only UUIDs and 64-hex digests are case-folded: an opaque id keeps its
    // case, so `ABC` and `abc` remain DISTINCT delivery identities.
    expect(canonicalizeExternalMessageId('qstash', 'ABC')).toBe('ABC');
    expect(canonicalizeExternalMessageId('qstash', 'ABC')).not.toBe(
      canonicalizeExternalMessageId('qstash', 'abc'),
    );
    expect(canonicalizeExternalMessageId('qstash', 'a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('refuses an empty identity', () => {
    expect(() => canonicalizeExternalMessageId('qstash', '   ')).toThrow();
  });
});

describe('AC-010 exactly-one-run', () => {
  it('collapses a duplicate delivery onto the existing run', async () => {
    const scheduleId = 'sched-dup';
    await seedActiveSchedule(scheduleId);

    const first = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-dup-1'));
    const second = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-dup-1'));

    expect(first.statusCode).toBe(202);
    expect(first.duplicate).toBe(false);
    expect(first.outcome).toBe('RUN_STARTED');
    expect(first.runId).not.toBeNull();

    expect(second.duplicate).toBe(true);
    expect(second.outcome).toBe('DUPLICATE_COLLAPSED');
    expect(second.runId).toBe(first.runId);
    expect(second.inboxId).toBe(first.inboxId);
    expect(await countRuns(scheduleId)).toBe(1);
  });

  it('collapses CONCURRENT deliveries onto exactly one run', async () => {
    const scheduleId = 'sched-race';
    await seedActiveSchedule(scheduleId);

    const [a, b] = await Promise.all([
      recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-race-1')),
      recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-race-1')),
    ]);

    expect(a.runId).not.toBeNull();
    expect(b.runId).not.toBeNull();
    expect(a.runId).toBe(b.runId);
    expect(await countRuns(scheduleId)).toBe(1);

    const inbox = await tdb.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wf.trigger_inbox WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(Number(inbox.rows[0]?.n ?? '0')).toBe(1);
  });

  it('creates distinct runs for distinct message ids', async () => {
    const scheduleId = 'sched-distinct';
    await seedActiveSchedule(scheduleId);

    const first = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-distinct-1'));
    const second = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-distinct-2'));

    expect(first.runId).not.toBe(second.runId);
    expect(second.outcome).toBe('RUN_STARTED');
    expect(await countRuns(scheduleId)).toBe(2);
  });

  it('records a concurrency policy skip distinctly from a duplicate collapse', async () => {
    const scheduleId = 'sched-skip';
    await seedActiveSchedule(scheduleId, 'SKIP_IF_RUNNING');

    const first = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-skip-1'));
    const skipped = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-skip-2'));

    expect(skipped.duplicate).toBe(false);
    expect(skipped.outcome).toBe('POLICY_SKIPPED');
    expect(skipped.runId).not.toBe(first.runId);

    const skippedRun = await tdb.engine.query<{ status: string; concurrency_outcome: string }>(
      `SELECT status, concurrency_outcome FROM wf.runs WHERE run_id = $1`,
      [skipped.runId],
    );
    expect(skippedRun.rows[0]?.status).toBe('CANCELLED');
    expect(skippedRun.rows[0]?.concurrency_outcome).toBe('SKIP_IF_RUNNING');

    const collapse = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-skip-1'));
    expect(collapse.duplicate).toBe(true);
    expect(collapse.outcome).toBe('DUPLICATE_COLLAPSED');
    expect(collapse.runId).toBe(first.runId);
  });

  it('serializes DISTINCT concurrent deliveries under SKIP_IF_RUNNING (§25.6)', async () => {
    const scheduleId = 'sched-skip-race';
    await seedActiveSchedule(scheduleId, 'SKIP_IF_RUNNING');

    const [a, b] = await Promise.all([
      recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-race-distinct-1')),
      recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'msg-race-distinct-2')),
    ]);

    // Exactly one delivery starts; the other is recorded as a policy skip —
    // never two concurrent runs for one schedule.
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['POLICY_SKIPPED', 'RUN_STARTED']);
    const started = await tdb.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wf.runs
        WHERE schedule_id = $1 AND status = 'PENDING'`,
      [scheduleId],
    );
    expect(Number(started.rows[0]?.n ?? '0')).toBe(1);
  });

  it('refuses a delivery to an unknown, DRAFT, PAUSED, or DISABLED schedule', async () => {
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery('sched-missing', 'msg-x')),
      ErrorCode.WF_SCHEDULE_NOT_FOUND,
    );

    const draftId = 'sched-draft';
    await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId: draftId,
      now: T0,
      config: {
        name: 'draft',
        cron: '*/5 * * * *',
        timezone: 'UTC',
        destination: 'https://example.test/trigger',
      },
    });
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery(draftId, 'msg-draft')),
      ErrorCode.WF_SCHEDULE_NOT_ACTIVE,
    );

    const pausedId = 'sched-paused';
    await seedActiveSchedule(pausedId);
    await applyScheduleControl(tdb.engine, { action: 'PAUSE', scheduleId: pausedId, now: T0 });
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery(pausedId, 'msg-paused')),
      ErrorCode.WF_SCHEDULE_PAUSED,
    );

    const disabledId = 'sched-disabled';
    await seedActiveSchedule(disabledId);
    await applyScheduleControl(tdb.engine, { action: 'DISABLE', scheduleId: disabledId, now: T0 });
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery(disabledId, 'msg-disabled')),
      ErrorCode.WF_SCHEDULE_DISABLED,
    );

    // None of the refusals left a run behind.
    expect(await countRuns(draftId)).toBe(0);
    expect(await countRuns(pausedId)).toBe(0);
    expect(await countRuns(disabledId)).toBe(0);
  });
});

describe('scheduler delivery trust boundary (§25.3 steps 1-2)', () => {
  function signed(overrides: {
    payload?: string;
    deliveredAt?: string;
    messageId?: string;
    secret?: string;
  }) {
    const payload = overrides.payload ?? '{"scheduleId":"sched-1"}';
    const deliveredAt = overrides.deliveredAt ?? T0;
    const messageId = overrides.messageId ?? 'msg-sig-1';
    const secret = overrides.secret ?? SECRET;
    return {
      payload,
      signature: computeDeliveryMac({ payload, secret, deliveredAt, messageId }),
      secret,
      deliveredAt,
      messageId,
      now: T0,
      replayWindowMs: REPLAY_WINDOW_MS,
    };
  }

  it('accepts a correctly signed, in-window, unseen delivery', () => {
    const verdict = verifySchedulerDelivery(signed({}));
    expect(verdict.verified).toBe(true);
    expect(verdict.messageId).toBe('msg-sig-1');
  });

  it('accepts the sha256= signature prefix', () => {
    const input = signed({});
    const verdict = verifySchedulerDelivery({ ...input, signature: `sha256=${input.signature}` });
    expect(verdict.verified).toBe(true);
  });

  it('refuses a forged signature and a tampered payload', async () => {
    const forged = { ...signed({}), signature: 'f'.repeat(64) };
    await expectForesiftError(
      Promise.resolve().then(() => verifySchedulerDelivery(forged)),
      ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
    );
    const tampered = signed({});
    await expectForesiftError(
      Promise.resolve().then(() =>
        verifySchedulerDelivery({ ...tampered, payload: '{"scheduleId":"other"}' }),
      ),
      ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
    );
  });

  it('refuses a missing or non-string signature with a TYPED error', async () => {
    const input = signed({});
    for (const bad of [undefined, null, 42, ['abc', 'def'], {}]) {
      await expectForesiftError(
        Promise.resolve().then(() =>
          verifySchedulerDelivery({ ...input, signature: bad as unknown as string }),
        ),
        ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
      );
    }
  });

  it('refuses an expired timestamp outside the replay window', async () => {
    const stale = signed({ deliveredAt: '2026-06-01T11:00:00.000Z' });
    await expectForesiftError(
      Promise.resolve().then(() => verifySchedulerDelivery(stale)),
      ErrorCode.WF_SCHEDULER_TIMESTAMP_OUT_OF_WINDOW,
    );
    const future = signed({ deliveredAt: '2026-06-01T13:00:00.000Z' });
    await expectForesiftError(
      Promise.resolve().then(() => verifySchedulerDelivery(future)),
      ErrorCode.WF_SCHEDULER_TIMESTAMP_OUT_OF_WINDOW,
    );
  });

  it('refuses a replayed message id', async () => {
    const input = signed({ messageId: 'msg-seen' });
    await expectForesiftError(
      Promise.resolve().then(() =>
        verifySchedulerDelivery({ ...input, seenMessageIds: ['msg-seen'] }),
      ),
      ErrorCode.WF_SCHEDULER_DELIVERY_REPLAYED,
    );
    await expectForesiftError(
      Promise.resolve().then(() =>
        verifySchedulerDelivery({ ...input, seenMessageIds: new Set(['msg-seen']) }),
      ),
      ErrorCode.WF_SCHEDULER_DELIVERY_REPLAYED,
    );
  });

  it('refuses an inbound replay before any state write', async () => {
    const scheduleId = 'sched-replay';
    await seedActiveSchedule(scheduleId);
    const seen = await tdb.engine.query<{ canonical_external_message_id: string }>(
      `SELECT canonical_external_message_id FROM wf.trigger_inbox WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(seen.rows).toEqual([]);

    const input = signed({ messageId: 'msg-replay-state' });
    await expectForesiftError(
      Promise.resolve().then(() =>
        verifySchedulerDelivery({ ...input, seenMessageIds: ['msg-replay-state'] }),
      ),
      ErrorCode.WF_SCHEDULER_DELIVERY_REPLAYED,
    );

    const after = await tdb.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wf.trigger_inbox WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(Number(after.rows[0]?.n ?? '0')).toBe(0);
  });
});
