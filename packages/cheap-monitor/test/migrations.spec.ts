/**
 * SQL-truth structural rules for cheap-monitor migrations (g0_disc_*, g1_disc_*).
 * Traces: FR-DISC-004, FR-DISC-005, FR-DISC-009, FR-DISC-011, FR-DISC-013.
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

describe('discovery & cheap-monitor SQL migrations (cheap-monitor)', () => {
  it('discovers discovery and cheap-monitor migrations in order (g0_disc_* and g1_disc_*)', async () => {
    const all = await discoverMigrations(MIGRATIONS_DIR);
    const discMigrations = all.filter(
      (m) => m.id.startsWith('g0_disc_') || m.id.startsWith('g1_disc_'),
    );
    expect(discMigrations.map((m) => m.id)).toEqual([
      'g0_disc_0001_universe_entries',
      'g0_disc_0002_cheap_monitor',
      'g0_disc_0003_promotions',
      'g1_disc_0001_source_profiles',
      'g1_disc_0002_constraints_gateways',
    ]);
    for (const m of discMigrations) {
      expect(m.checksum.startsWith('sha256:')).toBe(true);
      expect(m.sql.trim().length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('applies migrations idempotently', async () => {
    const second = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied.length).toBe(0);
  }, 60_000);

  it('enforces cheap_monitor_rows finite check constraint (checks_completed <= max_checks)', async () => {
    // Valid cheap monitor row
    await engine.query(
      `INSERT INTO disc.cheap_monitor_rows
         (monitor_id, candidate_id, state, checks_completed, max_checks, next_check_at,
          expires_at, backoff_ms, max_staleness_ms, resource_budget_class, provider_id,
          operation_id, retained_at)
       VALUES ('mon_test_1', 'cand_test_1', 'MONITORING_CHEAP', 2, 5, now() + interval '10s',
               now() + interval '1h', 10000, 60000, 'FREE_TIER', 'prov_gmgn', 'op_check', now())
       ON CONFLICT (candidate_id) DO NOTHING`,
    );

    // Refuses checks_completed > max_checks
    await expect(
      engine.query(
        `INSERT INTO disc.cheap_monitor_rows
           (monitor_id, candidate_id, state, checks_completed, max_checks, next_check_at,
            expires_at, backoff_ms, max_staleness_ms, resource_budget_class, provider_id,
            operation_id, retained_at)
         VALUES ('mon_test_bad', 'cand_test_bad', 'MONITORING_CHEAP', 6, 5, now() + interval '10s',
                 now() + interval '1h', 10000, 60000, 'FREE_TIER', 'prov_gmgn', 'op_check', now())`,
      ),
    ).rejects.toThrow();
  });

  it('enforces monitor_batches bounded constraints and terminal completion rules', async () => {
    // Valid batch
    await engine.query(
      `INSERT INTO disc.monitor_batches
         (batch_id, provider_id, operation_id, monitor_ids, max_batch_size, scheduled_at,
          due_before, selected_count, returned_entity_count, status)
       VALUES ('batch_test_1', 'prov_gmgn', 'op_check', ARRAY['mon_test_1'], 10, now(),
               now() + interval '30s', 1, 1, 'PLANNED')
       ON CONFLICT (batch_id) DO NOTHING`,
    );

    // Refuses batch with cardinality(monitor_ids) > max_batch_size
    await expect(
      engine.query(
        `INSERT INTO disc.monitor_batches
           (batch_id, provider_id, operation_id, monitor_ids, max_batch_size, scheduled_at,
            due_before, selected_count, returned_entity_count, status)
         VALUES ('batch_bad_size', 'prov_gmgn', 'op_check', ARRAY['mon_1', 'mon_2'], 1, now(),
                 now() + interval '30s', 1, 1, 'PLANNED')`,
      ),
    ).rejects.toThrow();
  });

  it('enforces promotion_decisions immutability triggers (FR-DISC-005, FR-DISC-011)', async () => {
    const frozen = JSON.stringify({ feat1: '1.0' });
    await engine.query(
      `INSERT INTO disc.promotion_decisions
         (promotion_decision_id, candidate_id, frozen_feature_versions, policy_version,
          inputs_hash, decision, decided_at, decision_version)
       VALUES ('promo_test_1', 'cand_test_1', $1, '1.0.0',
               'sha256:1111111111111111111111111111111111111111111111111111111111111111',
               'PROMOTE_TO_VERIFY', now(), 'v1')
       ON CONFLICT (promotion_decision_id) DO NOTHING`,
      [frozen],
    );

    // Refuses UPDATE on immutable promotion decisions
    await expect(
      engine.query(
        `UPDATE disc.promotion_decisions SET decision = 'REJECT_CHEAP' WHERE promotion_decision_id = 'promo_test_1'`,
      ),
    ).rejects.toThrow(/DISCOVERY_HISTORY_IMMUTABLE/);

    // Refuses DELETE on immutable promotion decisions
    await expect(
      engine.query(
        `DELETE FROM disc.promotion_decisions WHERE promotion_decision_id = 'promo_test_1'`,
      ),
    ).rejects.toThrow(/DISCOVERY_HISTORY_IMMUTABLE/);
  });
});
