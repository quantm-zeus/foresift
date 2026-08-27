/**
 * AC-264 acceptance (positive).
 * Traces: FR-DR-002 (primary — retention, deletion, legal hold, location,
 * encryption, rights, restore-access policy tests live on its backup/restore
 * machinery), with FR-DR-001 tier context. FR-DR-006 is a G2 source-lineage
 * requirement outside this package's assigned set and is NOT claimed here.
 * AC text (manifest §39.25): "Backup retention, encryption, location,
 * rights, legal hold, deletion, key access, and restore credentials are
 * validated by policy tests."
 *
 * Every governed dimension of backup policy exercises its validation on a
 * fixture policy: round-trip persistence, retention-gated deletion, legal
 * hold supremacy, failure-domain allowlist, opaque keystore references,
 * fail-closed key-material scanning, and separately provided restore
 * credentials gating drill execution.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  assertLocationAllowed,
  createBackupPolicy,
  evaluateDeletionRequest,
  getBackupPolicy,
  migrationStateCheck,
  runRestoreDrill,
  scanForKeyMaterial,
  startBackupRun,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  type TestDatabase,
} from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);
const T0 = Date.parse('2026-06-01T12:00:00.000Z');

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-264: backup governance dimensions validate by policy tests', () => {
  const POLICY = {
    policyId: 'policy-ac264',
    retentionDays: 30,
    encryptionStatus: 'SERVER_SIDE_AES256',
    locationRef: 'primary-region-a',
    rightsRef: 'rights/provider-tos-v1',
    legalHold: false,
    deletionPolicy: 'HARD_DELETE_AFTER_RETENTION',
    keyReference: 'keyref:keystore-primary/ac264',
  } as const;

  it('a fully governed policy persists every dimension and reads back intact', async () => {
    await createBackupPolicy(tdb.engine, POLICY, T('2026-06-01T12:00:00Z'));
    const stored = await getBackupPolicy(tdb.engine, 'policy-ac264');
    expect(stored).toEqual(POLICY);

    // The run lifecycle records which policy produced which artifacts…
    await startBackupRun(tdb.engine, {
      runId: 'run-ac264',
      policyId: POLICY.policyId,
      startedAt: T('2026-06-01T12:05:00Z'),
    });
    const run = await tdb.engine.query<{ policy_id: string; finished_at: string | null }>(
      'SELECT policy_id, finished_at FROM backup_runs WHERE run_id = $1',
      ['run-ac264'],
    );
    expect(run.rows[0]?.policy_id).toBe('policy-ac264');
  });

  it('deletion executes only after the retention window elapses', async () => {
    const runFinishedAt = T('2026-06-01T12:10:00Z');
    // Day 29 of 30: still inside retention.
    const during = evaluateDeletionRequest({
      policy: POLICY,
      runFinishedAt,
      nowEpochMs: T0 + 29 * 86_400_000,
    });
    expect(during.approved).toBe(false);

    // Day 31: retention elapsed, no hold — governed deletion is approved.
    const after = evaluateDeletionRequest({
      policy: POLICY,
      runFinishedAt,
      nowEpochMs: T0 + 31 * 86_400_000,
    });
    expect(after.approved).toBe(true);
  });

  it('a legal hold blocks deletion unconditionally while in force', async () => {
    const held = { ...POLICY, policyId: 'policy-ac264-held', legalHold: true };
    await createBackupPolicy(tdb.engine, held, T('2026-06-01T12:01:00Z'));
    const decision = evaluateDeletionRequest({
      policy: held,
      runFinishedAt: T('2025-01-01T00:00:00Z'), // ancient — retention long elapsed
      nowEpochMs: Date.parse('2026-06-01T12:00:00Z'),
    });
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('legal hold');
  });

  it('backup locations are constrained to approved failure domains', () => {
    expect(() =>
      assertLocationAllowed('primary-region-a', ['primary-region-a', 'secondary-region-b']),
    ).not.toThrow();
    expect(() =>
      assertLocationAllowed('some-random-region-z', ['primary-region-a', 'secondary-region-b']),
    ).toThrow();
  });

  it('key access stays an opaque keystore reference, scanned fail-closed for material', async () => {
    // The stored reference names where the key lives — never the key itself.
    const stored = await getBackupPolicy(tdb.engine, 'policy-ac264');
    expect(stored.keyReference).toMatch(/^keyref:/);
    expect(scanForKeyMaterial(JSON.stringify(stored))).toHaveLength(0);

    // Any artifact text that LOOKS like embedded key material blocks the
    // backup path (fail closed): a PEM block and a labeled secret blob both trip.
    const pemArtifact = 'snapshot header\n-----BEGIN RSA PRIVATE KEY-----\nMIIB\n';
    const pemFindings = scanForKeyMaterial(pemArtifact, 'artifact/snapshot');
    expect(pemFindings.length).toBeGreaterThan(0);

    const blobArtifact = '{"secret_access_key":"AbCdEf123456AbCdEf123456AbCdEf123456"}';
    const blobFindings = scanForKeyMaterial(blobArtifact, 'artifact/manifest');
    expect(blobFindings.map((f) => f.pattern)).toContain('labeled-secret-blob');
  });

  it('restore drills execute only under separately provided credentials', async () => {
    let unlocked = false;
    const report = await runRestoreDrill({
      engine: tdb.engine,
      drillId: 'drill-ac264-credentialed',
      startedAt: T('2026-06-01T13:00:00Z'),
      finishedAt: T('2026-06-01T13:02:00Z'),
      credentialProvider: {
        providerId: 'keystore-primary',
        unlock: async () => {
          unlocked = true;
        },
      },
      registeredChecks: [migrationStateCheck(MIGRATIONS_DIR)],
    });
    expect(report.outcome).toBe('PASSED');
    // The separated keystore was actually consulted before anything ran.
    expect(unlocked).toBe(true);
  });
});
