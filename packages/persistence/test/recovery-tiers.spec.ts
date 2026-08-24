/**
 * Tiered recovery objectives storage (T042, FR-DR-001, §34.4/§34.9–§34.10):
 * §34.4 default tiers seeded under the product-law RPO ceilings; the
 * protected-asset registry covers EVERY table this package creates plus the
 * raw-payload object store; looser-than-ceiling configuration, class
 * mismatches, incident-less misses, and invalid health states all refuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ErrorCode,
  ForesiftError,
  RecoveryDataClass,
  degradedHealthState,
  utcTimestamp,
  type RecoveryDataClass as RecoveryDataClassName,
  type RecoveryTier,
  type RecoveryTierId,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  getBackupPolicy,
  openIncident,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordRecoveryHealthState,
  recordTierMeasurement,
  registerProtectedAsset,
  registerRecoveryTier,
  resolveIncident,
  seedDefaultRecoveryTiers,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const AT = utcTimestamp('2026-08-20T12:00:00.000Z');

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await db.close();
});

/** Every public table the migrations create (source of truth: information_schema). */
async function allPackageTables(): Promise<readonly string[]> {
  const rows = await engine.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name NOT LIKE '_foresift%'
     ORDER BY table_name`,
  );
  return rows.rows.map((r) => r.table_name);
}

/**
 * The data class governing each table this package owns (§34.4 semantics).
 * Everything not listed as observation/checkpoint or raw-payload material is
 * critical metadata (configuration, decisions, evidence index, DR records).
 */
const OBSERVATION_TABLES = new Set([
  'observations',
  'observation_revisions',
  'compensating_events',
  'watermarks',
  'token_decimal_observations',
  'collector_checkpoints',
  'collector_gaps',
  'canonical_event_keys',
]);

function classOfTable(table: string): string {
  return OBSERVATION_TABLES.has(table)
    ? RecoveryDataClass.CRITICAL_OBSERVATIONS_CHECKPOINTS
    : RecoveryDataClass.CRITICAL_METADATA;
}

describe('recovery-tier registry seeding (FR-DR-001)', () => {
  it('seeds the §34.4 default tiers within their ceilings', async () => {
    await seedDefaultRecoveryTiers(engine, AT);
    const tiers = await engine.query<{
      tier_id: string;
      data_class: string;
      rpo_target_minutes: string;
      rto_target_minutes: string;
    }>('SELECT * FROM recovery_tiers ORDER BY tier_id');
    const byId = new Map(tiers.rows.map((t) => [t.tier_id, t]));
    expect(byId.get('tier-critical-metadata')?.data_class).toBe('CRITICAL_METADATA');
    expect(Number(byId.get('tier-critical-metadata')?.rpo_target_minutes)).toBeLessThanOrEqual(15);
    expect(
      Number(byId.get('tier-critical-observations-checkpoints')?.rpo_target_minutes),
    ).toBeLessThanOrEqual(60);
    expect(
      Number(byId.get('tier-replayable-raw-payloads')?.rpo_target_minutes),
    ).toBeLessThanOrEqual(1440);
  });

  it('is idempotent — reseeding converges instead of duplicating', async () => {
    await seedDefaultRecoveryTiers(engine, AT);
    const tiers = await engine.query<{ n: string }>('SELECT count(*) AS n FROM recovery_tiers');
    expect(Number(tiers.rows[0]?.n)).toBe(3);
  });

  it('refuses tiers configured looser than the class ceiling', async () => {
    const illegal: RecoveryTier = {
      id: 'tier-loose-metadata' as RecoveryTierId,
      dataClass: RecoveryDataClass.CRITICAL_METADATA,
      rpoTargetMinutes: 30, // ceiling is 15
      rtoTargetMinutes: 60,
    };
    await expect(registerRecoveryTier(engine, illegal, AT)).rejects.toMatchObject({
      code: ErrorCode.RECOVERY_TIER_CEILING_EXCEEDED,
    });
    // And the SQL CHECK independently backs the domain refusal.
    await expect(
      engine.query(
        `INSERT INTO recovery_tiers (tier_id, data_class, rpo_target_minutes, rto_target_minutes)
         VALUES ('tier-loose-metadata','CRITICAL_METADATA',30,60)`,
      ),
    ).rejects.toThrow(/recovery_tiers_rpo_within_ceiling/);
  });
});

describe('protected-asset registry coverage (FR-DR-001, §14.9)', () => {
  it('maps EVERY table created by this package plus the raw-payload object store onto covering tiers', async () => {
    await seedDefaultRecoveryTiers(engine, AT);

    const tierByClass: Record<string, string> = {
      [RecoveryDataClass.CRITICAL_METADATA]: 'tier-critical-metadata',
      [RecoveryDataClass.CRITICAL_OBSERVATIONS_CHECKPOINTS]:
        'tier-critical-observations-checkpoints',
      [RecoveryDataClass.REPLAYABLE_RAW_PAYLOADS]: 'tier-replayable-raw-payloads',
    };
    const tables = await allPackageTables();
    // Raw payloads never live in relational tables — the object store is the
    // replayable-raw-payloads asset (rights permitting reconstruction).
    const assets: readonly { assetKey: string; dataClass: string }[] = [
      ...tables.map((t) => ({ assetKey: `table:${t}`, dataClass: classOfTable(t) })),
      { assetKey: 'store:raw-payloads', dataClass: RecoveryDataClass.REPLAYABLE_RAW_PAYLOADS },
    ];
    for (const asset of assets) {
      await registerProtectedAsset(engine, {
        assetKey: asset.assetKey,
        dataClass: asset.dataClass as RecoveryDataClassName,
        tierId: tierByClass[asset.dataClass] ?? '',
        at: AT,
      });
    }

    const registered = await engine.query<{ asset_key: string }>(
      'SELECT asset_key FROM protected_assets ORDER BY asset_key',
    );
    const registeredKeys = new Set(registered.rows.map((r) => r.asset_key));
    for (const table of tables) {
      expect(registeredKeys.has(`table:${table}`), `unprotected table ${table}`).toBe(true);
    }
    expect(registeredKeys.has('store:raw-payloads')).toBe(true);
  });

  it('refuses an asset whose declared class does not match its tier class', async () => {
    await expect(
      registerProtectedAsset(engine, {
        assetKey: 'table:pools',
        dataClass: RecoveryDataClass.CRITICAL_OBSERVATIONS_CHECKPOINTS, // pools are metadata
        tierId: 'tier-critical-metadata',
        at: AT,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });
    // An observation table must never hide behind a metadata tier either.
    await expect(
      registerProtectedAsset(engine, {
        assetKey: 'table:observations',
        dataClass: RecoveryDataClass.CRITICAL_OBSERVATIONS_CHECKPOINTS,
        tierId: 'tier-critical-metadata',
        at: AT,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });
  });

  it('refuses protection against an unknown tier', async () => {
    await expect(
      registerProtectedAsset(engine, {
        assetKey: 'table:whatever',
        dataClass: RecoveryDataClass.CRITICAL_METADATA,
        tierId: 'tier-nonexistent',
        at: AT,
      }),
    ).rejects.toBeInstanceOf(ForesiftError);
  });
});

describe('tier measurements + incidents + health states (§34.9–§34.10)', () => {
  it('records a WITHIN_TIER measurement without an incident', async () => {
    await recordTierMeasurement(engine, {
      measurementId: 'meas-ok',
      measurement: {
        tierId: 'tier-critical-metadata' as RecoveryTierId,
        achievedRpoMinutes: 3,
        achievedRtoMinutes: 40,
        outcome: 'WITHIN_TIER',
      },
      measuredAt: AT,
    });
    const row = await engine.query<{ incident_id: string | null }>(
      'SELECT incident_id FROM tier_measurements WHERE measurement_id = $1',
      ['meas-ok'],
    );
    expect(row.rows[0]?.incident_id).toBeNull();
  });

  it('refuses a missed measurement without an incident reference — typed first, then by CHECK', async () => {
    await expect(
      recordTierMeasurement(engine, {
        measurementId: 'meas-miss-no-incident',
        measurement: {
          tierId: 'tier-critical-metadata' as RecoveryTierId,
          achievedRpoMinutes: 40,
          achievedRtoMinutes: 10,
          outcome: 'MISSED_RPO',
        },
        measuredAt: AT,
      }),
    ).rejects.toBeInstanceOf(ForesiftError);
    await expect(
      engine.query(
        `INSERT INTO tier_measurements (measurement_id, tier_id, achieved_rpo_minutes, achieved_rto_minutes, outcome, measured_at)
         VALUES ('meas-sql-miss','tier-critical-metadata',40,10,'MISSED_RPO',now())`,
      ),
    ).rejects.toThrow(/tier_measurements_incident_on_miss/);
  });

  it('persists a miss with its incident, degrading capability machine-readably while preserving risk monitoring', async () => {
    await openIncident(engine, {
      incidentId: 'incident-rpo-1',
      tierId: 'tier-critical-observations-checkpoints',
      kind: 'RPO_MISSED',
      reason: 'restore recovered only to 90 minutes ago',
      openedAt: AT,
    });
    await recordTierMeasurement(engine, {
      measurementId: 'meas-miss',
      measurement: {
        tierId: 'tier-critical-observations-checkpoints' as RecoveryTierId,
        achievedRpoMinutes: 90,
        achievedRtoMinutes: 30,
        outcome: 'MISSED_RPO',
      },
      incidentId: 'incident-rpo-1',
      measuredAt: AT,
    });
    await recordRecoveryHealthState(engine, {
      healthStateId: 'health-degraded-1',
      state: degradedHealthState(
        'observations',
        'incident-rpo-1',
        AT,
        'critical observations tier missed RPO; opportunity claims blocked until repaired',
      ),
    });
    const health = await engine.query<Record<string, unknown>>(
      'SELECT * FROM recovery_health_states WHERE health_state_id = $1',
      ['health-degraded-1'],
    );
    expect(health.rows[0]?.kind).toBe('DEGRADED');
    expect(health.rows[0]?.confirmed_opportunity_influence_blocked).toBe(true);
    expect(health.rows[0]?.deterministic_risk_monitoring_allowed).toBe(true);
    expect(health.rows[0]?.incident_id).toBe('incident-rpo-1');

    await expect(
      engine.query(
        `INSERT INTO recovery_health_states
           (health_state_id, capability, kind, confirmed_opportunity_influence_blocked,
            deterministic_risk_monitoring_allowed, incident_id, evaluated_at, reason)
         VALUES ('health-bad','observations','HEALTHY',false,true,'incident-rpo-1',now(),'x')`,
      ),
    ).rejects.toThrow(/recovery_health_healthy_has_no_incident/);
  });

  it('refuses suppressing deterministic risk monitoring and degraded states without incidents', async () => {
    await expect(
      recordRecoveryHealthState(engine, {
        healthStateId: 'health-bad-1',
        state: {
          capability: 'observations',
          kind: 'DEGRADED',
          confirmedOpportunityInfluenceBlocked: true,
          deterministicRiskMonitoringAllowed: false,
          incidentId: null,
          evaluatedAt: AT,
          reason: 'attempted total shutdown of monitoring',
        },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });

    await expect(
      recordRecoveryHealthState(engine, {
        healthStateId: 'health-bad-2',
        state: {
          capability: 'observations',
          kind: 'DEGRADED',
          confirmedOpportunityInfluenceBlocked: false,
          deterministicRiskMonitoringAllowed: true,
          incidentId: null,
          evaluatedAt: AT,
          reason: 'degraded without incident reference',
        },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });
  });

  it('closes incidents only forward in time', async () => {
    const resolvedAt: UtcTimestamp = utcTimestamp('2026-08-21T09:00:00.000Z');
    await resolveIncident(engine, { incidentId: 'incident-rpo-1', resolvedAt });
    const row = await engine.query<{ resolved_at: string | null }>(
      'SELECT resolved_at FROM recovery_incidents WHERE incident_id = $1',
      ['incident-rpo-1'],
    );
    expect(row.rows[0]?.resolved_at).not.toBeNull();
  });

  it('refuses a resolution timestamp earlier than the incident opened', async () => {
    // Fresh incident opened at AT; resolution predating it must be refused —
    // the refusal half of "closes incidents only forward in time" (review L-23).
    await openIncident(engine, {
      incidentId: 'incident-close-order',
      kind: 'RPO_MISSED',
      reason: 'probe for backward-time refusal',
      openedAt: AT,
    });
    await expect(
      resolveIncident(engine, {
        incidentId: 'incident-close-order',
        resolvedAt: utcTimestamp('2026-08-20T11:59:59.000Z'),
      }),
    ).rejects.toThrow(/before it opened/);
    const row = await engine.query<{ resolved_at: string | null }>(
      'SELECT resolved_at FROM recovery_incidents WHERE incident_id = $1',
      ['incident-close-order'],
    );
    expect(row.rows[0]?.resolved_at).toBeNull();
  });
});

describe('backup policy persistence shape (T043 substrate)', () => {
  it('stores separated key references only and round-trips', async () => {
    await engine.query(
      `INSERT INTO backup_policies
         (policy_id, retention_days, encryption_status, location_ref, rights_ref,
          legal_hold, deletion_policy, key_reference)
       VALUES ('policy-primary', 35, 'SERVER_SIDE_AES256', 'location://gcp-us-central1',
               'rights://provider-x/payloads', false, 'DELETE_AFTER_RETENTION', 'keyref:kms/main-key')
       ON CONFLICT (policy_id) DO NOTHING`,
    );
    const policy = await getBackupPolicy(engine, 'policy-primary');
    expect(policy.keyReference.startsWith('keyref:')).toBe(true);
    expect(policy.retentionDays).toBe(35);
    // The stored record contains a REFERENCE, not material.
    const raw = await engine.query<{ key_reference: string }>(
      'SELECT key_reference FROM backup_policies WHERE policy_id = $1',
      ['policy-primary'],
    );
    expect(raw.rows[0]?.key_reference).toMatch(/^keyref:/);
  });
});
