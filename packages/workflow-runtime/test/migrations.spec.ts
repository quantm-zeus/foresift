/**
 * `wf`-family migration-shape suite (T011, FR-WF-001…004, AC-010, AC-012, AC-013).
 *
 * Applies the whole migration set to a fresh PGlite database and proves the
 * SQL truth the engine will depend on:
 * - both `g2_wf_*` scripts apply cleanly, in order;
 * - `wf.schedule_versions` immutability: exactly one legal transition
 *   (`superseded_by` NULL -> non-null with every other column identical),
 *   everything else — config rewrite (even combined with a legal-looking
 *   supersede), double supersede, NULL-out, DELETE, TRUNCATE — is refused;
 * - the §25.2 inbox identity unique and the `runs.inbox_id` UNIQUE guard
 *   against two runs for one inbox (`runs_dedupe_unique` is asserted
 *   separately as declared defense-in-depth);
 * - a run can never pin a version owned by a different schedule (composite FK);
 * - §25.7 leases are monotonically fenced at the storage layer: a regression
 *   to an OLD fencing token is refused by the BEFORE UPDATE trigger, while an
 *   unchanged token stays legal so a holder can release/extend expiry.
 *   a stale token's guarded release updates zero rows, and a non-positive
 *   token is refused;
 * - §26.5 outbox claim shape and the §25.9/§25.10 CHECKs;
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
    `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, status)
     VALUES ($1, $2, 'SKIP_IF_RUNNING', 'ACTIVE')`,
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

/** Insert a VERIFIED inbox row for `scheduleId`; returns its primary key. */
async function seedInbox(scheduleId: string, tag: string): Promise<string> {
  seq += 1;
  const inboxId = `inbox-${tag}-${seq}`;
  await engine.query(
    `INSERT INTO wf.trigger_inbox
       (inbox_id, source, external_message_id, canonical_external_message_id,
        schedule_id, scheduled_for, payload_hash, received_at, status)
     VALUES ($1, 'qstash', $2, $3, $4, now(), $5, now(), 'VERIFIED')`,
    [inboxId, `msg-${tag}-${seq}`, `qstash:${tag}-${seq}`, scheduleId, HASH],
  );
  return inboxId;
}

/** Insert a run pinning `versionId` for `scheduleId` on `inboxId`. */
function insertRun(
  runId: string,
  scheduleId: string,
  versionId: string,
  inboxId: string,
): Promise<unknown> {
  return engine.query(
    `INSERT INTO wf.runs
       (run_id, schedule_id, resolved_schedule_version, inbox_id,
        trigger_source, trigger_external_message_id,
        trigger_canonical_external_message_id, concurrency_policy,
        concurrency_outcome, shadow, status, deadline)
     VALUES ($1, $2, $3, $4, 'qstash', 'msg', 'qstash:msg',
             'SKIP_IF_RUNNING', 'SKIP_IF_RUNNING', false, 'RUNNING', now())`,
    [runId, scheduleId, versionId, inboxId],
  );
}

/** Seed schedule + inbox + one run; returns the run id. */
async function seedRun(tag: string): Promise<string> {
  seq += 1;
  const { scheduleId, versionId } = await seedSchedule();
  const inboxId = await seedInbox(scheduleId, tag);
  const runId = `run-${tag}-${seq}`;
  await insertRun(runId, scheduleId, versionId, inboxId);
  return runId;
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

  it('refuses a config rewrite combined with a legal-looking supersede', async () => {
    const { versionId, nextVersionId } = await seedSchedule();
    const error = await rejection(
      engine.query(
        `UPDATE wf.schedule_versions
            SET resolved_config = '{"cron":"* * * * *"}'::jsonb,
                superseded_by = $1
          WHERE version_id = $2`,
        [nextVersionId, versionId],
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

  it('refuses TRUNCATE of the version table (FK guard for plain, restrict_violation for CASCADE)', async () => {
    await seedSchedule();
    // Plain TRUNCATE is already refused fail-closed by the incoming FKs
    // (feature_not_supported); CASCADE bypasses that and reaches the wf
    // BEFORE TRUNCATE trigger, which is the guard under test here.
    const plain = await rejection(engine.query(`TRUNCATE wf.schedule_versions`));
    expect((plain as { code?: string }).code).toBe('0A000');

    const error = await rejection(engine.query(`TRUNCATE wf.schedule_versions CASCADE`));
    // 23001 = restrict_violation, the fail-closed class the wf trigger raises.
    expect((error as { code?: string }).code).toBe('23001');
    expect(error.message).toMatch(/schedule versions are immutable/);
    // The witness rows survived the refused truncate.
    const rows = await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM wf.schedule_versions`,
    );
    expect(Number(rows.rows[0]?.n)).toBeGreaterThan(0);
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

  it('declares runs_dedupe_unique on (schedule_id, resolved_schedule_version, inbox_id) as defense-in-depth', async () => {
    const def = await engine.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'runs_dedupe_unique'`,
    );
    const definition = def.rows[0]?.def ?? '';
    // Definition-only: the behavioural one-inbox-one-run guard is the
    // `runs.inbox_id UNIQUE` assertion below; this composite key is declared
    // redundancy (it cannot be the first violation for a same-version retry).
    expect(definition).toContain('schedule_id');
    expect(definition).toContain('resolved_schedule_version');
    expect(definition).toContain('inbox_id');
  });

  it('refuses a second run for one inbox via the runs.inbox_id UNIQUE constraint', async () => {
    const { scheduleId, versionId, nextVersionId } = await seedSchedule();
    const inboxId = await seedInbox(scheduleId, 'run-dedupe');
    await insertRun('run-a', scheduleId, versionId, inboxId);
    // A DIFFERENT resolved version means runs_dedupe_unique cannot fire, so the
    // only guard that can refuse this is UNIQUE (inbox_id).
    const error = await rejection(insertRun('run-b', scheduleId, nextVersionId, inboxId));
    expect(error.message).toMatch(/runs_inbox_id_key/);
    expect(error.message).toMatch(/duplicate key value violates unique constraint/);
  });

  it('refuses a run pinned to a version owned by a different schedule (composite FK)', async () => {
    const first = await seedSchedule();
    const second = await seedSchedule();
    const inboxId = await seedInbox(second.scheduleId, 'cross-version');
    const error = await rejection(
      insertRun('run-cross', second.scheduleId, first.versionId, inboxId),
    );
    expect(error.message).toMatch(/runs_version_belongs_to_schedule/);
    expect((error as { code?: string }).code).toBe('23503'); // foreign_key_violation
  });

  it('refuses a run consuming an inbox row addressed to a different schedule (composite FK)', async () => {
    const first = await seedSchedule();
    const second = await seedSchedule();
    const foreignInbox = await seedInbox(second.scheduleId, 'cross-inbox');
    const error = await rejection(
      insertRun('run-cross-inbox', first.scheduleId, first.versionId, foreignInbox),
    );
    expect(error.message).toMatch(/runs_inbox_belongs_to_schedule/);
    expect((error as { code?: string }).code).toBe('23503'); // foreign_key_violation
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

  it('refuses a fencing-token decrease while allowing an unchanged holder operation (BEFORE UPDATE trigger)', async () => {
    await engine.query(
      `INSERT INTO wf.step_leases (resource_key, owner, expires_at)
       VALUES ('candidate:c4', 'worker-a', now() + interval '1 hour')`,
    );
    const first = await engine.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases WHERE resource_key = 'candidate:c4'`,
    );
    const oldToken = Number(first.rows[0]?.fencing_token);
    await engine.query(
      `UPDATE wf.step_leases
          SET owner = 'worker-b',
              fencing_token = nextval('wf.wf_lease_fencing_seq')
        WHERE resource_key = 'candidate:c4'`,
    );
    const current = await engine.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases WHERE resource_key = 'candidate:c4'`,
    );
    const currentToken = Number(current.rows[0]?.fencing_token);
    expect(currentToken).toBeGreaterThan(oldToken);

    const regression = await rejection(
      engine.query(
        `UPDATE wf.step_leases SET fencing_token = $1 WHERE resource_key = 'candidate:c4'`,
        [oldToken],
      ),
    );
    expect((regression as { code?: string }).code).toBe('23001');
    expect(regression.message).toMatch(/monotonically fenced/);

    // An UNCHANGED token is legal: takeover always allocates a strictly larger
    // token, while an ordinary holder releases/extends expiry without touching
    // it (row-level guard is the `fencing_token = $n` predicate). Refusing
    // equality would make release impossible.
    const released = await engine.query<{ released_at: string | null }>(
      `UPDATE wf.step_leases SET released_at = now()
        WHERE resource_key = 'candidate:c4' AND fencing_token = $1
        RETURNING released_at`,
      [currentToken],
    );
    expect(released.rows).toHaveLength(1);
    expect(released.rows[0]?.released_at).not.toBeNull();

    const extended = await engine.query<{ expires_at: string }>(
      `UPDATE wf.step_leases SET expires_at = expires_at + interval '1 hour'
        WHERE resource_key = 'candidate:c4' AND fencing_token = $1
        RETURNING expires_at`,
      [currentToken],
    );
    expect(extended.rows).toHaveLength(1);

    // The winner's token is untouched by the refused regression or the
    // holder's own release/expiry updates.
    const after = await engine.query<{ fencing_token: string }>(
      `SELECT fencing_token FROM wf.step_leases WHERE resource_key = 'candidate:c4'`,
    );
    expect(Number(after.rows[0]?.fencing_token)).toBe(currentToken);
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

describe('§26.5 outbox claim shape and §25.9/§25.10 CHECKs', () => {
  const CLAIM_EXPIRES = '2030-01-01T00:00:00.000Z';

  /** Insert an outbox row with an explicit claim shape. */
  function insertOutbox(
    outboxId: string,
    shape: {
      status: string;
      owner: string | null;
      token: number | null;
      expiresAt: string | null;
    },
  ): Promise<unknown> {
    return engine.query(
      `INSERT INTO wf.notification_outbox
         (outbox_id, decision_ref, channel, payload_hash, status,
          claim_owner, claim_fencing_token, claim_expires_at)
       VALUES ($1, $2, 'telegram', $3, $4, $5, $6, $7)`,
      [
        outboxId,
        `decision-${outboxId}`,
        HASH,
        shape.status,
        shape.owner,
        shape.token,
        shape.expiresAt,
      ],
    );
  }

  it('refuses CLAIMED with a NULL claim_owner', async () => {
    const error = await rejection(
      insertOutbox('outbox-null-owner', {
        status: 'CLAIMED',
        owner: null,
        token: 1,
        expiresAt: CLAIM_EXPIRES,
      }),
    );
    expect(error.message).toMatch(/notification_outbox_claim_shape/);
  });

  it('refuses CLAIMED with a NULL claim_fencing_token', async () => {
    const error = await rejection(
      insertOutbox('outbox-null-token', {
        status: 'CLAIMED',
        owner: 'worker-a',
        token: null,
        expiresAt: CLAIM_EXPIRES,
      }),
    );
    expect(error.message).toMatch(/notification_outbox_claim_shape/);
  });

  it('refuses CLAIMED with a NULL claim_expires_at', async () => {
    const error = await rejection(
      insertOutbox('outbox-null-expiry', {
        status: 'CLAIMED',
        owner: 'worker-a',
        token: 1,
        expiresAt: null,
      }),
    );
    expect(error.message).toMatch(/notification_outbox_claim_shape/);
  });

  it('accepts a fully-shaped CLAIMED row and a PENDING row with no claim', async () => {
    await insertOutbox('outbox-claimed', {
      status: 'CLAIMED',
      owner: 'worker-a',
      token: 1,
      expiresAt: CLAIM_EXPIRES,
    });
    await insertOutbox('outbox-pending', {
      status: 'PENDING',
      owner: null,
      token: null,
      expiresAt: null,
    });
    const rows = await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM wf.notification_outbox
        WHERE outbox_id IN ('outbox-claimed', 'outbox-pending')`,
    );
    expect(Number(rows.rows[0]?.n)).toBe(2);
  });

  it('refuses a dead letter with an invalid status', async () => {
    const runId = await seedRun('dead-letter');
    const error = await rejection(
      engine.query(
        `INSERT INTO wf.dead_letters
           (dead_letter_id, run_id, error_class, context, status, opened_at)
         VALUES ('dead-letter-bad', $1, 'TIMEOUT_OR_5XX', '{}'::jsonb, 'BOGUS', now())`,
        [runId],
      ),
    );
    expect(error.message).toMatch(/status/);
  });

  it('refuses a reconciliation report missing checked_at', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO wf.reconciliation_reports (report_id, diff, incident_refs)
         VALUES ('report-bad', '{}'::jsonb, '{}'::text[])`,
      ),
    );
    expect(error.message).toMatch(/checked_at/);
  });
});
