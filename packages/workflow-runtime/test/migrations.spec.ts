/**
 * `wf`-family migration-shape suite (T011, FR-WF-001…004, AC-010, AC-012, AC-013).
 *
 * Applies the whole migration set to a fresh PGlite database and proves the
 * SQL truth the engine will depend on:
 * - both `g2_wf_*` scripts apply cleanly, in order;
 * - `wf.schedule_versions` immutability: exactly one legal transition
 *   (`superseded_by` NULL -> non-null with every other column identical),
 *   everything else — config rewrite, double supersede, NULL-out, DELETE —
 *   is refused;
 * - the §25.2 inbox identity unique and the run dedupe key;
 * - monotonically fenced leases: a stale token's guarded release updates zero
 *   rows, and a non-positive token is refused;
 * - no workflow table exists unqualified in `public` (ADR-G2WF-1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const WF_TABLES = [
  'dead_letters',
  'notification_outbox',
  'reconciliation_reports',
  'runs',
  'schedule_versions',
  'schedules',
  'step_leases',
  'steps',
  'trigger_inbox',
] as const;

let db: PGlite;
let engine: DatabaseEngine;
let applied: readonly string[];
let seq = 0;

/** Capture a rejection so the assertion can inspect the message. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('expected the statement to be refused, but it succeeded');
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  applied = report.applied;
}, 120_000);

afterAll(async () => {
  await db.close();
});

/** Insert a schedule + two versions; returns their ids. */
async function seedSchedule(): Promise<{
  scheduleId: string;
  versionId: string;
  nextVersionId: string;
}> {
  seq += 1;
  const scheduleId = `sched-${seq}`;
  const versionId = `version-${seq}-1`;
  const nextVersionId = `version-${seq}-2`;
  await engine.query(
    `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, active)
     VALUES ($1, $2, 'SKIP_IF_RUNNING', true)`,
    [scheduleId, `schedule ${seq}`],
  );
  for (const [version, hash] of [
    [versionId, HASH],
    [nextVersionId, HASH_B],
  ] as const) {
    await engine.query(
      `INSERT INTO wf.schedule_versions
         (version_id, schedule_id, config_hash, resolved_config, shadow)
       VALUES ($1, $2, $3, $4::jsonb, false)`,
      [version, scheduleId, hash, JSON.stringify({ cron: '*/5 * * * *' })],
    );
  }
  return { scheduleId, versionId, nextVersionId };
}

describe('g2_wf_* migrations apply to a fresh database', () => {
  it('applies both wf scripts in lexicographic order', () => {
    expect(applied).toContain('g2_wf_0001_schedules_runs');
    expect(applied).toContain('g2_wf_0002_outbox_deadletter');
    expect(applied.indexOf('g2_wf_0001_schedules_runs')).toBeLessThan(
      applied.indexOf('g2_wf_0002_outbox_deadletter'),
    );
  });

  it('creates every wf table in the wf schema and none in public', async () => {
    const rows = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'wf' ORDER BY table_name`,
    );
    expect(rows.rows.map((r) => r.table_name).sort()).toEqual([...WF_TABLES]);

    const leaked = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN (
         'schedules','schedule_versions','trigger_inbox','runs','steps',
         'step_leases','notification_outbox','dead_letters','reconciliation_reports')`,
    );
    expect(leaked.rows).toEqual([]);
  });

  it('creates the dedicated fencing sequence', async () => {
    const rows = await engine.query<{ sequence_name: string }>(
      `SELECT sequence_name FROM information_schema.sequences
       WHERE sequence_schema = 'wf' AND sequence_name = 'wf_lease_fencing_seq'`,
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe('§25.11 schedule versions are immutable except one supersede pointer', () => {
  it('allows exactly the NULL -> non-null supersede transition', async () => {
    const { versionId, nextVersionId } = await seedSchedule();
    await engine.query(`UPDATE wf.schedule_versions SET superseded_by = $1 WHERE version_id = $2`, [
      nextVersionId,
      versionId,
    ]);
    const rows = await engine.query<{ superseded_by: string | null }>(
      `SELECT superseded_by FROM wf.schedule_versions WHERE version_id = $1`,
      [versionId],
    );
    expect(rows.rows[0]?.superseded_by).toBe(nextVersionId);
  });

  it('refuses an in-place config rewrite', async () => {
    const { versionId } = await seedSchedule();
    const error = await rejection(
      engine.query(
        `UPDATE wf.schedule_versions SET resolved_config = '{"cron":"* * * * *"}'::jsonb
         WHERE version_id = $1`,
        [versionId],
      ),
    );
    expect(error.message).toMatch(/schedule versions are immutable/);
  });

  it('refuses re-pointing an already-set supersede pointer', async () => {
    const { versionId, nextVersionId } = await seedSchedule();
    await engine.query(`UPDATE wf.schedule_versions SET superseded_by = $1 WHERE version_id = $2`, [
      nextVersionId,
      versionId,
    ]);
    const error = await rejection(
      engine.query(
        `UPDATE wf.schedule_versions SET superseded_by = 'version-later' WHERE version_id = $1`,
        [versionId],
      ),
    );
    expect(error.message).toMatch(/schedule versions are immutable/);
  });

  it('refuses clearing a supersede pointer back to NULL', async () => {
    const { versionId } = await seedSchedule();
    const error = await rejection(
      engine.query(`UPDATE wf.schedule_versions SET superseded_by = NULL WHERE version_id = $1`, [
        versionId,
      ]),
    );
    expect(error.message).toMatch(/schedule versions are immutable/);
  });

  it('refuses DELETE of a version row', async () => {
    const { versionId } = await seedSchedule();
    const error = await rejection(
      engine.query(`DELETE FROM wf.schedule_versions WHERE version_id = $1`, [versionId]),
    );
    expect(error.message).toMatch(/schedule versions are immutable/);
  });
});

describe('§25.2 inbox identity and the run dedupe key', () => {
  it('refuses a duplicate (source, canonical_external_message_id)', async () => {
    const { scheduleId } = await seedSchedule();
    const insert = (inboxId: string): Promise<unknown> =>
      engine.query(
        `INSERT INTO wf.trigger_inbox
           (inbox_id, source, external_message_id, canonical_external_message_id,
            schedule_id, scheduled_for, payload_hash, received_at, status)
         VALUES ($1, 'qstash', $2, 'qstash:canonical-1', $3, now(), $4, now(), 'RECEIVED')`,
        [inboxId, `msg-${inboxId}`, scheduleId, HASH],
      );
    await insert('inbox-a');
    const error = await rejection(insert('inbox-b'));
    expect(error.message).toMatch(/duplicate key value violates unique constraint/);
  });

  it('pins the dedupe key to (schedule_id, resolved_schedule_version, inbox_id)', async () => {
    const def = await engine.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'runs_dedupe_unique'`,
    );
    const definition = def.rows[0]?.def ?? '';
    expect(definition).toContain('schedule_id');
    expect(definition).toContain('resolved_schedule_version');
    expect(definition).toContain('inbox_id');
  });

  it('refuses a duplicate run insert (dedupe key / unique inbox)', async () => {
    const { scheduleId, versionId } = await seedSchedule();
    await engine.query(
      `INSERT INTO wf.trigger_inbox
         (inbox_id, source, external_message_id, canonical_external_message_id,
          schedule_id, scheduled_for, payload_hash, received_at, status)
       VALUES ('inbox-run-1', 'qstash', 'msg-run-1', 'qstash:run-1', $1, now(), $2, now(), 'VERIFIED')`,
      [scheduleId, HASH],
    );
    const insertRun = (runId: string): Promise<unknown> =>
      engine.query(
        `INSERT INTO wf.runs
           (run_id, schedule_id, resolved_schedule_version, inbox_id,
            trigger_source, trigger_external_message_id,
            trigger_canonical_external_message_id, concurrency_policy,
            concurrency_outcome, shadow, status, deadline)
         VALUES ($1, $2, $3, 'inbox-run-1', 'qstash', 'msg-run-1', 'qstash:run-1',
                 'SKIP_IF_RUNNING', 'SKIP_IF_RUNNING', false, 'RUNNING', now())`,
        [runId, scheduleId, versionId],
      );
    await insertRun('run-1');
    const error = await rejection(insertRun('run-2'));
    expect(error.message).toMatch(/duplicate key value violates unique constraint/);
  });
});

describe('§25.7 step leases are monotonically fenced', () => {
  it('allocates a fresh, strictly larger token on takeover', async () => {
    await engine.query(
      `INSERT INTO wf.step_leases (resource_key, owner, expires_at)
       VALUES ('candidate:c1', 'worker-a', now() + interval '1 hour')`,
    );
    const first = await engine.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases WHERE resource_key = 'candidate:c1'`,
    );
    await engine.query(
      `UPDATE wf.step_leases
         SET owner = 'worker-b',
             fencing_token = nextval('wf.wf_lease_fencing_seq'),
             acquired_at = now(),
             expires_at = now() + interval '1 hour'
       WHERE resource_key = 'candidate:c1'`,
    );
    const second = await engine.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases WHERE resource_key = 'candidate:c1'`,
    );
    expect(Number(second.rows[0]?.fencing_token)).toBeGreaterThan(
      Number(first.rows[0]?.fencing_token),
    );
  });

  it('a stale token release updates zero rows (commit-time refusal)', async () => {
    await engine.query(
      `INSERT INTO wf.step_leases (resource_key, owner, expires_at)
       VALUES ('candidate:c2', 'worker-a', now() + interval '1 hour')`,
    );
    const stale = await engine.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases WHERE resource_key = 'candidate:c2'`,
    );
    await engine.query(
      `UPDATE wf.step_leases
         SET owner = 'worker-b',
             fencing_token = nextval('wf.wf_lease_fencing_seq')
       WHERE resource_key = 'candidate:c2'`,
    );
    const released = await engine.query(
      `UPDATE wf.step_leases SET released_at = now()
       WHERE resource_key = 'candidate:c2' AND fencing_token = $1`,
      [Number(stale.rows[0]?.fencing_token)],
    );
    expect(released.rows).toHaveLength(0);
    const current = await engine.query<{ released_at: string | null }>(
      `SELECT released_at FROM wf.step_leases WHERE resource_key = 'candidate:c2'`,
    );
    expect(current.rows[0]?.released_at).toBeNull();
  });

  it('refuses a non-positive fencing token', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO wf.step_leases (resource_key, owner, fencing_token, expires_at)
         VALUES ('candidate:c3', 'worker-a', 0, now() + interval '1 hour')`,
      ),
    );
    expect(error.message).toMatch(/fencing_token/);
  });
});
