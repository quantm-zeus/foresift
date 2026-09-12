/**
 * AC-013 negative (failure path).
 * Traces: FR-WF-001, FR-WF-004.
 * AC text (manifest §39.2): "Active runs continue with their original
 * immutable config/workflow version after deployment."
 *
 * The immutability law is enforced at the STORAGE layer, not only by the
 * application path: an in-place rewrite of a version's configuration (or an
 * update of any non-supersede column, or a delete) is refused by the SQL
 * trigger. Independently, a run may only pin a version OWNED BY ITS OWN
 * schedule — the composite FK refuses a cross-schedule pin, so a run can never
 * drift onto another schedule's workflow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { applyScheduleControl } from '@foresift/workflow-runtime';
import { WF_TEST_PAYLOAD_HASH_A, WF_TEST_T0 } from '../fixtures/wf/index.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

const T0 = WF_TEST_T0;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

async function createSchedule(scheduleId: string, versionId: string): Promise<void> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
    versionId,
    config: {
      name: `schedule ${scheduleId}`,
      cron: '*/5 * * * *',
      timezone: 'UTC',
      destination: 'https://internal.example.test/wf/trigger',
      concurrencyPolicy: 'ALLOW_PARALLEL',
    },
  });
}

async function insertInbox(scheduleId: string, suffix: string): Promise<string> {
  const inboxId = `ac013n-inbox-${suffix}`;
  await tdb.engine.query(
    `INSERT INTO wf.trigger_inbox
       (inbox_id, source, external_message_id, canonical_external_message_id,
        schedule_id, scheduled_for, payload_hash, received_at, status)
     VALUES ($1, 'qstash', $2, $3, $4, $5, $6, $5, 'VERIFIED')`,
    [
      inboxId,
      `ac013n-msg-${suffix}`,
      `qstash:ac013n-msg-${suffix}`,
      scheduleId,
      T0,
      WF_TEST_PAYLOAD_HASH_A,
    ],
  );
  return inboxId;
}

async function insertRun(input: {
  runId: string;
  scheduleId: string;
  versionId: string;
  inboxId: string;
}): Promise<void> {
  await tdb.engine.query(
    `INSERT INTO wf.runs
       (run_id, schedule_id, resolved_schedule_version, inbox_id,
        trigger_source, trigger_external_message_id,
        trigger_canonical_external_message_id, concurrency_policy,
        concurrency_outcome, shadow, status, deadline)
     VALUES ($1, $2, $3, $4, 'qstash', $5, $6, 'ALLOW_PARALLEL', 'ALLOW_PARALLEL',
             false, 'RUNNING', $7)`,
    [
      input.runId,
      input.scheduleId,
      input.versionId,
      input.inboxId,
      `ac013n-msg-${input.runId}`,
      `qstash:ac013n-msg-${input.runId}`,
      '2026-06-01T13:00:00.000Z',
    ],
  );
}

describe('AC-013 negative: versions are immutable and pins cannot cross schedules', () => {
  it('refuses an in-place version configuration rewrite, identity rewrite, and delete', async () => {
    await createSchedule('ac013n-immutable', 'ac013n-imm-v1');

    const attempts: readonly { readonly label: string; readonly sql: string }[] = [
      {
        label: 'resolved_config',
        sql: `UPDATE wf.schedule_versions SET resolved_config = '{"cron":"* * * * *"}'::jsonb
                WHERE version_id = 'ac013n-imm-v1'`,
      },
      {
        label: 'config_hash',
        sql: `UPDATE wf.schedule_versions
                SET config_hash = 'sha256:${'c'.repeat(64)}'
              WHERE version_id = 'ac013n-imm-v1'`,
      },
      {
        label: 'delete',
        sql: `DELETE FROM wf.schedule_versions WHERE version_id = 'ac013n-imm-v1'`,
      },
    ];

    for (const attempt of attempts) {
      const error = await tdb.engine.query(attempt.sql).then(
        () => null,
        (err: unknown) => err as Error,
      );
      expect(error, `${attempt.label} must be refused`).not.toBeNull();
      expect(error?.message).toMatch(/immutable/);
    }

    // The version row is untouched by the refusals.
    const row = await tdb.engine.query<{ resolved_config: { cron: string } }>(
      `SELECT resolved_config FROM wf.schedule_versions WHERE version_id = 'ac013n-imm-v1'`,
    );
    expect(row.rows[0]?.resolved_config.cron).toBe('*/5 * * * *');
  });

  it("refuses a run pinned to another schedule's version", async () => {
    await createSchedule('ac013n-owner-a', 'ac013n-a-v1');
    await createSchedule('ac013n-owner-b', 'ac013n-b-v1');

    // Control: a run pinned to its OWN schedule's version is accepted.
    const ownInbox = await insertInbox('ac013n-owner-a', 'own');
    await insertRun({
      runId: 'ac013n-run-own',
      scheduleId: 'ac013n-owner-a',
      versionId: 'ac013n-a-v1',
      inboxId: ownInbox,
    });
    const own = await tdb.engine.query<{ resolved_schedule_version: string }>(
      `SELECT resolved_schedule_version FROM wf.runs WHERE run_id = 'ac013n-run-own'`,
    );
    expect(own.rows[0]?.resolved_schedule_version).toBe('ac013n-a-v1');

    // Adversarial: schedule A's run presenting schedule B's version id.
    const crossInbox = await insertInbox('ac013n-owner-a', 'cross');
    const error = await insertRun({
      runId: 'ac013n-run-cross',
      scheduleId: 'ac013n-owner-a',
      versionId: 'ac013n-b-v1',
      inboxId: crossInbox,
    }).then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/foreign key|runs_version_belongs_to_schedule/i);

    const leaked = await tdb.engine.query(
      `SELECT run_id FROM wf.runs WHERE run_id = 'ac013n-run-cross'`,
    );
    expect(leaked.rows).toHaveLength(0);
  });
});
