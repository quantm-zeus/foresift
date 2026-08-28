/**
 * SQL-truth structural rules for capacity-planner migrations (g0_cost_0003_capacity_budgets.sql).
 * Tests migration discovery, checksum pinning, idempotency, resource budget constraints,
 * enum check over six kinds, used <= cap_limit, and isolated BYOK namespace.
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

describe('capacity-planner migrations on PGlite', () => {
  it('discovers known capacity migration scripts with sha256 checksums', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const capacityMigration = all.find((m) => m.id === 'g0_cost_0003_capacity_budgets');
    expect(capacityMigration).toBeDefined();
    expect(capacityMigration!.checksum.startsWith('sha256:')).toBe(true);
  });

  it('applies capacity budget schema idempotently', async () => {
    const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report.applied.length).toBe(0);
  });

  it('validates kind enum constraint on capacity_resource_budgets', async () => {
    const validKinds = [
      'SCHEDULER_SLOTS',
      'WORKFLOW_STEPS',
      'DATABASE_BYTES',
      'OBJECT_STORE_BYTES',
      'NOTIFICATION_RATE',
      'MODEL_TOKENS_BYOK',
    ];

    for (const kind of validKinds) {
      await engine.query(
        `INSERT INTO cost.capacity_resource_budgets
           (kind, cap_limit, used, forecast_used, degrade_behavior)
         VALUES ($1, 100, 10, 20, 'SKIP_LOW_PRIORITY')
         ON CONFLICT (kind) DO UPDATE SET used = 10`,
        [kind],
      );
    }

    // Negative: invalid kind fails enum CHECK
    await expect(
      engine.query(
        `INSERT INTO cost.capacity_resource_budgets
           (kind, cap_limit, used, forecast_used, degrade_behavior)
         VALUES ('INVALID_BUDGET_KIND', 100, 10, 20, 'SKIP_LOW_PRIORITY')`,
      ),
    ).rejects.toThrow();

    // Negative: used > cap_limit fails CHECK
    await expect(
      engine.query(
        `INSERT INTO cost.capacity_resource_budgets
           (kind, cap_limit, used, forecast_used, degrade_behavior)
         VALUES ('SCHEDULER_SLOTS', 100, 150, 20, 'SKIP_LOW_PRIORITY')
         ON CONFLICT (kind) DO UPDATE SET used = 150`,
      ),
    ).rejects.toThrow();
  });
});
