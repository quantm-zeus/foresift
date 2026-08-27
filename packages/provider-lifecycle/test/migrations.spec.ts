/**
 * SQL-truth structural rules of the prov migrations, exercised directly
 * against the applied schema (the parity spec covers column shape; this spec
 * covers the RULES the SQL encodes):
 *
 *   * the lifecycle ledger is append-only in SQL — UPDATE/DELETE/TRUNCATE are
 *     refused with a PROV_LEDGER_IMMUTABLE-prefixed error (§12.11);
 *   * retries cannot double-append: the INV-009 retry-fence UNIQUE rejects a
 *     replayed transition even under a fresh event id;
 *   * prohibited capability classes are UNREPRESENTABLE — the CHECK pins the
 *     nine allowed §15.2 classes only;
 *   * response quarantine is METADATA-ONLY — no payload-body column exists to
 *     persist hazardous material into (plan material decision 6).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
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

let seedSeq = 0;

async function seedOperation(
  capabilityClass: string,
): Promise<{ providerId: string; operationId: string; version: string }> {
  seedSeq += 1;
  const target = {
    providerId: 'seed-provider',
    operationId: `seed-op-${seedSeq}`,
    version: 'v1',
  };
  await engine.query(
    `INSERT INTO prov.prov_providers (provider_id, display_name, provider_group)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [target.providerId, 'Seed Provider', 'test-group'],
  );
  await engine.query(
    `INSERT INTO prov.prov_operations (
       provider_id, operation_id, version,
       capability_class, cost_class, supported_chains,
       input_schema_id, raw_output_schema_id, normalized_output_schema_id,
       quota_model_id, cache_policy_id, timeout_ms, retry_policy_id,
       declared_independence_group, license_policy_id,
       estimated_quota_units, quota_reset_policy_id,
       verification_expires_at, current_state, health_status)
     VALUES ($1,$2,$3,$4,'FREE_UNMETERED',ARRAY['solana'],
             'in-schema','raw-schema','norm-schema',
             'qm','cp',1000,'rp','dig','lp',
             0,'qrp', now() + interval '30 days', 'DISCOVERED', 'HEALTHY')`,
    [target.providerId, target.operationId, target.version, capabilityClass],
  );
  return target;
}

describe('prov migration SQL-truth rules', () => {
  it('refuses UPDATE on the lifecycle ledger with PROV_LEDGER_IMMUTABLE', async () => {
    const target = await seedOperation('READ_MARKET');
    await engine.query(
      `INSERT INTO prov.prov_lifecycle_events (
         event_id, provider_id, operation_id, version,
         from_state, to_state, reason_class, actor, occurred_at, effective_at)
       VALUES ('evt-1',$1,$2,$3,'DISCOVERED','VERIFIED','VERIFICATION_PASSED',
               'tester', now(), now())`,
      [target.providerId, target.operationId, target.version],
    );
    await expect(
      engine.query(
        `UPDATE prov.prov_lifecycle_events SET reason_class = 'REWRITTEN' WHERE event_id = 'evt-1'`,
      ),
    ).rejects.toThrow(/PROV_LEDGER_IMMUTABLE/);
    await expect(
      engine.query(`DELETE FROM prov.prov_lifecycle_events WHERE event_id = 'evt-1'`),
    ).rejects.toThrow(/PROV_LEDGER_IMMUTABLE/);
    await expect(engine.exec('TRUNCATE prov.prov_lifecycle_events')).rejects.toThrow(
      /PROV_LEDGER_IMMUTABLE/,
    );
  });

  it('rejects a replayed transition even under a fresh event id (INV-009 fence)', async () => {
    const target = await seedOperation('READ_MARKET');
    const baseInsert = `INSERT INTO prov.prov_lifecycle_events (
         event_id, provider_id, operation_id, version,
         from_state, to_state, reason_class, actor, occurred_at, effective_at)
       VALUES ($5,$1,$2,$3,'DISCOVERED','VERIFIED','VERIFICATION_PASSED',
               'tester', $4, $4)`;
    const args = [target.providerId, target.operationId, target.version, '2026-08-26T00:00:00Z'];
    await engine.query(baseInsert, [...args, 'evt-a']);
    // Same semantic transition, different event id → still fenced by the
    // retry-fence UNIQUE over the semantic tuple.
    await expect(engine.query(baseInsert, [...args, 'evt-b'])).rejects.toThrow(
      /prov_lifecycle_events_retry_fenced/,
    );
  });

  it('makes prohibited capability classes unrepresentable in SQL truth', async () => {
    for (const forbidden of [
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ]) {
      await expect(seedOperation(forbidden), `${forbidden} must be refused`).rejects.toThrow(
        /prov_operations_capability_class_check/i,
      );
    }
  });

  it('keeps response quarantine metadata-only: exact column set, no payload body', async () => {
    const cols = await engine.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'prov' AND table_name = 'prov_response_quarantine'
       ORDER BY ordinal_position`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'seq',
      'quarantine_id',
      'provider_id',
      'operation_id',
      'operation_version',
      'detected_classes',
      'field_paths',
      'payload_sha256',
      'byte_size',
      'disposition',
      'model_context_exclusion',
      'audit_chain_ref',
      'quarantined_at',
      'details',
    ]);
  });
});
