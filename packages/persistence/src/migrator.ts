/**
 * Deterministic schema migrator for `migrations/g<generation>_(data|dr)_*.sql`.
 *
 * - Files apply in lexicographic filename order, one transaction each.
 * - Applied state lives in `_foresift_schema_migrations` with a sha256
 *   checksum; re-application skips recorded files (idempotent).
 * - Checksum drift on an already-applied file is a hard refusal (`MIGRATION_CHECKSUM_DRIFT`)
 *   — SQL truth never mutates under an applied id.
 * - A failing migration rolls its own transaction back cleanly, leaving the
 *   previously recorded state intact (`MIGRATION_APPLICATION_FAILED`).
 *
 * Fail-closed defenses (every refusal is a typed `ForesiftError`, never a guess):
 * - A `.sql` file in the migrations directory that matches no known
 *   `<generation>_(data|dr)_<seq>_<name>` family is refused
 *   (`MIGRATION_FILENAME_UNKNOWN`) instead of being silently ignored — a
 *   future-generation script (e.g. `g1_data_…`) is discovered and applied,
 *   never dropped.
 * - A migration id recorded in the database whose file has vanished from disk
 *   refuses (`MIGRATION_FILE_MISSING`) — applied SQL truth must remain
 *   inspectable on disk.
 * - A new (unapplied) migration sorting BEFORE the highest already-applied id
 *   refuses (`MIGRATION_OUT_OF_ORDER_REFUSED`) — filling historical gaps after
 *   later state exists could corrupt schema assumptions.
 * - Concurrent application runs fence against each other through a lease row
 *   in `_foresift_schema_migration_leases`; a second run while a lease is held
 *   refuses (`MIGRATION_APPLY_ALREADY_RUNNING`). Unlike advisory locks the
 *   lease survives process death, so a crashed runner keeps later automatic
 *   runs refused until an operator clears it explicitly with
 *   `clearMigrationLeases` (fail-closed direction; INV-009 fencing).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ErrorCode, ForesiftError } from '@foresift/domain';
import type { DatabaseEngine } from './db.ts';

export const SCHEMA_MIGRATIONS_TABLE = '_foresift_schema_migrations';

/** Single-row-per-key fencing table; rows are leases, not history. */
export const SCHEMA_MIGRATION_LEASES_TABLE = '_foresift_schema_migration_leases';

const MIGRATION_FILE_PATTERN = /^g\d+_(data|dr)_\d{4}_[a-z0-9_]+\.sql$/;

const MIGRATION_LEASE_KEY = 'schema-migrations-apply';

export interface MigrationStatus {
  readonly id: string;
  readonly checksum: string;
}

export interface ApplyReport {
  /** Ids applied by THIS call, in order. */
  readonly applied: readonly string[];
  /** Ids already recorded before this call. */
  readonly skipped: readonly string[];
}

async function ensureStateTable(engine: DatabaseEngine): Promise<void> {
  await engine.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
        id         text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function ensureLeaseTable(engine: DatabaseEngine): Promise<void> {
  await engine.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATION_LEASES_TABLE} (
        lease_key   text PRIMARY KEY,
        owner       text NOT NULL,
        acquired_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Operator-only remediation for a stale lease left behind by a crashed
 * migration runner. Never called by `applyMigrations` itself — clearing the
 * fence of a live concurrent run is exactly what the lease exists to prevent.
 * Returns the number of leases removed.
 */
export async function clearMigrationLeases(engine: DatabaseEngine): Promise<number> {
  await ensureLeaseTable(engine);
  const result = await engine.query(
    `DELETE FROM ${SCHEMA_MIGRATION_LEASES_TABLE} RETURNING lease_key`,
  );
  return result.rows.length;
}

export async function appliedMigrations(
  engine: DatabaseEngine,
): Promise<readonly MigrationStatus[]> {
  const result = await engine.query<{ id: string; checksum: string }>(
    `SELECT id, checksum FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY id`,
  );
  return result.rows.map((r) => ({ id: r.id, checksum: r.checksum }));
}

function checksumOf(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

/**
 * Discover migration files in `dir` (lexicographic order). Every `.sql`
 * entry MUST belong to a known `<generation>_(data|dr)_<4-digit-seq>_<name>`
 * family — anything else is a loud refusal, so a renamed or foreign script
 * can never be silently skipped.
 */
export async function discoverMigrations(
  dir: string,
): Promise<readonly { id: string; file: string; sql: string; checksum: string }[]> {
  const entries = await readdir(dir);
  const unknown = entries.filter((f) => f.endsWith('.sql') && !MIGRATION_FILE_PATTERN.test(f));
  if (unknown.length > 0) {
    throw new ForesiftError(
      ErrorCode.MIGRATION_FILENAME_UNKNOWN,
      `migration directory ${dir} contains .sql files matching no known g<generation>_(data|dr)_<seq>_<name> family: ${unknown.sort().join(', ')}`,
      { dir, unknown: unknown.sort().join(',') },
    );
  }
  const files = entries.filter((f) => MIGRATION_FILE_PATTERN.test(f)).sort();
  const loaded = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    loaded.push({ id: file.replace(/\.sql$/, ''), file, sql, checksum: checksumOf(sql) });
  }
  return loaded;
}

export interface MigratorOptions {
  readonly engine: DatabaseEngine;
  /** Directory containing `g<generation>_(data|dr)_*.sql` scripts. */
  readonly migrationsDir: string;
}

/**
 * Acquire the apply fence for this process run. The insert is atomic: when a
 * lease is already held the INSERT matches nothing and we refuse with the
 * current holder in the detail. Released only by our own `finally` below or
 * by an operator via `clearMigrationLeases`.
 */
async function acquireApplyLease(engine: DatabaseEngine, owner: string): Promise<void> {
  const inserted = await engine.query<{ owner: string }>(
    `INSERT INTO ${SCHEMA_MIGRATION_LEASES_TABLE} (lease_key, owner)
     VALUES ($1, $2)
     ON CONFLICT (lease_key) DO NOTHING
     RETURNING owner`,
    [MIGRATION_LEASE_KEY, owner],
  );
  if (inserted.rows.length === 0) {
    let holder = 'unknown';
    try {
      const current = await engine.query<{ owner: string }>(
        `SELECT owner FROM ${SCHEMA_MIGRATION_LEASES_TABLE} WHERE lease_key = $1`,
        [MIGRATION_LEASE_KEY],
      );
      holder = current.rows[0]?.owner ?? holder;
    } catch {
      // Diagnostics only — the refusal below is the contract.
    }
    throw new ForesiftError(
      ErrorCode.MIGRATION_APPLY_ALREADY_RUNNING,
      `another migration run holds the apply lease (owner ${holder}); ` +
        'if that run crashed, clear it explicitly with clearMigrationLeases()',
      { holder },
    );
  }
}

async function releaseApplyLease(engine: DatabaseEngine, owner: string): Promise<void> {
  await engine.query(
    `DELETE FROM ${SCHEMA_MIGRATION_LEASES_TABLE} WHERE lease_key = $1 AND owner = $2`,
    [MIGRATION_LEASE_KEY, owner],
  );
}

export async function applyMigrations(options: MigratorOptions): Promise<ApplyReport> {
  const { engine, migrationsDir } = options;
  await ensureStateTable(engine);
  await ensureLeaseTable(engine);

  const owner = randomUUID();
  await acquireApplyLease(engine, owner);
  try {
    const recorded = new Map((await appliedMigrations(engine)).map((m) => [m.id, m.checksum]));
    const migrations = await discoverMigrations(migrationsDir);

    // Fail closed on any mutation of already-applied SQL truth…
    for (const migration of migrations) {
      const known = recorded.get(migration.id);
      if (known !== undefined && known !== migration.checksum) {
        throw new ForesiftError(
          ErrorCode.MIGRATION_CHECKSUM_DRIFT,
          `migration ${migration.id} changed after application (checksum mismatch); ` +
            'applied migrations are immutable — add a new migration instead',
          { id: migration.id },
        );
      }
    }

    // …on applied ids whose file disappeared from disk…
    const onDisk = new Set(migrations.map((m) => m.id));
    const vanished = [...recorded.keys()].filter((id) => !onDisk.has(id));
    if (vanished.length > 0) {
      throw new ForesiftError(
        ErrorCode.MIGRATION_FILE_MISSING,
        `recorded migrations missing from ${migrationsDir}: ${vanished.join(', ')}; ` +
          'applied migrations must stay on disk — restore them rather than deleting history',
        { missing: vanished.join(',') },
      );
    }

    // …and on new scripts that would fill a gap behind already-applied state.
    let highestAppliedId: string | undefined;
    for (const id of recorded.keys()) {
      if (highestAppliedId === undefined || id > highestAppliedId) highestAppliedId = id;
    }
    if (highestAppliedId !== undefined) {
      const latecomers = migrations
        .map((m) => m.id)
        .filter((id) => !recorded.has(id) && id < highestAppliedId);
      if (latecomers.length > 0) {
        throw new ForesiftError(
          ErrorCode.MIGRATION_OUT_OF_ORDER_REFUSED,
          `new migration(s) ${latecomers.join(', ')} sort before already-applied ` +
            `${highestAppliedId}; applying them now would run out of order — ` +
            'add the change as a new migration instead',
          { latecomers: latecomers.join(','), highestAppliedId },
        );
      }
    }

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      if (recorded.has(migration.id)) {
        skipped.push(migration.id);
        continue;
      }
      try {
        await engine.transaction(async (tx) => {
          await tx.exec(migration.sql);
          await tx.query(
            `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (id, checksum) VALUES ($1, $2)`,
            [migration.id, migration.checksum],
          );
        });
        applied.push(migration.id);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const failure = new ForesiftError(
          ErrorCode.MIGRATION_APPLICATION_FAILED,
          `migration ${migration.id} failed and was rolled back: ${message}`,
          { id: migration.id },
        );
        failure.cause = cause;
        throw failure;
      }
    }

    return { applied, skipped };
  } finally {
    await releaseApplyLease(engine, owner);
  }
}
