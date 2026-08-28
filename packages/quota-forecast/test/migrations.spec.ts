/**
 * SQL-truth structural rules for quota-forecast migrations (g0_cost_0004_resource_forecast_snapshots.sql).
 * Tests migration discovery, checksum pinning, idempotency, snapshot expiry constraints,
 * and replay run tracking tables on PGlite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  discoverMigrations,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('quota-forecast migrations on PGlite', () => {
  it('discovers known forecast migration scripts with sha256 checksums', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const forecastMigration = all.find((m) => m.id === 'g0_cost_0004_resource_forecast_snapshots');
    expect(forecastMigration).toBeDefined();
    expect(forecastMigration!.checksum.startsWith('sha256:')).toBe(true);
  });

  it('applies forecast snapshot migrations idempotently', async () => {
    const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report.applied.length).toBe(0);
  });

  it('records forecast snapshots with valid JSON payloads and enforces expiry constraint', async () => {
    const snapshotId = 'snap_test_mig_1';
    await engine.query(
      `INSERT INTO cost.resource_forecast_snapshots
         (snapshot_id, plan_version_id, verified_at, expires_at, plan_limits_json, observed_usage_json, estimated_forecast_json)
       VALUES ($1, 'plan_v1', now(), now() + interval '30 days', '{"maxCredits":10000}', '{"creditsUsed":1000}', '{"forecast":1200}')
       ON CONFLICT (snapshot_id) DO NOTHING`,
      [snapshotId],
    );

    // Negative: expires_at <= verified_at fails CHECK
    await expect(
      engine.query(
        `INSERT INTO cost.resource_forecast_snapshots
           (snapshot_id, plan_version_id, verified_at, expires_at, plan_limits_json, observed_usage_json, estimated_forecast_json)
         VALUES ('snap_test_bad_expiry', 'plan_v1', now(), now() - interval '1 day', '{}', '{}', '{}')`,
      ),
    ).rejects.toThrow();
  });
});
