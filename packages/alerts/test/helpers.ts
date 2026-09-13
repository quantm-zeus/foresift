/**
 * PGlite bootstrap + seed fixtures for the alert classification suite (T018).
 *
 * Mirrors the workflow-runtime engine-core helper: a fresh in-process PGlite
 * database with the full migration set applied (PGlite is the deterministic TEST
 * engine only, ADR-0014), plus the minimal FK-complete `wf` graph needed to
 * commit an alert through the engine boundary.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

export const HASH_A = `sha256:${'a'.repeat(64)}`;
export const HASH_B = `sha256:${'b'.repeat(64)}`;
export const HASH_C = `sha256:${'c'.repeat(64)}`;

export interface TestDatabase {
  readonly db: PGlite;
  readonly engine: DatabaseEngine;
}

/** Fresh database with every migration applied. */
export async function makeTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine };
}

export async function closeTestDatabase(tdb: TestDatabase): Promise<void> {
  await tdb.db.close();
}

/** Run `work` against a throwaway migrated database, then close it. */
export async function withTestDatabase<T>(work: (tdb: TestDatabase) => Promise<T>): Promise<T> {
  const tdb = await makeTestDatabase();
  try {
    return await work(tdb);
  } finally {
    await closeTestDatabase(tdb);
  }
}

/** The promise must reject with an error carrying exactly `code`. */
export async function expectForesiftError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const actual = err as { code?: string; name?: string };
    if (actual.code !== code) {
      throw new Error(
        `expected ForesiftError ${code}, got ${actual.name}: ${(err as Error).message}`,
      );
    }
    return;
  }
  throw new Error(`expected rejection with ForesiftError ${code}, but the call resolved`);
}

let sequence = 0;

/** Insert an FK-complete `wf` run (schedule + version + inbox + run). */
export async function seedRun(
  engine: DatabaseEngine,
  options: { readonly shadow?: boolean; readonly status?: string } = {},
): Promise<string> {
  sequence += 1;
  const tag = sequence;
  const scheduleId = `sched-alert-${tag}`;
  const versionId = `version-alert-${tag}`;
  const inboxId = `inbox-alert-${tag}`;
  const runId = `run-alert-${tag}`;
  const now = new Date().toISOString();
  const config = {
    name: `alert fixture schedule ${tag}`,
    cron: '*/5 * * * *',
    timezone: 'UTC',
    destination: `local://internal/schedules/${scheduleId}`,
    concurrencyPolicy: 'SKIP_IF_RUNNING',
    workloadKind: 'CANDIDATE_RECHECK',
    shadow: options.shadow ?? false,
  };
  await engine.query(
    `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, status)
     VALUES ($1, $2, $3, 'ACTIVE')`,
    [scheduleId, config.name, config.concurrencyPolicy],
  );
  await engine.query(
    `INSERT INTO wf.schedule_versions
       (version_id, schedule_id, config_hash, resolved_config, shadow)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [versionId, scheduleId, HASH_A, JSON.stringify(config), config.shadow],
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
    [inboxId, `msg-alert-${tag}`, `qstash:alert-${tag}`, scheduleId, now, HASH_A],
  );
  await engine.query(
    `INSERT INTO wf.runs
       (run_id, schedule_id, resolved_schedule_version, inbox_id,
        trigger_source, trigger_external_message_id,
        trigger_canonical_external_message_id, concurrency_policy,
        concurrency_outcome, shadow, status, deadline)
     VALUES ($1, $2, $3, $4, 'qstash', $5, $6,
             $7, $7, $8, $9, $10)`,
    [
      runId,
      scheduleId,
      versionId,
      inboxId,
      `msg-${runId}`,
      `qstash:${runId}`,
      config.concurrencyPolicy,
      config.shadow,
      options.status ?? 'RUNNING',
      new Date(Date.now() + 3_600_000).toISOString(),
    ],
  );
  return runId;
}

export interface SeedPolicyInput {
  readonly policyId: string;
  readonly alertClass: string;
  readonly version: number;
  readonly ttlSeconds: number;
  readonly cooldownSeconds?: number;
  readonly highConvictionAllowed?: boolean;
  readonly confirmedDenominatorMember?: boolean;
  readonly config?: Record<string, unknown>;
  readonly thresholds?: Record<string, unknown>;
}

/** Insert one immutable `alert.alert_policies` version row. */
export async function seedPolicyRow(engine: DatabaseEngine, input: SeedPolicyInput): Promise<void> {
  await engine.query(
    `INSERT INTO alert.alert_policies
       (policy_id, alert_class, version, config_hash, config, ttl_seconds,
        cooldown_seconds, high_conviction_allowed, confirmed_denominator,
        thresholds, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      input.policyId,
      input.alertClass,
      input.version,
      HASH_B,
      JSON.stringify(input.config ?? { contentPolicyVersion: 1, template: input.alertClass }),
      input.ttlSeconds,
      input.cooldownSeconds ?? 60,
      input.highConvictionAllowed ?? false,
      input.confirmedDenominatorMember ?? false,
      JSON.stringify(input.thresholds ?? {}),
      new Date().toISOString(),
    ],
  );
}
