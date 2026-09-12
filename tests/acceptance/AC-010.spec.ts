/**
 * AC-010 acceptance (positive).
 * Traces: FR-WF-001, FR-WF-002.
 * AC text (manifest §39.2): "Duplicate scheduler deliveries create exactly one
 * logical run."
 *
 * The §25.3 pipeline resolves an external delivery to exactly one logical run
 * on real SQL (PGlite): a double/triple redelivery and a concurrent
 * `Promise.all` race of the SAME message id converge on one run and one inbox
 * row, DISTINCT message ids still create distinct runs, and a §25.6
 * `SKIP_IF_RUNNING` policy skip is recorded distinctly from a duplicate
 * collapse (its own CANCELLED run row, never a second live run).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  TriggerDeliveryOutcome,
  applyScheduleControl,
  recordTriggerDelivery,
  type RecordTriggerDeliveryInput,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_T0,
  WF_TRIGGER_ENVELOPES,
} from '../fixtures/wf/index.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T0 = WF_TEST_T0;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

/** CREATE + ENABLE an ACTIVE schedule at `scheduleId`. */
async function seedActiveSchedule(
  scheduleId: string,
  concurrencyPolicy: 'ALLOW_PARALLEL' | 'SKIP_IF_RUNNING' = 'ALLOW_PARALLEL',
): Promise<void> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
    config: {
      name: `schedule ${scheduleId}`,
      cron: '*/5 * * * *',
      timezone: 'UTC',
      destination: 'https://internal.example.test/wf/trigger',
      concurrencyPolicy,
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

describe('AC-010: duplicate deliveries collapse to exactly one logical run', () => {
  it('collapses double and triple redelivery of one message id to one run and one inbox row', async () => {
    const scheduleId = 'ac010-sched-repeat';
    await seedActiveSchedule(scheduleId);
    const messageId = WF_TRIGGER_ENVELOPES.VALID.messageId;

    const first = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, messageId));
    const second = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, messageId));
    const third = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, messageId));

    expect(first.statusCode).toBe(202);
    expect(first.outcome).toBe(TriggerDeliveryOutcome.RUN_STARTED);
    expect(first.duplicate).toBe(false);
    expect(first.runId).not.toBeNull();

    for (const collapse of [second, third]) {
      expect(collapse.outcome).toBe(TriggerDeliveryOutcome.DUPLICATE_COLLAPSED);
      expect(collapse.duplicate).toBe(true);
      expect(collapse.inboxId).toBe(first.inboxId);
      expect(collapse.runId).toBe(first.runId);
    }

    expect(await countRuns(scheduleId)).toBe(1);
    expect(await countInbox(scheduleId)).toBe(1);
    const inbox = await tdb.engine.query<{ status: string; processed_run_id: string | null }>(
      `SELECT status, processed_run_id FROM wf.trigger_inbox WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(inbox.rows[0]?.processed_run_id).toBe(first.runId);
    expect(inbox.rows[0]?.status).toBe('DUPLICATE_COLLAPSED');
  });

  it('converges a concurrent Promise.all race of the SAME message id to one run and one inbox row', async () => {
    const scheduleId = 'ac010-sched-race';
    await seedActiveSchedule(scheduleId);
    const messageId = 'ac010-race-message-1';

    const results = await Promise.all([
      recordTriggerDelivery(tdb.engine, delivery(scheduleId, messageId)),
      recordTriggerDelivery(tdb.engine, delivery(scheduleId, messageId)),
      recordTriggerDelivery(tdb.engine, delivery(scheduleId, messageId)),
    ]);

    const runIds = new Set(results.map((r) => r.runId));
    expect(runIds.size).toBe(1);
    expect([...runIds][0]).not.toBeNull();
    // Exactly one delivery started the run; every other observed the identity
    // already processed.
    expect(results.filter((r) => r.outcome === TriggerDeliveryOutcome.RUN_STARTED)).toHaveLength(1);
    expect(
      results.filter((r) => r.outcome === TriggerDeliveryOutcome.DUPLICATE_COLLAPSED),
    ).toHaveLength(2);

    expect(await countRuns(scheduleId)).toBe(1);
    expect(await countInbox(scheduleId)).toBe(1);
  });

  it('creates distinct runs for distinct message ids', async () => {
    const scheduleId = 'ac010-sched-distinct';
    await seedActiveSchedule(scheduleId);

    const first = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'ac010-distinct-1'));
    const second = await recordTriggerDelivery(
      tdb.engine,
      delivery(scheduleId, 'ac010-distinct-2'),
    );

    expect(first.outcome).toBe(TriggerDeliveryOutcome.RUN_STARTED);
    expect(second.outcome).toBe(TriggerDeliveryOutcome.RUN_STARTED);
    expect(first.runId).not.toBe(second.runId);
    expect(await countRuns(scheduleId)).toBe(2);
    expect(await countInbox(scheduleId)).toBe(2);
  });

  it('records a SKIP_IF_RUNNING policy skip distinctly from a duplicate collapse', async () => {
    const scheduleId = 'ac010-sched-skip';
    await seedActiveSchedule(scheduleId, 'SKIP_IF_RUNNING');

    const first = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'ac010-skip-1'));
    const skipped = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'ac010-skip-2'));
    const collapse = await recordTriggerDelivery(tdb.engine, delivery(scheduleId, 'ac010-skip-1'));

    expect(first.outcome).toBe(TriggerDeliveryOutcome.RUN_STARTED);
    // The policy skip is NOT a duplicate: a distinct delivery under the active
    // run, recorded with its own (cancelled) run row.
    expect(skipped.outcome).toBe(TriggerDeliveryOutcome.POLICY_SKIPPED);
    expect(skipped.duplicate).toBe(false);
    expect(skipped.runId).not.toBe(first.runId);

    const skippedRun = await tdb.engine.query<{ status: string; concurrency_outcome: string }>(
      `SELECT status, concurrency_outcome FROM wf.runs WHERE run_id = $1`,
      [skipped.runId],
    );
    expect(skippedRun.rows[0]?.status).toBe('CANCELLED');
    expect(skippedRun.rows[0]?.concurrency_outcome).toBe('SKIP_IF_RUNNING');

    // The redelivery of the original id collapses onto the original run.
    expect(collapse.outcome).toBe(TriggerDeliveryOutcome.DUPLICATE_COLLAPSED);
    expect(collapse.duplicate).toBe(true);
    expect(collapse.runId).toBe(first.runId);

    // Two run rows total: one live RUN_STARTED, one recorded policy skip.
    expect(await countRuns(scheduleId)).toBe(2);
    expect(await countInbox(scheduleId)).toBe(2);
  });
});
