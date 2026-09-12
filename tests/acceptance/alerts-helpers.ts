/**
 * Shared bootstrap for the alert acceptance/negative suites (T028-T030).
 *
 * The manifest-declared `tests/acceptance/helpers.ts` owns the PGlite
 * bootstrap; this module adds only the FK-complete `wf` run seed the alert
 * commit path needs (`commitAlert` → `commitDecisionWithOutbox`), plus small
 * row-count/code helpers. It is inert with respect to product packages: every
 * statement is test-only arrangement against the migrated test database.
 */
import type { DatabaseEngine } from '@foresift/persistence';
import { ALERT_HASH_A } from '../fixtures/alerts/index.ts';

let runSequence = 0;

/** Insert an FK-complete `wf` run and return its id. */
export async function seedAlertRun(engine: DatabaseEngine): Promise<string> {
  runSequence += 1;
  const tag = runSequence;
  const scheduleId = `sched-acalert-${tag}`;
  const versionId = `version-acalert-${tag}`;
  const inboxId = `inbox-acalert-${tag}`;
  const runId = `run-acalert-${tag}`;
  const now = '2026-06-01T12:00:00.000Z';
  const config = {
    name: `alert acceptance schedule ${tag}`,
    cron: '*/5 * * * *',
    timezone: 'UTC',
    destination: `local://internal/schedules/${scheduleId}`,
    concurrencyPolicy: 'SKIP_IF_RUNNING',
    workloadKind: 'CANDIDATE_RECHECK',
    shadow: false,
  };
  await engine.query(
    `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [scheduleId, config.name, config.concurrencyPolicy],
  );
  await engine.query(
    `INSERT INTO wf.schedule_versions
       (version_id, schedule_id, config_hash, resolved_config, shadow)
     VALUES ($1, $2, $3, $4::jsonb, false)`,
    [versionId, scheduleId, ALERT_HASH_A, JSON.stringify(config)],
  );
  await engine.query(`UPDATE wf.schedules SET current_version_id = $1 WHERE schedule_id = $2`, [
    versionId,
    scheduleId,
  ]);
  await engine.query(
    `INSERT INTO wf.trigger_inbox
       (inbox_id, source, external_message_id, canonical_external_message_id,
        schedule_id, scheduled_for, payload_hash, received_at, status)
     VALUES ($1, 'qstash', $2, $3, $4, $5, $6, $5, 'VERIFIED')`,
    [inboxId, `msg-acalert-${tag}`, `qstash:acalert-${tag}`, scheduleId, now, ALERT_HASH_A],
  );
  await engine.query(
    `INSERT INTO wf.runs
       (run_id, schedule_id, resolved_schedule_version, inbox_id,
        trigger_source, trigger_external_message_id,
        trigger_canonical_external_message_id, concurrency_policy,
        concurrency_outcome, shadow, status, deadline)
     VALUES ($1, $2, $3, $4, 'qstash', $5, $6, $7, $7, false, 'RUNNING', $8)`,
    [
      runId,
      scheduleId,
      versionId,
      inboxId,
      `msg-${runId}`,
      `qstash:${runId}`,
      config.concurrencyPolicy,
      '2026-06-01T18:00:00.000Z',
    ],
  );
  return runId;
}

/** Count rows returned by a `count(*)::int` query. */
export async function countAlertRows(
  engine: DatabaseEngine,
  sql: string,
  params: readonly unknown[] = [],
): Promise<number> {
  const result = await engine.query<{ count: number }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

/** Assert a synchronous throw carries exactly `code`. */
export function expectAlertCodeSync(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    const actual = error as { code?: string; name?: string };
    if (actual.code !== code) {
      throw new Error(
        `expected ForesiftError ${code}, got ${actual.name}: ${(error as Error).message}`,
      );
    }
    return;
  }
  throw new Error(`expected a synchronous refusal with ForesiftError ${code}`);
}
