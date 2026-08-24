/**
 * Shared bootstrap for the manifest-declared acceptance/negative suites
 * (T049–T062). Each suite gets a fresh in-process PGlite database with the ten
 * G0 migrations applied — PGlite is the deterministic TEST engine only
 * (ADR-0009); production remains real PostgreSQL per product ADR-001.
 */
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { parseChainId, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  ensureChain,
  insertDex,
  insertPool,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  replayObservations,
  type DatabaseEngine,
} from '@foresift/persistence';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

export interface TestDatabase {
  readonly db: PGlite;
  readonly engine: DatabaseEngine;
}

/** Fresh database, all G0 migrations applied. */
export async function makeTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine };
}

export async function closeTestDatabase(tdb: TestDatabase): Promise<void> {
  await tdb.db.close();
}

/**
 * Create the chain/dex/pool identity chain so observations may reference
 * `subject_pool_id` (the FK graph requires all three to exist).
 */
export async function seedPool(
  engine: DatabaseEngine,
  input: { chainId: string; dexId: string; poolAddress: string },
): Promise<string> {
  await ensureChain(engine, input.chainId);
  await insertDex(engine, input.chainId, input.dexId);
  const poolId = await insertPool(engine, {
    chainId: parseChainId(input.chainId),
    dexId: input.dexId,
    poolAddress: input.poolAddress,
  });
  return poolId;
}

/**
 * The promise must reject with a ForesiftError carrying exactly `code`
 * (fail-closed refusals are typed — a bare Error is not acceptable evidence).
 */
export async function expectForesiftError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const actual = err as { code?: string; name?: string };
    expect(
      actual.code,
      `expected ForesiftError ${code}, got ${actual.name}: ${(err as Error).message}`,
    ).toBe(code);
    return;
  }
  throw new Error(`expected rejection with ForesiftError ${code}, but the call resolved`);
}

// --- AC-060 benchmark substrate (T058) ---------------------------------------

/** Generous in-process budgets: CI machines vary; regressions show up as 10x+ deltas. */
export const IDENTITY_LOOKUP_BUDGET_MS = 250;
export const REPLAY_READ_BUDGET_MS = 500;
export const BENCHMARK_ITERATIONS = 20;

export interface BenchmarkResult {
  readonly iterations: number;
  /** Worst observed wall-clock duration in ms. */
  readonly worstMs: number;
  readonly withinBudget: boolean;
}

export interface BenchmarkOutcome {
  readonly identity: BenchmarkResult;
  readonly replay: BenchmarkResult;
}

/**
 * Run the AC-060 fixture benchmark over the two persistence hot paths this
 * package owns — identity lookup (chain→dex→pool through the repo seam) and a
 * full replay read at a fixed boundary — and report budget verdicts.
 */
export async function runPersistenceBenchmark(
  engine: DatabaseEngine,
  input: { chainId: string; dexId: string; poolAddress: string },
): Promise<BenchmarkOutcome> {
  const replayAt: UtcTimestamp = utcTimestamp('2026-06-01T10:00:00Z');
  const identityTimes: number[] = [];
  const replayTimes: number[] = [];

  for (let i = 0; i < BENCHMARK_ITERATIONS; i += 1) {
    const idStart = performance.now();
    await ensureChain(engine, input.chainId);
    await insertDex(engine, input.chainId, input.dexId);
    await insertPool(engine, {
      chainId: parseChainId(input.chainId),
      dexId: input.dexId,
      poolAddress: input.poolAddress,
    });
    identityTimes.push(performance.now() - idStart);

    const replayStart = performance.now();
    const resolved = await replayObservations(engine, replayAt);
    if (resolved.length === 0) throw new Error('benchmark workload must resolve observations');
    replayTimes.push(performance.now() - replayStart);
  }

  const result = (times: number[], budget: number): BenchmarkResult => ({
    iterations: times.length,
    worstMs: Math.max(...times),
    withinBudget: Math.max(...times) <= budget,
  });
  return {
    identity: result(identityTimes, IDENTITY_LOOKUP_BUDGET_MS),
    replay: result(replayTimes, REPLAY_READ_BUDGET_MS),
  };
}

// --- Destructive-drill restore loader (T060, AC-062/AC-260/AC-263) -----------

/**
 * Physically load a captured deterministic snapshot into a target engine —
 * the "restore" step of the destructive drill. Rows are inserted verbatim
 * from the canonical row JSON under `session_replication_role = replica`
 * (a consistent snapshot needs no per-row FK re-validation; integrity is
 * re-proven afterwards by the drill's checks). Inserts are
 * `ON CONFLICT DO NOTHING` because migrations seed vocabulary tables that a
 * snapshot also carries. The `_foresift_schema_migrations` bookkeeping is NOT
 * part of snapshots; apply migrations to the fresh target first so schema
 * exists.
 */
export async function restoreSnapshotInto(
  target: DatabaseEngine,
  snapshot: { readonly bytes: Uint8Array },
): Promise<number> {
  const document = JSON.parse(new TextDecoder().decode(snapshot.bytes)) as {
    tables: Record<string, string[]>;
  };
  await target.exec('SET session_replication_role = replica');
  let restoredRows = 0;
  try {
    for (const [table, rowTexts] of Object.entries(document.tables)) {
      for (const rowText of rowTexts) {
        const row = JSON.parse(rowText) as Record<string, unknown>;
        const columns = Object.keys(row);
        const values = columns.map((c) => row[c]);
        await target.query(
          `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')})
           VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})
           ON CONFLICT DO NOTHING`,
          values,
        );
        restoredRows += 1;
      }
    }
  } finally {
    await target.exec('SET session_replication_role = DEFAULT');
  }
  return restoredRows;
}
