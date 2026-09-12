/**
 * AC-010 negative (failure path).
 * Traces: FR-WF-001, FR-WF-002.
 * AC text (manifest §39.2): "Duplicate scheduler deliveries create exactly one
 * logical run."
 *
 * Failure paths that must stay fail-closed:
 * - an expired (out-of-window), replayed, or forged scheduler envelope is
 *   refused TYPED by the §25.3 trust boundary and records NOTHING — the
 *   refusal is not a silent dedupe;
 * - a delivery to an unknown, DRAFT, PAUSED, or DISABLED schedule is refused
 *   typed and creates no run (the inbox insert rolls back with it);
 * - schedule B reusing schedule A's message id is refused typed and B gains
 *   neither a run nor an inbox row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  TriggerDeliveryOutcome,
  applyScheduleControl,
  recordTriggerDelivery,
  verifySchedulerDelivery,
  type RecordTriggerDeliveryInput,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_T0,
  WF_TRIGGER_ENVELOPES,
  WF_TRIGGER_VERDICT,
  type WfTriggerEnvelopeFixture,
} from '../fixtures/wf/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T0 = WF_TEST_T0;

const VERDICT_ERROR_CODE: Readonly<Record<string, string>> = Object.freeze({
  [WF_TRIGGER_VERDICT.SIGNATURE_INVALID]: ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
  [WF_TRIGGER_VERDICT.TIMESTAMP_OUT_OF_WINDOW]: ErrorCode.WF_SCHEDULER_TIMESTAMP_OUT_OF_WINDOW,
  [WF_TRIGGER_VERDICT.DELIVERY_REPLAYED]: ErrorCode.WF_SCHEDULER_DELIVERY_REPLAYED,
});

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

async function seedActiveSchedule(scheduleId: string): Promise<void> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
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
    now: T0,
    forecast: WF_FORECASTS.FRESH,
  });
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
    payloadHash: WF_TEST_PAYLOAD_HASH_A,
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

async function countInbox(scheduleId: string): Promise<number> {
  const rows = await tdb.engine.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wf.trigger_inbox WHERE schedule_id = $1`,
    [scheduleId],
  );
  return Number(rows.rows[0]?.n ?? '0');
}

async function countInboxByIdentity(messageId: string): Promise<number> {
  const rows = await tdb.engine.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wf.trigger_inbox WHERE canonical_external_message_id = $1`,
    [messageId],
  );
  return Number(rows.rows[0]?.n ?? '0');
}

describe('AC-010 negative: refusals never collapse into a silent dedupe', () => {
  it('refuses the forged, expired, and replayed envelopes typed and records nothing', async () => {
    const scheduleId = 'ac010n-sched-envelopes';
    await seedActiveSchedule(scheduleId);

    // Control: the canonical valid envelope verifies.
    expect(verifySchedulerDelivery(WF_TRIGGER_ENVELOPES.VALID).verified).toBe(true);

    const refused: readonly WfTriggerEnvelopeFixture[] = [
      WF_TRIGGER_ENVELOPES.FORGED,
      WF_TRIGGER_ENVELOPES.EXPIRED,
      WF_TRIGGER_ENVELOPES.REPLAYED,
    ];
    for (const envelope of refused) {
      const code = VERDICT_ERROR_CODE[envelope.expectedVerdict];
      expect(code).toBeDefined();
      await expectForesiftError(
        Promise.resolve().then(() => verifySchedulerDelivery(envelope)),
        code as string,
      );
      // The refused delivery identity is NOT stored as a (deduplicated) inbox
      // row — the refusal happened before any state write.
      expect(await countInboxByIdentity(envelope.messageId)).toBe(0);
    }

    expect(await countRuns(scheduleId)).toBe(0);
    expect(await countInbox(scheduleId)).toBe(0);
  });

  it('refuses a delivery to an unknown, DRAFT, PAUSED, or DISABLED schedule with no run', async () => {
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery('ac010n-missing', 'ac010n-msg-missing')),
      ErrorCode.WF_SCHEDULE_NOT_FOUND,
    );

    const draftId = 'ac010n-draft';
    await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId: draftId,
      now: T0,
      config: {
        name: 'draft',
        cron: '*/5 * * * *',
        timezone: 'UTC',
        destination: 'https://internal.example.test/wf/trigger',
      },
    });
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery(draftId, 'ac010n-msg-draft')),
      ErrorCode.WF_SCHEDULE_NOT_ACTIVE,
    );

    const pausedId = 'ac010n-paused';
    await seedActiveSchedule(pausedId);
    await applyScheduleControl(tdb.engine, { action: 'PAUSE', scheduleId: pausedId, now: T0 });
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery(pausedId, 'ac010n-msg-paused')),
      ErrorCode.WF_SCHEDULE_PAUSED,
    );

    const disabledId = 'ac010n-disabled';
    await seedActiveSchedule(disabledId);
    await applyScheduleControl(tdb.engine, { action: 'DISABLE', scheduleId: disabledId, now: T0 });
    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery(disabledId, 'ac010n-msg-disabled')),
      ErrorCode.WF_SCHEDULE_DISABLED,
    );

    for (const scheduleId of [draftId, pausedId, disabledId]) {
      expect(await countRuns(scheduleId)).toBe(0);
      // The inbox write rolls back with the refusal: fail-closed means no
      // partial DELIVERY either.
      expect(await countInbox(scheduleId)).toBe(0);
    }
  });

  it("refuses schedule B reusing schedule A's message id and creates no run for B", async () => {
    const scheduleA = 'ac010n-cross-a';
    const scheduleB = 'ac010n-cross-b';
    await seedActiveSchedule(scheduleA);
    await seedActiveSchedule(scheduleB);
    const sharedMessageId = 'ac010n-cross-shared-1';

    const deliveredToA = await recordTriggerDelivery(
      tdb.engine,
      delivery(scheduleA, sharedMessageId),
    );
    expect(deliveredToA.outcome).toBe(TriggerDeliveryOutcome.RUN_STARTED);

    await expectForesiftError(
      recordTriggerDelivery(tdb.engine, delivery(scheduleB, sharedMessageId)),
      ErrorCode.WF_TRIGGER_SCHEDULE_MISMATCH,
    );

    expect(await countRuns(scheduleB)).toBe(0);
    expect(await countInbox(scheduleB)).toBe(0);
    // A's delivery is untouched.
    expect(await countRuns(scheduleA)).toBe(1);
    expect(await countInbox(scheduleA)).toBe(1);
  });
});
