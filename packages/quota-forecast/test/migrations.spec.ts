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

describe('g1_cost_0003_degradation_reconciliation SQL migration (FR-COST-016, FR-COST-017, AC-229)', () => {
  it('enforces forecast_reconciliations symmetry and dimension constraints', async () => {
    // Valid without breach
    await engine.query(
      `INSERT INTO cost.forecast_reconciliations
         (reconciliation_id, contract_id, dimension, subject_id, forecast_value, actual_value, tolerance_fraction, breach_kind, incident_id, reconciled_at)
       VALUES ('rec_valid_1', 'contract_valid_1', 'WORKLOAD', 'workload_discovery', 1000, 1050, 0.1, NULL, NULL, now())
       ON CONFLICT (reconciliation_id) DO NOTHING`,
    );

    // Valid with breach
    await engine.query(
      `INSERT INTO cost.forecast_reconciliations
         (reconciliation_id, contract_id, dimension, subject_id, forecast_value, actual_value, tolerance_fraction, breach_kind, incident_id, reconciled_at)
       VALUES ('rec_valid_2', 'contract_valid_1', 'OPERATION', 'op_helius', 1000, 1500, 0.1, 'MATERIAL_UNDERESTIMATION', 'inc_123', now())
       ON CONFLICT (reconciliation_id) DO NOTHING`,
    );

    // Refuses breach without incident (symmetry CHECK)
    await expect(
      engine.query(
        `INSERT INTO cost.forecast_reconciliations
           (reconciliation_id, contract_id, dimension, subject_id, forecast_value, actual_value, tolerance_fraction, breach_kind, incident_id, reconciled_at)
         VALUES ('rec_bad_1', 'contract_valid_1', 'OPERATION', 'op_helius', 1000, 1500, 0.1, 'MATERIAL_UNDERESTIMATION', NULL, now())`,
      ),
    ).rejects.toThrow();

    // Refuses incident without breach (symmetry CHECK)
    await expect(
      engine.query(
        `INSERT INTO cost.forecast_reconciliations
           (reconciliation_id, contract_id, dimension, subject_id, forecast_value, actual_value, tolerance_fraction, breach_kind, incident_id, reconciled_at)
         VALUES ('rec_bad_2', 'contract_valid_1', 'OPERATION', 'op_helius', 1000, 900, 0.1, NULL, 'inc_orphan', now())`,
      ),
    ).rejects.toThrow();

    // Refuses invalid dimension
    await expect(
      engine.query(
        `INSERT INTO cost.forecast_reconciliations
           (reconciliation_id, contract_id, dimension, subject_id, forecast_value, actual_value, tolerance_fraction, breach_kind, incident_id, reconciled_at)
         VALUES ('rec_bad_3', 'contract_valid_1', 'INVALID_DIM', 'op_helius', 1000, 900, 0.1, NULL, NULL, now())`,
      ),
    ).rejects.toThrow();
  });

  it('enforces cost_attributions unit_kind constraint', async () => {
    const renderedJson = JSON.stringify({
      PAID_DATA_SPEND: 0,
      FREE_QUOTA_CONSUMPTION: 100,
      MODEL_SPEND: 1.0,
      INFRASTRUCTURE_SPEND: 0.5,
      STORAGE_EGRESS_SPEND: 0.1,
      NOTIFICATION_SPEND: 0.0,
      HUMAN_REVIEW_EFFORT: 0,
    });

    // Valid attribution
    await engine.query(
      `INSERT INTO cost.cost_attributions
         (attribution_id, contract_id, unit_kind, subject_id, marginal_cost, total_cost, rendered_classes, attributed_at)
       VALUES ('attr_valid_1', 'contract_valid_1', 'RESEARCHED_CANDIDATE', 'cand_123', 0.05, 1.6, $1, now())
       ON CONFLICT (attribution_id) DO NOTHING`,
      [renderedJson],
    );

    // Refuses invalid unit_kind
    await expect(
      engine.query(
        `INSERT INTO cost.cost_attributions
           (attribution_id, contract_id, unit_kind, subject_id, marginal_cost, total_cost, rendered_classes, attributed_at)
         VALUES ('attr_bad_unit', 'contract_valid_1', 'INVALID_UNIT_KIND', 'cand_123', 0.05, 1.6, $1, now())`,
        [renderedJson],
      ),
    ).rejects.toThrow();
  });
});
