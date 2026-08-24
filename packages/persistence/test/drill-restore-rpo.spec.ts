/**
 * Restore-drill harness + measured-RPO/RTO evaluation (
 * FR-DR-001/002, §34.5–§34.10, AC-062/AC-260/AC-261).
 *
 * Deterministic snapshot mechanism: identical data ⇒ identical snapshot
 * hashes. Clean-environment verification: tampered objects fail, missing
 * credential providers block, unregistered required checks block. Tier
 * measurements use ClockPort-injected timelines so ≤15 min / ≤60 min tiers
 * are measured exactly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  ErrorCode,
  ForesiftError,
  scriptedClock,
  utcTimestamp,
  type RecoveryTierId,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  achievedMinutes,
  applyMigrations,
  captureDeterministicSnapshot,
  collectorContinuityCheck,
  completeBackupRun,
  createEngine,
  crossStoreReferenceCheck,
  deterministicSnapshotMechanism,
  evaluateAndRecordDrill,
  failBackupRun,
  migrationStateCheck,
  objectHashCheck,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  registerGap,
  runRestoreDrill,
  seedDefaultRecoveryTiers,
  startBackupRun,
  type DatabaseEngine,
} from '../src/index.ts';
import { LocalFilesystemObjectStore } from '@foresift/object-store';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const T0 = Date.parse('2026-08-20T12:00:00.000Z');
const at = (offsetMinutes: number): UtcTimestamp =>
  utcTimestamp(new Date(T0 + offsetMinutes * 60_000).toISOString());

let db: PGlite;
let engine: DatabaseEngine;
let storeRoot: string;
let store: LocalFilesystemObjectStore;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  await seedDefaultRecoveryTiers(engine, at(0));
  storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foresift-drill-store-'));
  store = new LocalFilesystemObjectStore(storeRoot);
}, 120_000);

afterAll(async () => {
  await db.close();
  await fs.rm(storeRoot, { recursive: true, force: true });
});

describe('deterministic snapshot mechanism (ADR-0015)', () => {
  it('yields byte-identical snapshots for identical data regardless of timing', async () => {
    await engine.query(
      'INSERT INTO canonical_event_keys (canonical_key, event_family, first_seen_at) VALUES ($1,$2,$3)',
      ['snap-probe:1', 'snapshot_probe', at(0)],
    );
    const first = await captureDeterministicSnapshot(engine, at(0));
    // Wall-clock-independent second pass over the SAME data.
    const second = await captureDeterministicSnapshot(engine, at(500));
    expect(second.manifestHash).toBe(first.manifestHash);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(first.tables.length).toBeGreaterThan(20);
    const probe = first.tables.find((t) => t.name === 'table:canonical_event_keys');
    expect(probe?.rowCount).toBe(1);
  });

  it('changes the manifest hash when data changes', async () => {
    const before = await captureDeterministicSnapshot(engine, at(0));
    await engine.query(
      "INSERT INTO canonical_event_keys (canonical_key, event_family, first_seen_at) VALUES ('snap-probe:2','snapshot_probe',$1)",
      [at(0)],
    );
    const after = await captureDeterministicSnapshot(engine, at(0));
    expect(after.manifestHash).not.toBe(before.manifestHash);
  });

  it('exposes the mechanism port for production PITR implementations', async () => {
    const mechanism = deterministicSnapshotMechanism(engine);
    const snapshot = await mechanism.capture(at(0));
    expect(mechanism.mechanismKind).toBe('deterministic-dump');
    expect(snapshot.manifestHash.startsWith('sha256:')).toBe(true);
  });

  it('snapshot bytes restore into a fresh database byte-for-byte (round-trip fidelity)', async () => {
    await engine.query(
      'INSERT INTO canonical_event_keys (canonical_key, event_family, first_seen_at) VALUES ($1,$2,$3)',
      ['snap-roundtrip:1', 'snapshot_roundtrip', at(10)],
    );

    const original = await captureDeterministicSnapshot(engine, at(20));

    // A genuinely fresh database: same migrations, none of the source rows.
    const fresh = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    try {
      const restoredEngine = createEngine(fresh, 'pglite');
      await applyMigrations({ engine: restoredEngine, migrationsDir: MIGRATIONS_DIR });

      // Re-import exactly what a restore consumer reads from the artifact:
      // per-table canonical row JSON, replayed as parameterized inserts.
      const document = JSON.parse(new TextDecoder().decode(original.bytes)) as {
        tables: Record<string, string[]>;
      };
      const tableNames = Object.keys(document.tables);
      // Destructive restore semantics: migrations seed reference rows
      // (quality codes, tiers, …) that would collide with the artifact, and
      // the immutability triggers refuse TRUNCATE by design. A real restore
      // replays authoritative bytes OVER the migrated schema, bypassing
      // row-level write guards for the replay session only — the standard
      // PITR-replay idiom.
      await restoredEngine.exec('SET session_replication_role = replica');
      await restoredEngine.exec(`TRUNCATE ${tableNames.map((t) => `"${t}"`).join(', ')} CASCADE`);
      for (const [table, rowTexts] of Object.entries(document.tables)) {
        for (const rowText of rowTexts) {
          const row = JSON.parse(rowText) as Record<string, unknown>;
          const columns = Object.keys(row);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
          await restoredEngine.query(
            `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')})
             VALUES (${placeholders})`,
            columns.map((c) => row[c]),
          );
        }
      }

      // The replayed database must satisfy the normal write guards again.
      await restoredEngine.exec('RESET session_replication_role');

      const recaptured = await captureDeterministicSnapshot(restoredEngine, at(999));
      expect(recaptured.manifestHash).toBe(original.manifestHash);
      expect(Buffer.from(recaptured.bytes).equals(Buffer.from(original.bytes))).toBe(true);
    } finally {
      await fresh.close();
    }
  });
});

describe('backup run lifecycle (FR-DR-002)', () => {
  it('runs RUNNING → SUCCEEDED with artifacts; SUCCEEDED requires artifacts', async () => {
    await engine.query(
      `INSERT INTO backup_policies
         (policy_id, retention_days, encryption_status, location_ref, rights_ref,
          legal_hold, deletion_policy, key_reference)
       VALUES ('policy-drill', 7, 'SERVER_SIDE_AES256', 'location://test-domain',
               'rights://test/payloads', false, 'DELETE_AFTER_RETENTION', 'keyref:kms/drill')
       ON CONFLICT (policy_id) DO NOTHING`,
    );
    await startBackupRun(engine, { runId: 'run-ok', policyId: 'policy-drill', startedAt: at(0) });
    const snapshot = await captureDeterministicSnapshot(engine, at(1));
    await completeBackupRun(engine, {
      runId: 'run-ok',
      artifactRefs: [`store://backup/${snapshot.manifestHash}`],
      finishedAt: at(2),
    });
    const row = await engine.query<{ status: string; finished_at: string | null }>(
      'SELECT status, finished_at FROM backup_runs WHERE run_id = $1',
      ['run-ok'],
    );
    expect(row.rows[0]?.status).toBe('SUCCEEDED');
    await expect(
      startBackupRun(engine, { runId: 'run-orphan', policyId: 'no-such-policy', startedAt: at(0) }),
    ).rejects.toThrow(/unknown policy/);
  });

  it('records FAILED runs with a mandatory reason', async () => {
    await startBackupRun(engine, {
      runId: 'run-fail',
      policyId: 'policy-drill',
      startedAt: at(10),
    });
    await failBackupRun(engine, {
      runId: 'run-fail',
      reason: 'snapshot upload interrupted',
      failedAt: at(11),
    });
    const row = await engine.query<{ status: string; failure_reason: string }>(
      'SELECT status, failure_reason FROM backup_runs WHERE run_id = $1',
      ['run-fail'],
    );
    expect(row.rows[0]?.status).toBe('FAILED');
    expect(row.rows[0]?.failure_reason).toContain('interrupted');
  });
});

describe('clean-environment restore verifier (AC-261)', () => {
  const verifier = {
    async verifyArtifact(artifactId: string, expectedHash: string) {
      const verdict = await store.verify({ contentHash: expectedHash });
      if (verdict.outcome === 'VERIFIED')
        return { passed: true, detail: `hash verified (${artifactId})` };
      if (verdict.outcome === 'MISSING')
        return { passed: false, detail: `object missing: ${expectedHash}` };
      return {
        passed: false,
        detail: `hash mismatch: expected ${verdict.expected}, actual ${verdict.actual}`,
      };
    },
  };

  const checks = [
    migrationStateCheck(MIGRATIONS_DIR),
    objectHashCheck(verifier),
    crossStoreReferenceCheck,
    collectorContinuityCheck,
  ];

  const baseConfig = (drillId: string) => ({
    engine,
    drillId,
    startedAt: at(0),
    registeredChecks: checks,
    requiredChecks: checks.map((c) => c.name).concat(['audit-chain']),
    finishedAt: at(3),
  });

  it('refuses to run at all without a separately provided credential provider (fail closed)', async () => {
    const report = await runRestoreDrill({
      ...baseConfig('drill-no-creds'),
      credentialProvider: undefined,
    });
    expect(report.outcome).toBe('BLOCKED');
    expect(report.checks).toEqual([]);
    const row = await engine.query<{ outcome: string; credential_provider_present: boolean }>(
      'SELECT outcome, credential_provider_present FROM restore_drills WHERE drill_id = $1',
      ['drill-no-creds'],
    );
    expect(row.rows[0]?.outcome).toBe('BLOCKED');
    expect(row.rows[0]?.credential_provider_present).toBe(false);
  });

  it('blocks resumption while a declared check has no registered verifier (audit chain not built yet)', async () => {
    const report = await runRestoreDrill({
      ...baseConfig('drill-missing-check'),
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
    });
    expect(report.outcome).toBe('BLOCKED');
    const blockedCheck = report.checks.find((c) => c.name === 'audit-chain');
    expect(blockedCheck?.passed).toBe(false);
    expect(blockedCheck?.detail).toContain('no registered verifier');
  });

  it('blocks a zero-verification drill instead of passing vacuously', async () => {
    // Credentials present, but nothing registered and nothing required:
    // `[].every(...)` must never manufacture PASSED from zero evidence.
    const report = await runRestoreDrill({
      engine,
      drillId: 'drill-zero-checks',
      startedAt: at(0),
      registeredChecks: [],
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
      finishedAt: at(1),
    });
    expect(report.outcome).toBe('BLOCKED');
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.passed).toBe(false);
    expect(report.checks[0]?.detail).toContain('zero verifications');
    const row = await engine.query<{ outcome: string }>(
      'SELECT outcome FROM restore_drills WHERE drill_id = $1',
      ['drill-zero-checks'],
    );
    expect(row.rows[0]?.outcome).toBe('BLOCKED');
  });

  it('PASSES every owned check on an untampered environment once audit-chain is registered green', async () => {
    const report = await runRestoreDrill({
      ...baseConfig('drill-clean'),
      registeredChecks: [
        ...checks,
        { name: 'audit-chain', verify: async () => ({ passed: true, detail: 'chain intact' }) },
      ],
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
    });
    expect(report.outcome).toBe('PASSED');
    expect(report.checks.every((c) => c.passed)).toBe(true);
    const row = await engine.query<{ outcome: string; credential_provider_present: boolean }>(
      'SELECT outcome, credential_provider_present FROM restore_drills WHERE drill_id = $1',
      ['drill-clean'],
    );
    expect(row.rows[0]?.outcome).toBe('PASSED');
    expect(row.rows[0]?.credential_provider_present).toBe(true);
  });

  it('catches tampered object bytes as FAILED (never silent repair)', async () => {
    const bytes = new TextEncoder().encode('evidence-payload-for-drill');
    const stored = await store.put({
      artifactId: 'art-drill-1',
      bytes,
      metadata: {
        contentType: 'application/json',
        compression: 'NONE',
        encryptionStatus: 'PLAINTEXT',
        rightsRef: 'rights://test/payloads',
        retentionClass: 'RAW_PROVIDER_PAYLOAD_7D',
        tenantId: null,
        availabilityClass: 'REPLAYABLE_RAW_PAYLOADS',
      },
    });
    await engine.query(
      `INSERT INTO object_artifacts
         (artifact_id, content_hash, stage, encryption_status, retention_class, size_bytes, uploaded_at, hash_verified_at)
       VALUES ('art-drill-1',$1,'STORED_HASH_VERIFIED','PLAINTEXT','RAW_PROVIDER_PAYLOAD_7D',$2,$3,$4)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [stored.contentHash, bytes.byteLength, at(0), at(1)],
    );

    // Tamper with the physical blob.
    const hex = stored.contentHash.slice('sha256:'.length);
    const blobPath = path.join(
      storeRoot,
      'objects',
      hex.slice(0, 2),
      hex,
      `v${stored.version}.blob`,
    );
    await fs.writeFile(blobPath, new TextEncoder().encode('tampered!'));

    const report = await runRestoreDrill({
      ...baseConfig('drill-tampered'),
      registeredChecks: [
        ...checks,
        { name: 'audit-chain', verify: async () => ({ passed: true, detail: 'chain intact' }) },
      ],
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
    });
    expect(report.outcome).toBe('FAILED');
    const objectCheck = report.checks.find((c) => c.name === 'object-hashes');
    expect(objectCheck?.passed).toBe(false);
    expect(objectCheck?.detail).toMatch(/mismatch|missing/);
  });

  it('fails when a frozen evidence bundle manifest no longer matches its indexed hash', async () => {
    // Canonical JSON of {"bundle":"cross-store-probe","items":[1,2]} is exactly this text.
    const canonical = '{"bundle":"cross-store-probe","items":[1,2]}';
    // The indexed hash deliberately does NOT match the stored manifest.
    await engine.query(
      `INSERT INTO evidence_bundles (bundle_id, content_hash, manifest, frozen_at)
       VALUES ($1,$2,$3::jsonb,$4)`,
      ['bundle-cross-probe', `sha256:${'0'.repeat(64)}`, canonical, at(0)],
    );
    const report = await runRestoreDrill({
      ...baseConfig('drill-cross-tamper'),
      registeredChecks: [
        ...checks,
        { name: 'audit-chain', verify: async () => ({ passed: true, detail: 'chain intact' }) },
      ],
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
    });
    expect(report.outcome).toBe('FAILED');
    const cross = report.checks.find((c) => c.name === 'cross-store-references');
    expect(cross?.passed).toBe(false);
  });

  it('fails resumption when unresolved gaps sit below a checkpoint cursor', async () => {
    await engine.query(
      `INSERT INTO collector_checkpoints (shard_id, fencing_token, cursor_position, updated_at)
       VALUES ('shard-drill', 1, 100, now())`,
    );
    await registerGap(engine, {
      gapId: 'gap-drill-unresolved',
      shardId: 'shard-drill',
      gapStartSlot: 40,
      gapEndSlot: 50,
      reason: 'unresolved discontinuity discovered post-restore',
      registeredAt: at(0),
    });
    const report = await runRestoreDrill({
      ...baseConfig('drill-gap-block'),
      registeredChecks: [
        ...checks,
        { name: 'audit-chain', verify: async () => ({ passed: true, detail: 'chain intact' }) },
      ],
      credentialProvider: { providerId: 'keystore-primary', unlock: async () => {} },
    });
    const continuity = report.checks.find((c) => c.name === 'collector-checkpoints-gaps');
    expect(continuity?.passed).toBe(false);
    expect(continuity?.detail).toContain('shard-drill');
  });
});

describe('drill timeline honesty (AC-062): inconsistent timelines are refused', () => {
  it('computes exact minute deltas for a coherent timeline', () => {
    const achieved = achievedMinutes({
      lastDurableWriteAt: utcTimestamp('2026-06-01T11:48:00Z'),
      restoreStartedAt: utcTimestamp('2026-06-01T12:00:00Z'),
      dataRecoveredThroughAt: utcTimestamp('2026-06-01T11:51:00Z'),
      restoreCompletedAt: utcTimestamp('2026-06-01T12:40:00Z'),
    });
    expect(achieved.rpoMinutes).toBe(3);
    expect(achieved.rtoMinutes).toBe(40);
  });

  it('refuses a timeline whose recovery point precedes the last durable write', () => {
    // dataRecoveredThroughAt AFTER lastDurableWriteAt is the coherent loss
    // convention; a NEGATIVE delta means restored state predates acknowledged
    // writes — clamping that to 0 would score an impossible timeline HEALTHY.
    expect(() =>
      achievedMinutes({
        lastDurableWriteAt: utcTimestamp('2026-06-01T12:00:00Z'),
        restoreStartedAt: utcTimestamp('2026-06-01T12:05:00Z'),
        dataRecoveredThroughAt: utcTimestamp('2026-06-01T11:00:00Z'),
        restoreCompletedAt: utcTimestamp('2026-06-01T12:30:00Z'),
      }),
    ).toThrowError(ForesiftError);
  });

  it('refuses restore completion that precedes its own start', () => {
    try {
      achievedMinutes({
        lastDurableWriteAt: utcTimestamp('2026-06-01T11:00:00Z'),
        restoreStartedAt: utcTimestamp('2026-06-01T12:00:00Z'),
        dataRecoveredThroughAt: utcTimestamp('2026-06-01T10:30:00Z'),
        restoreCompletedAt: utcTimestamp('2026-06-01T11:59:00Z'),
      });
      expect.unreachable('negative RTO delta must be refused');
    } catch (err) {
      expect(err).toBeInstanceOf(ForesiftError);
      expect((err as ForesiftError).code).toBe(ErrorCode.DRILL_TIMELINE_INVALID);
    }
  });
});

describe('measured RPO/RTO vs configured tiers (AC-062/260/262)', () => {
  it('measures a within-tier metadata restore under the 15-minute ceiling using injected time', async () => {
    const timeline = {
      lastDurableWriteAt: at(-12), // last durable write 12 minutes before loss
      restoreStartedAt: at(0),
      dataRecoveredThroughAt: at(-9), // lost only 3 minutes of writes ⇒ RPO 3 min
      restoreCompletedAt: at(40), // RTO 40 min
    };
    const outcome = await evaluateAndRecordDrill({
      engine,
      // Scripted timeline injected as the drill clock (Constitution XI/XIII).
      clock: scriptedClock([timeline.restoreCompletedAt]).clock,
      tier: {
        id: 'tier-critical-metadata' as RecoveryTierId,
        dataClass: 'CRITICAL_METADATA',
        rpoTargetMinutes: 15,
        rtoTargetMinutes: 60,
      },
      capability: 'identity-metadata',
      timeline,
      measurementId: 'meas-drill-within',
    });
    expect(outcome.healthKind).toBe('HEALTHY');
    expect(outcome.incidentId).toBeNull();
    expect(outcome.measurement.outcome).toBe('WITHIN_TIER');
  });

  it('flips health DEGRADED, blocks opportunity influence, preserves risk monitoring, and opens an incident on a miss', async () => {
    // Critical observations/checkpoints tier: 60-minute RPO ceiling.
    const timeline = {
      lastDurableWriteAt: at(-200),
      restoreStartedAt: at(0),
      dataRecoveredThroughAt: at(-90), // RPO 110 min > 60 ⇒ miss
      restoreCompletedAt: at(30), // RTO 30 min within target
    };
    const outcome = await evaluateAndRecordDrill({
      engine,
      clock: scriptedClock([timeline.restoreCompletedAt]).clock,
      tier: {
        id: 'tier-critical-observations-checkpoints' as RecoveryTierId,
        dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
        rpoTargetMinutes: 60,
        rtoTargetMinutes: 120,
      },
      capability: 'observations',
      timeline,
      measurementId: 'meas-drill-miss',
    });
    expect(outcome.healthKind).toBe('DEGRADED');
    expect(outcome.measurement.outcome).toBe('MISSED_RPO');
    expect(outcome.incidentId).toBe('incident-meas-drill-miss');

    const incident = await engine.query<{ kind: string; resolved_at: string | null }>(
      'SELECT kind, resolved_at FROM recovery_incidents WHERE incident_id = $1',
      ['incident-meas-drill-miss'],
    );
    expect(incident.rows[0]?.kind).toBe('RPO_MISSED');
    expect(incident.rows[0]?.resolved_at).toBeNull();

    const health = await engine.query<Record<string, unknown>>(
      'SELECT * FROM recovery_health_states ORDER BY evaluated_at DESC LIMIT 1',
    );
    expect(health.rows[0]?.capability).toBe('observations');
    expect(health.rows[0]?.kind).toBe('DEGRADED');
    expect(health.rows[0]?.confirmed_opportunity_influence_blocked).toBe(true);
    expect(health.rows[0]?.deterministic_risk_monitoring_allowed).toBe(true);
  });
});
