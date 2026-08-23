/**
 * AC-062 acceptance (positive) — task T060.
 * Traces: FR-DR-001, FR-DR-002.
 * AC text (manifest §39.7): "Backup restore meets configured RPO/RTO in a
 * restore drill."
 *
 * Full destructive drill on a fixture workload: capture a deterministic
 * backup, destroy the environment, restore into a clean database from the
 * snapshot bytes, verify the restored world, and measure RPO/RTO against
 * the configured tier with an injected clock — WITHIN_TIER, no incident.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock, utcTimestamp, type RecoveryTierId, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  applyMigrations,
  captureDeterministicSnapshot,
  commitCheckpoint,
  completeBackupRun,
  createBackupPolicy,
  createEngine,
  evaluateAndRecordDrill,
  migrationStateCheck,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordAcquisitionDecision,
  registerRecoveryTier,
  runRestoreDrill,
  seedDefaultRecoveryTiers,
  startBackupRun,
  type DatabaseEngine,
} from '@foresift/persistence';
import { AcquisitionState } from '@foresift/domain';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  restoreSnapshotInto,
  seedPool,
  type TestDatabase,
} from './helpers.ts';

const T0 = Date.parse('2026-06-01T12:00:00.000Z');
const at = (offsetMinutes: number): UtcTimestamp =>
  utcTimestamp(new Date(T0 + offsetMinutes * 60_000).toISOString());

let source: TestDatabase;
let restoredDb: PGlite | undefined;
let restored: DatabaseEngine;
let manifestHash = '';

async function buildFixtureWorkload(engine: DatabaseEngine): Promise<void> {
  // Metadata-class configuration/decisions + observations/checkpoints class.
  const poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac062',
  });
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac062-decision',
    candidateId: 'cand/ac062',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: at(0),
  });
  await appendObservation(engine, {
    observationId: 'ac062-obs',
    subjectPoolId: poolId,
    eventAt: at(0),
    availableAt: at(1),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '500',
    decimals: 2,
  });
  await commitCheckpoint(engine, { shardId: 'shard-ac062', fencingToken: 1, cursorPosition: 7 });
}

beforeAll(async () => {
  source = await makeTestDatabase();
  // Recovery-tier configuration exists in BOTH worlds at the same seeded
  // instant so the restored environment can reproduce it byte-identically.
  await seedDefaultRecoveryTiers(source.engine, at(0));
  await buildFixtureWorkload(source.engine);
});

afterAll(async () => {
  await closeTestDatabase(source);
  if (restoredDb) await restoredDb.close();
});

describe('AC-062: backup restore meets configured RPO/RTO in a drill', () => {
  it('backup → destroy → clean-environment restore reproduces the workload byte-identically', async () => {
    // 1. Backup: governed policy + deterministic snapshot + recorded run.
    await createBackupPolicy(
      source.engine,
      {
        policyId: 'policy-ac062',
        retentionDays: 30,
        encryptionStatus: 'SERVER_SIDE_AES256',
        locationRef: 'primary-region-a',
        rightsRef: 'rights/provider-tos-v1',
        legalHold: false,
        deletionPolicy: 'HARD_DELETE_AFTER_RETENTION',
        keyReference: 'keyref:keystore-primary/ac062',
      },
      at(9),
    );
    const snapshot = await captureDeterministicSnapshot(source.engine, at(10));
    manifestHash = snapshot.manifestHash;
    await startBackupRun(source.engine, {
      runId: 'run-ac062',
      policyId: 'policy-ac062',
      startedAt: at(10),
    });
    await completeBackupRun(source.engine, {
      runId: 'run-ac062',
      artifactRefs: snapshot.tables.map((t) => `${t.name}@${t.contentHash}`),
      finishedAt: at(12),
    });

    // 2. Destroy: the "lost" environment is a brand-new empty database…
    restoredDb = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    restored = createEngine(restoredDb, 'pglite');
    await applyMigrations({ engine: restored, migrationsDir: MIGRATIONS_DIR });
    // Identical configuration seed as the lost world.
    await seedDefaultRecoveryTiers(restored, at(0));

    // 3. Restore: load the snapshot's canonical rows into the clean env.
    const restoredRows = await restoreSnapshotInto(restored, snapshot);
    expect(restoredRows).toBeGreaterThan(4); // tiers + policy-run rows + workload

    // 4. Verify: re-capturing the restored world must be hash-identical to
    // the original backup (byte-for-byte recovery of the fixture workload).
    const recaptured = await captureDeterministicSnapshot(restored, at(30));
    expect(recaptured.manifestHash).toBe(manifestHash);
  });

  it('the measured restore lands WITHIN the configured tier — no incident, health untouched', async () => {
    // Register the configured drill tier on the restored environment (RPO 15
    // is within the 60-minute class ceiling; incidents FK tier ids).
    await registerRecoveryTier(
      restored,
      {
        id: 'tier-ac062-observations' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 15,
        rtoTargetMinutes: 60,
      },
      at(15),
    );
    // Scripted timeline: loss detected 20 min after the backup; recovery
    // through the snapshot instant (RPO 5 min ≤ target); service verified
    // restored 40 min after detection start (RTO 40 min ≤ target).
    const outcome = await evaluateAndRecordDrill({
      engine: restored,
      clock: fixedClock(at(60)),
      tier: {
        id: 'tier-ac062-observations' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 15,
        rtoTargetMinutes: 60,
      },
      capability: 'observations',
      timeline: {
        lastDurableWriteAt: at(5),
        restoreStartedAt: at(20),
        dataRecoveredThroughAt: at(10),
        restoreCompletedAt: at(60),
      },
      measurementId: 'ac062-measurement-within',
    });
    expect(outcome.measurement.outcome).toBe('WITHIN_TIER');
    expect(outcome.measurement.achievedRpoMinutes).toBe(5);
    expect(outcome.measurement.achievedRtoMinutes).toBe(40);
    expect(outcome.incidentId).toBeNull();
    expect(outcome.healthKind).toBe('HEALTHY');

    const incidents = await restored.query('SELECT * FROM recovery_incidents');
    expect(incidents.rows).toHaveLength(0);
  });

  it('the restored environment passes the owned clean-environment checks', async () => {
    const report = await runRestoreDrill({
      engine: restored,
      drillId: 'drill-ac062-clean',
      startedAt: at(61),
      finishedAt: at(62),
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
      registeredChecks: [migrationStateCheck(MIGRATIONS_DIR)],
    });
    expect(report.outcome).toBe('PASSED');
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });
});
