/**
 * SQL-truth proof for the five `g0_prov_*` migrations (FR-PROV-001…010
 * substrate): they must apply cleanly over a fully migrated PGlite database
 * containing ALL proven data/dr/sec sets — one migration history, no forks.
 *
 * Behavior rules encoded in SQL are exercised here directly:
 *   * prov_lifecycle_events is append-only (UPDATE/DELETE/TRUNCATE raise
 *     the machine-detectable LEDGER_IMMUTABLE refusal; INV-004).
 *   * idempotency_key UNIQUE — retries cannot double-append (INV-009).
 *   * PROHIBITED_* capability classes are unrepresentable at the storage layer.
 *   * quarantine records refuse an empty malicious-class set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const EXPECTED_PROV_TABLES = [
  'prov_lifecycle_events',
  'prov_migration_exceptions',
  'prov_operation_dependencies',
  'prov_operations',
  'prov_provider_artifacts',
  'prov_providers',
  'prov_response_quarantine',
  'prov_rights_change_actions',
  'prov_rights_changes',
  'prov_rights_declarations',
  'prov_source_fingerprints',
  'prov_verification_records',
  'prov_verification_ttl_config',
];

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

describe('g0_prov migration family over the full proven set', () => {
  it('applies all five prov scripts alongside every proven family', async () => {
    const applied = await engine.query<{ id: string }>(
      `SELECT id FROM _foresift_schema_migrations WHERE id LIKE 'g0_prov%' ORDER BY id`,
    );
    expect(applied.rows.map((r) => r.id)).toEqual([
      'g0_prov_0001_provider_operations',
      'g0_prov_0002_verification_ttl',
      'g0_prov_0003_migration_exceptions',
      'g0_prov_0004_quarantine',
      'g0_prov_0005_rights_fingerprints',
    ]);
  });

  it('keeps one unified history: data, dr, sec, and prov all recorded', async () => {
    const families = await engine.query<{ family: string; n: string }>(
      `SELECT substring(id from '^g0_([a-z]+)_') AS family, count(*)::text AS n
       FROM _foresift_schema_migrations GROUP BY 1 ORDER BY 1`,
    );
    const counts = Object.fromEntries(families.rows.map((r) => [r.family, Number(r.n)]));
    expect(counts).toEqual({ data: 7, dr: 5, prov: 5, sec: 4 });
  });

  it('creates exactly the prov table set and leaks nothing into public', async () => {
    const provTables = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'prov' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(provTables.rows.map((r) => r.table_name)).toEqual(EXPECTED_PROV_TABLES);

    const leaked = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'prov_%'`,
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it('registers a provider + operation and appends a lifecycle event', async () => {
    await seedProviderAndOperation(engine);

    const events = await engine.query<{ to_state: string }>(
      `SELECT to_state FROM prov.prov_lifecycle_events WHERE idempotency_key = $1`,
      ['scaffold-register-1'],
    );
    expect(events.rows.map((r) => r.to_state)).toEqual(['VERIFIED']);
  });

  it('refuses UPDATE, DELETE, and TRUNCATE on the lifecycle ledger', async () => {
    await expect(
      engine.query(
        `UPDATE prov.prov_lifecycle_events SET actor = 'rewritten'
         WHERE idempotency_key = $1`,
        ['scaffold-register-1'],
      ),
    ).rejects.toThrow(/LEDGER_IMMUTABLE/);

    await expect(
      engine.query('DELETE FROM prov.prov_lifecycle_events WHERE idempotency_key = $1', [
        'scaffold-register-1',
      ]),
    ).rejects.toThrow(/LEDGER_IMMUTABLE/);

    await expect(engine.query('TRUNCATE prov.prov_lifecycle_events')).rejects.toThrow(
      /LEDGER_IMMUTABLE/,
    );
  });

  it('refuses a duplicate idempotency key on the ledger (INV-009)', async () => {
    await expect(appendEvent(engine, 'scaffold-register-1')).rejects.toThrow(
      /prov_lifecycle_events_idempotency/,
    );
  });

  it('makes PROHIBITED_* capability classes unrepresentable in SQL truth', async () => {
    await expect(prohibitedOperationInsert(engine)).rejects.toThrow(/capability_class_check/);
  });

  it('refuses quarantine records with an empty detected-class set', async () => {
    await expect(
      engine.query(
        `INSERT INTO prov.prov_response_quarantine (
           quarantine_id, provider_id, operation_id, detected_classes,
           payload_sha256, byte_size, audit_ref, detected_at)
         VALUES ('q-empty','prov-a','get-account', ARRAY[]::text[],
                 'sha256:${'a'.repeat(64)}', 10, 'audit-1', now())`,
      ),
    ).rejects.toThrow(/detected_classes/);
  });

  it('refuses verification records whose expiry precedes verification', async () => {
    await expect(
      engine.query(
        `INSERT INTO prov.prov_verification_records (
           provider_id, operation_id, operation_version, kind, source,
           outcome, verified_at, expires_at, evidence_refs)
         VALUES ('prov-a','get-account','1.0.0','DOCUMENTATION','OFFICIAL_DOC',
                 'SUCCEEDED', now(), now() - interval '1 second', '["e1"]'::jsonb)`,
      ),
    ).rejects.toThrow(/prov_verification_records_window/);
  });
});

async function seedProviderAndOperation(engine: DatabaseEngine): Promise<void> {
  await engine.exec(`
    INSERT INTO prov.prov_providers (provider_id, provider_group, display_name,
                                     disabled_by_default, registered_at)
    VALUES ('prov-a', 'group-x', 'Provider A', true, now())
    ON CONFLICT DO NOTHING;
  `);
  await engine.exec(`
    INSERT INTO prov.prov_operations (
      provider_id, operation_id, version, capability_class,
      supported_chains, input_schema_id, raw_output_schema_id, normalized_output_schema_id,
      quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
      declared_independence_group, upstream_lineage, license_policy_id,
      cost_class, estimated_quota_units, quota_reset_policy_id,
      protected_reserve_eligible, allowed_in_strict_free, paid_fallback_allowed,
      verification_expires_at, forbidden_output_fields, negative_capabilities, registered_at)
    VALUES ('prov-a','get-account','1.0.0','READ_ACCOUNT_STATE',
            '["solana-mainnet"]'::jsonb,'in-1','raw-1','norm-1',
            'qm-1','cp-1',5000,'rp-1',
            'ind-1','[]'::jsonb,'lp-1',
            'FREE_QUOTA',10,'qrp-1',
            false,true,false,
            now() + interval '7 days','[]'::jsonb,'[]'::jsonb, now())
    ON CONFLICT DO NOTHING;
  `);
  await appendEvent(engine, 'scaffold-register-1');
}

function appendEvent(engine: DatabaseEngine, idempotencyKey: string): Promise<unknown> {
  return engine.query(
    `INSERT INTO prov.prov_lifecycle_events (
       provider_id, operation_id, operation_version, from_state, to_state,
       reason_class, actor, occurred_at, evidence_refs, idempotency_key)
     VALUES ('prov-a','get-account','1.0.0','DISCOVERED','VERIFIED',
             'VERIFICATION_PROMOTED','test-suite',now(),
             '[["verification","doc-ref-1"]]'::jsonb,$1)`,
    [idempotencyKey],
  );
}

function prohibitedOperationInsert(engine: DatabaseEngine): Promise<unknown> {
  return engine.query(
    `INSERT INTO prov.prov_operations (
       provider_id, operation_id, version, capability_class,
       supported_chains, input_schema_id, raw_output_schema_id, normalized_output_schema_id,
       quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
       declared_independence_group, upstream_lineage, license_policy_id,
       cost_class, estimated_quota_units, quota_reset_policy_id,
       protected_reserve_eligible, allowed_in_strict_free, paid_fallback_allowed,
       verification_expires_at, forbidden_output_fields, negative_capabilities, registered_at)
     VALUES ('prov-a','swap-executor','1.0.0','PROHIBITED_TRADING_EXECUTION',
             '[]'::jsonb,'i','r','n','q','c',1000,'rp','dig','[]'::jsonb,'lp',
             'FREE_QUOTA',0,'qrp',false,false,false,
             now() + interval '1 day','[]'::jsonb,'[]'::jsonb, now())`,
  );
}
