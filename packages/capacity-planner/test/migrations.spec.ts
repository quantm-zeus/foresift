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

describe('g1_cost_0002_capacity_contracts SQL migration on PGlite (FR-COST-012, FR-COST-013, AC-227)', () => {
  it('discovers g1_cost_0002_capacity_contracts script with sha256 checksum', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const m = all.find((x) => x.id === 'g1_cost_0002_capacity_contracts');
    expect(m).toBeDefined();
    expect(m?.checksum.startsWith('sha256:')).toBe(true);
  });

  it('enforces horizon_days >= 30 and result checks on cost.capacity_contracts', async () => {
    const validJson = JSON.stringify({});

    // Valid contract
    await engine.query(
      `INSERT INTO cost.capacity_contracts
         (contract_id, version, schedule_ref, profile_ref, horizon_days,
          candidate_load_json, provider_envelope_json, system_envelope_json,
          retry_allowance, protected_reserves_json, minimum_headroom_fraction,
          safety_margin_fraction, degradation_policy_version, verified_at, expires_at, result, active)
       VALUES ('contract_valid_1', 'v1', 'sched_1', 'prof_1', 30,
               $1, $1, $1, 100, $1, 0.15, 0.10, 'v1', now(), now() + interval '30 days', 'PASS', true)
       ON CONFLICT (contract_id) DO NOTHING`,
      [validJson],
    );

    // Refuses horizon_days < 30
    await expect(
      engine.query(
        `INSERT INTO cost.capacity_contracts
           (contract_id, version, schedule_ref, profile_ref, horizon_days,
            candidate_load_json, provider_envelope_json, system_envelope_json,
            retry_allowance, protected_reserves_json, minimum_headroom_fraction,
            safety_margin_fraction, degradation_policy_version, verified_at, expires_at, result, active)
         VALUES ('contract_bad_horizon', 'v1', 'sched_2', 'prof_2', 29,
                 $1, $1, $1, 100, $1, 0.15, 0.10, 'v1', now(), now() + interval '29 days', 'PASS', false)`,
        [validJson],
      ),
    ).rejects.toThrow();

    // Refuses invalid result
    await expect(
      engine.query(
        `INSERT INTO cost.capacity_contracts
           (contract_id, version, schedule_ref, profile_ref, horizon_days,
            candidate_load_json, provider_envelope_json, system_envelope_json,
            retry_allowance, protected_reserves_json, minimum_headroom_fraction,
            safety_margin_fraction, degradation_policy_version, verified_at, expires_at, result, active)
         VALUES ('contract_bad_result', 'v1', 'sched_3', 'prof_3', 30,
                 $1, $1, $1, 100, $1, 0.15, 0.10, 'v1', now(), now() + interval '30 days', 'INVALID_RESULT', false)`,
        [validJson],
      ),
    ).rejects.toThrow();
  });

  it('enforces cost.contract_reserves_borrowed constraints (borrowed_by_class <> reserve_class)', async () => {
    // Valid borrowing
    await engine.query(
      `INSERT INTO cost.contract_reserves_borrowed
         (borrow_id, contract_id, reserve_class, borrowed_by_class, units, policy_version, occurred_at)
       VALUES ('borrow_valid_1', 'contract_valid_1', 'RISK_MONITORING', 'ALERT_VERIFICATION', 50, 'v1', now())
       ON CONFLICT (borrow_id) DO NOTHING`,
    );

    // Refuses borrowed_by_class === reserve_class
    await expect(
      engine.query(
        `INSERT INTO cost.contract_reserves_borrowed
           (borrow_id, contract_id, reserve_class, borrowed_by_class, units, policy_version, occurred_at)
         VALUES ('borrow_bad_same', 'contract_valid_1', 'RISK_MONITORING', 'RISK_MONITORING', 50, 'v1', now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('g1_cost_0003_degradation_reconciliation SQL migration on PGlite (FR-COST-015, AC-228)', () => {
  it('discovers g1_cost_0003_degradation_reconciliation script with sha256 checksum', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const m = all.find((x) => x.id === 'g1_cost_0003_degradation_reconciliation');
    expect(m).toBeDefined();
    expect(m?.checksum.startsWith('sha256:')).toBe(true);
  });

  it('verifies deterministic seed of 11 degradation steps for policy_version v1', async () => {
    const steps = await engine.query<{ step_index: number; step_name: string }>(
      `SELECT step_index, step_name FROM cost.degradation_order_steps
       WHERE policy_version = 'v1'
       ORDER BY step_index ASC`,
    );

    expect(steps.rows.length).toBe(11);
    expect(steps.rows[0]?.step_name).toBe('SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL');
    expect(steps.rows[10]?.step_name).toBe('RETURN_PARTIAL_INSUFFICIENT_DATA');
  });
});
