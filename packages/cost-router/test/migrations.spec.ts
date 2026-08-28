/**
 * SQL-truth structural rules for cost-router migrations (g0_cost_*).
 * Tests migration discovery, ordering, checksums, idempotency, ledger constraints,
 * and paid-policy immutability on PGlite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  appliedMigrations,
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

describe('g0_cost_* SQL migrations on PGlite', () => {
  it('discovers known cost migration scripts in exact lexicographic order with sha256 checksums', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const costMigrations = all.filter((m) => m.id.startsWith('g0_cost_'));
    expect(costMigrations.map((m) => m.id)).toEqual([
      'g0_cost_0001_cost_ledgers',
      'g0_cost_0002_paid_policies',
      'g0_cost_0003_capacity_budgets',
      'g0_cost_0004_resource_forecast_snapshots',
    ]);
    for (const m of costMigrations) {
      expect(m.checksum.startsWith('sha256:')).toBe(true);
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  });

  it('applies migrations idempotently', async () => {
    const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(report.applied.length).toBe(0);
  });

  it('enforces remaining_units generated invariant on cost_quota_balances', async () => {
    const providerId = 'prov_test_ledger_invar';
    const quotaModelId = 'REQUESTS_PER_PERIOD';
    const periodWindowStart = '2026-08-01T00:00:00Z';

    await engine.query(
      `INSERT INTO cost.cost_quota_balances
         (provider_id, quota_model_id, period_window_start, period_reset_at, cap_limit, consumed_reserved, consumed_committed)
       VALUES ($1, $2, $3, now() + interval '1 day', 1000, 200, 300)
       ON CONFLICT (provider_id, quota_model_id, period_window_start) DO NOTHING`,
      [providerId, quotaModelId, periodWindowStart],
    );

    const result = await engine.query<{ remaining_units: string }>(
      `SELECT remaining_units FROM cost.cost_quota_balances
        WHERE provider_id=$1 AND quota_model_id=$2 AND period_window_start=$3`,
      [providerId, quotaModelId, periodWindowStart],
    );
    expect(Number(result.rows[0]?.remaining_units)).toBe(500);

    // Negative: balance conservation CHECK fails when consumed > cap
    await expect(
      engine.query(
        `INSERT INTO cost.cost_quota_balances
           (provider_id, quota_model_id, period_window_start, period_reset_at, cap_limit, consumed_reserved, consumed_committed)
         VALUES ($1, $2, '2026-09-01T00:00:00Z', now() + interval '10 days', 100, 80, 50)`,
        [providerId, quotaModelId],
      ),
    ).rejects.toThrow();
  });

  it('enforces immutability trigger on active paid_provider_policies', async () => {
    const policyId = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const providerId = 'prov_paid_immut_test';

    await engine.query(
      `INSERT INTO cost.paid_provider_policies
         (policy_id, provider_id, budget_units, approved_by, approved_at, activated_at, re_auth_due_at, active)
       VALUES ($1, $2, 5000, 'officer_alice', now(), now(), now() + interval '30 days', true)
       ON CONFLICT (policy_id) DO NOTHING`,
      [policyId, providerId],
    );

    // Attempting to mutate budget on active policy must trigger PAID_POLICY_IMMUTABLE exception
    await expect(
      engine.query(
        `UPDATE cost.paid_provider_policies SET budget_units = 99999 WHERE policy_id = $1`,
        [policyId],
      ),
    ).rejects.toThrow(/PAID_POLICY_IMMUTABLE/);
  });
});
