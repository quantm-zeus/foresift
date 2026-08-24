/**
 * Deterministic schema migrator for `migrations/g0_(data|dr)_*.sql`.
 *
 * - Files apply in lexicographic filename order, one transaction each.
 * - Applied state lives in `_foresift_schema_migrations` with a sha256
 *   checksum; re-application skips recorded files (idempotent).
 * - Checksum drift on an already-applied file is a hard refusal — SQL truth
 *   never mutates under an applied id.
 * - A failing migration rolls its own transaction back cleanly, leaving the
 *   previously recorded state intact.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseEngine } from './db.ts';

export const SCHEMA_MIGRATIONS_TABLE = '_foresift_schema_migrations';

const MIGRATION_FILE_PATTERN = /^g0_(data|dr)_\d{4}_[a-z0-9_]+\.sql$/;

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

/** Discover and validate migration files in `dir` (lexicographic order). */
export async function discoverMigrations(
  dir: string,
): Promise<readonly { id: string; file: string; sql: string; checksum: string }[]> {
  const entries = await readdir(dir);
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
  /** Directory containing `g0_(data|dr)_*.sql` scripts. */
  readonly migrationsDir: string;
}

export async function applyMigrations(options: MigratorOptions): Promise<ApplyReport> {
  const { engine, migrationsDir } = options;
  await ensureStateTable(engine);

  const recorded = new Map((await appliedMigrations(engine)).map((m) => [m.id, m.checksum]));
  const migrations = await discoverMigrations(migrationsDir);

  // Fail closed on any mutation of already-applied SQL truth.
  for (const migration of migrations) {
    const known = recorded.get(migration.id);
    if (known !== undefined && known !== migration.checksum) {
      throw new Error(
        `migration ${migration.id} changed after application (checksum mismatch); ` +
          'applied migrations are immutable — add a new migration instead',
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
        await tx.query(`INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (id, checksum) VALUES ($1, $2)`, [
          migration.id,
          migration.checksum,
        ]);
      });
      applied.push(migration.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`migration ${migration.id} failed and was rolled back: ${message}`, {
        cause,
      });
    }
  }

  return { applied, skipped };
}
