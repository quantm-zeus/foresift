/**
 * AC-260 acceptance (positive) — task T060.
 * Traces: FR-DR-001, FR-DR-002.
 * AC text (manifest §39.25): "A destructive restore drill recovers critical
 * configuration, decisions, alerts, audit/evidence indexes within the
 * declared 15-minute RPO and critical observations/checkpoints within the
 * declared 60-minute RPO, or blocks active opportunity mode."
 *
 * Both declared tiers are met on fixture workloads: a metadata-class world
 * (policy + decisions index + evidence bundle) and an observations/
 * checkpoints-class world restore byte-identically with scripted timelines
 * inside each tier — so opportunity mode stays unblocked.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AcquisitionState,
  fixedClock,
  utcTimestamp,
  type RecoveryTierId,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  applyMigrations,
  captureDeterministicSnapshot,
  commitCheckpoint,
  createEngine,
  evaluateAndRecordDrill,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordAcquisitionDecision,
  registerRecoveryTier,
  seedDefaultRecoveryTiers,
  type DatabaseEngine,
} from '@foresift/persistence';
import { freezeBundle } from '@foresift/evidence';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  restoreSnapshotInto,
  type TestDatabase,
} from './helpers.ts';

const T0 = Date.parse('2026-06-01T12:00:00.000Z');
const at = (offsetMinutes: number): UtcTimestamp =>
  utcTimestamp(new Date(T0 + offsetMinutes * 60_000).toISOString());

let source: TestDatabase;
let restoredDb: PGlite | undefined;
let restored: DatabaseEngine;

beforeAll(async () => {
  source = await makeTestDatabase();
  const { engine } = source;
  // Recovery-tier configuration exists in BOTH worlds at the same seeded
  // instant so the restored environment reproduces it byte-identically.
  await seedDefaultRecoveryTiers(engine, at(0));
  // Metadata class: configuration (tiers), the decisions index…
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac260-decision',
    candidateId: 'cand/ac260',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: at(0),
  });
  // …and the evidence index (a frozen bundle).
  await freezeBundle(engine, {
    bundleId: 'ac260-bundle',
    manifest: { family: 'swaps', window: '2026-06-01' },
    frozenAt: at(1),
  });

  // Observations/checkpoints class: canonical events + fenced checkpoint.
  await commitCheckpoint(engine, {
    shardId: 'shard-ac260',
    fencingToken: 1,
    cursorPosition: 42,
    at: at(2),
  });
});

afterAll(async () => {
  await closeTestDatabase(source);
  if (restoredDb) await restoredDb.close();
});

describe('AC-260: destructive drill meets both declared RPO tiers on fixtures', () => {
  let manifestHash = '';

  it('the destroyed environment restores both workload classes byte-identically', async () => {
    const snapshot = await captureDeterministicSnapshot(source.engine, at(5));
    manifestHash = snapshot.manifestHash;

    restoredDb = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    restored = createEngine(restoredDb, 'pglite');
    await applyMigrations({ engine: restored, migrationsDir: MIGRATIONS_DIR });
    // Identical configuration seed as the lost world.
    await seedDefaultRecoveryTiers(restored, at(0));
    await restoreSnapshotInto(restored, snapshot);

    // Recovered content spot-checks: decision index + evidence index +
    // checkpoint cursor all present in the restored world.
    const decision = await restored.query(
      "SELECT 1 AS ok FROM evidence_acquisition_decisions WHERE decision_id = 'ac260-decision'",
    );
    expect(decision.rows).toHaveLength(1);
    const bundle = await restored.query(
      "SELECT content_hash FROM evidence_bundles WHERE bundle_id = 'ac260-bundle'",
    );
    expect(bundle.rows).toHaveLength(1);
    const cp = await restored.query<{ cursor_position: string }>(
      "SELECT cursor_position FROM collector_checkpoints WHERE shard_id = 'shard-ac260'",
    );
    expect(Number(cp.rows[0]?.cursor_position)).toBe(42);

    const recaptured = await captureDeterministicSnapshot(restored, at(30));
    expect(recaptured.manifestHash).toBe(manifestHash);
  });

  it('critical metadata is recovered within its declared 15-minute RPO tier', async () => {
    // The declared tier is registered on the restored environment.
    await registerRecoveryTier(
      restored,
      {
        id: 'tier-ac260-metadata' as RecoveryTierId,
        dataClass: 'CRITICAL_METADATA',
        rpoTargetMinutes: 15,
        rtoTargetMinutes: 90,
      },
      at(31),
    );
    // Loss detected at +20; data recovered through +10 (RPO 10 ≤ 15);
    // service verified at +70 (RTO 50 min within the tier's RTO target).
    const outcome = await evaluateAndRecordDrill({
      engine: restored!,
      clock: fixedClock(at(70)),
      tier: {
        id: 'tier-ac260-metadata' as RecoveryTierId,
        dataClass: 'CRITICAL_METADATA',
        rpoTargetMinutes: 15,
        rtoTargetMinutes: 90,
      },
      capability: 'configuration-and-indexes',
      timeline: {
        lastDurableWriteAt: at(4),
        restoreStartedAt: at(20),
        dataRecoveredThroughAt: at(10),
        restoreCompletedAt: at(70),
      },
      measurementId: 'ac260-measurement-metadata',
    });
    expect(outcome.measurement.outcome).toBe('WITHIN_TIER');
    expect(outcome.measurement.achievedRpoMinutes).toBeLessThanOrEqual(15);
    expect(outcome.incidentId).toBeNull();
    expect(outcome.healthKind).toBe('HEALTHY');
  });

  it('critical observations/checkpoints are recovered within their declared 60-minute RPO tier', async () => {
    await registerRecoveryTier(
      restored,
      {
        id: 'tier-ac260-observations' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 60,
        rtoTargetMinutes: 120,
      },
      at(32),
    );
    // The snapshot was cut at +5, so the restored world holds every write up
    // to that instant: recovered-through (+5) minus last durable write (+2)
    // ⇒ RPO 3 minutes, comfortably inside the declared 60.
    const outcome = await evaluateAndRecordDrill({
      engine: restored!,
      clock: fixedClock(at(80)),
      tier: {
        id: 'tier-ac260-observations' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 60,
        rtoTargetMinutes: 120,
      },
      capability: 'observations',
      timeline: {
        lastDurableWriteAt: at(2),
        restoreStartedAt: at(20),
        dataRecoveredThroughAt: at(5),
        restoreCompletedAt: at(80),
      },
      measurementId: 'ac260-measurement-observations',
    });
    expect(outcome.measurement.outcome).toBe('WITHIN_TIER');
    expect(outcome.measurement.achievedRpoMinutes).toBeLessThanOrEqual(60);
    expect(outcome.incidentId).toBeNull();
  });

  it('both tiers met ⇒ opportunity mode is NOT blocked anywhere', async () => {
    const degraded = await restored!.query('SELECT * FROM recovery_health_states WHERE kind = $1', [
      'DEGRADED',
    ]);
    expect(degraded.rows).toHaveLength(0);
    const incidents = await restored!.query('SELECT * FROM recovery_incidents');
    expect(incidents.rows).toHaveLength(0);
  });
});
