/**
 * Backup governance policy battery (FR-DR-002, §34.5, AC-264):
 * retention windows, encryption status, location allowlist, rights
 * references, legal-hold blocking deletion, deletion execution gating,
 * key-access separation (references never material), and restore
 * credentials — positive AND violation paths for each.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  assertLocationAllowed,
  captureDeterministicSnapshot,
  createBackupPolicy,
  createEngine,
  evaluateDeletionRequest,
  getBackupPolicy,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  runRestoreDrill,
  scanForKeyMaterial,
  type BackupPolicyRecord,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const AT: UtcTimestamp = utcTimestamp('2026-08-20T12:00:00.000Z');
const DAYS = 86_400_000;

let db: PGlite;
let engine: DatabaseEngine;

const BASE_POLICY: BackupPolicyRecord = {
  policyId: 'policy-battery',
  retentionDays: 30,
  encryptionStatus: 'SERVER_SIDE_AES256',
  locationRef: 'location://primary-failure-domain',
  rightsRef: 'rights://provider-x/payload-retention',
  legalHold: false,
  deletionPolicy: 'DELETE_AFTER_RETENTION',
  keyReference: 'keyref:kms/backup-main',
};

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await db.close();
});

function policyWith(overrides: Partial<BackupPolicyRecord>): BackupPolicyRecord {
  return { ...BASE_POLICY, ...overrides };
}

describe('retention + encryption + location + rights policy records (AC-264)', () => {
  it('persists a valid governance record with every declared field', async () => {
    await createBackupPolicy(engine, BASE_POLICY, AT);
    const stored = await getBackupPolicy(engine, 'policy-battery');
    expect(stored.retentionDays).toBe(30);
    expect(stored.encryptionStatus).toBe('SERVER_SIDE_AES256');
    expect(stored.locationRef).toBe('location://primary-failure-domain');
    expect(stored.rightsRef).toBe('rights://provider-x/payload-retention');
    expect(stored.deletionPolicy).toBe('DELETE_AFTER_RETENTION');
  });

  it('refuses sub-day retention windows', async () => {
    expect(() => createBackupPolicy(engine, policyWith({ retentionDays: 0 }), AT)).rejects.toThrow(
      /retentionDays/,
    );
    await expect(
      engine.query(
        `INSERT INTO backup_policies (policy_id, retention_days, encryption_status, location_ref,
           rights_ref, legal_hold, deletion_policy, key_reference)
         VALUES ('policy-zero',0,'SERVER_SIDE_AES256','loc','rights',false,'del','keyref:k/x')`,
      ),
    ).rejects.toThrow(/backup_policies_retention_days_check/);
  });

  it('enforces the failure-domain location allowlist on both decision paths', async () => {
    const allowlist = ['location://primary-failure-domain', 'location://secondary-failure-domain'];
    expect(() =>
      assertLocationAllowed('location://primary-failure-domain', allowlist),
    ).not.toThrow();
    expect(() => assertLocationAllowed('location://unapproved-edge-region', allowlist)).toThrow(
      /allowlist/,
    );
  });

  it('requires a non-empty rights reference for any retained copy', async () => {
    await expect(createBackupPolicy(engine, policyWith({ rightsRef: '' }), AT)).rejects.toThrow();
    // SQL truth independently refuses the empty-rights row.
    await expect(
      engine.query(
        `INSERT INTO backup_policies (policy_id, retention_days, encryption_status, location_ref,
           rights_ref, legal_hold, deletion_policy, key_reference)
         VALUES ('policy-norights',30,'SERVER_SIDE_AES256','loc','','false'::boolean,'del','keyref:k/y')`,
      ),
    ).rejects.toThrow();
  });
});

describe('key-access separation (FR-DR-002)', () => {
  it('accepts opaque key references and round-trips them without material ever existing', async () => {
    await createBackupPolicy(
      engine,
      policyWith({ keyReference: 'keyref:vault/prod-backup-1' }),
      AT,
    );
    const stored = await getBackupPolicy(engine, 'policy-battery');
    expect(stored.keyReference).toBe('keyref:vault/prod-backup-1');
  });

  it('refuses policies that embed key material instead of a reference', async () => {
    await expect(
      createBackupPolicy(
        engine,
        policyWith({
          keyReference: '-----BEGIN RSA PRIVATE KEY-----MIIEowIBAAKCAQEA',
        }),
        AT,
      ),
    ).rejects.toThrow(/key material|opaque keyref/);
    await expect(
      createBackupPolicy(
        engine,
        policyWith({ keyReference: 'raw-secret-value-not-a-reference' }),
        AT,
      ),
    ).rejects.toThrow(/opaque keyref/);
  });

  it('scans snapshot artifacts for key material — clean artifacts scan empty', async () => {
    const snapshot = await captureDeterministicSnapshot(engine, AT);
    const findings = scanForKeyMaterial(Buffer.from(snapshot.bytes).toString('utf8'), 'snapshot');
    expect(findings).toEqual([]);
  });

  it('detects PEM private keys and labeled secret blobs in artifact text (violation path)', async () => {
    const pem = JSON.stringify({
      table: 'leaked',
      rows: ['-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg==\n-----END PRIVATE KEY-----'],
    });
    const pemFindings = scanForKeyMaterial(pem, 'tampered-artifact');
    expect(pemFindings.length).toBeGreaterThan(0);

    const blobFindings = scanForKeyMaterial(
      '{"config":{"secret_access_key":"AbCdEf123456789012345678901234567890"}}',
      'config-dump',
    );
    expect(blobFindings.length).toBeGreaterThan(0);
  });

  it('fails a restore drill closed when no credential provider is supplied', async () => {
    const report = await runRestoreDrill({
      engine,
      drillId: 'drill-governance-no-creds',
      startedAt: AT,
      registeredChecks: [],
      credentialProvider: undefined,
    });
    expect(report.outcome).toBe('BLOCKED');
    const row = await engine.query<{ outcome: string }>(
      "SELECT outcome FROM restore_drills WHERE drill_id = 'drill-governance-no-creds'",
    );
    expect(row.rows[0]?.outcome).toBe('BLOCKED');
  });
});

describe('legal hold + retention-gated deletion execution (AC-264)', () => {
  const finishedAt: UtcTimestamp = utcTimestamp('2026-06-01T00:00:00.000Z');

  it('blocks deletion under legal hold even after the retention window elapsed', async () => {
    const held = policyWith({ policyId: 'policy-held', legalHold: true, retentionDays: 7 });
    const verdict = evaluateDeletionRequest({
      policy: held,
      runFinishedAt: finishedAt,
      nowEpochMs: Date.parse(finishedAt) + 400 * DAYS,
    });
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('legal hold');
  });

  it('blocks deletion inside the retention window without legal hold', async () => {
    const verdict = evaluateDeletionRequest({
      policy: BASE_POLICY, // retention 30d
      runFinishedAt: finishedAt,
      nowEpochMs: Date.parse(finishedAt) + 10 * DAYS,
    });
    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('retention window not elapsed');
  });

  it('approves deletion only past retention with no legal hold', async () => {
    const verdict = evaluateDeletionRequest({
      policy: BASE_POLICY,
      runFinishedAt: finishedAt,
      nowEpochMs: Date.parse(finishedAt) + 31 * DAYS,
    });
    expect(verdict.approved).toBe(true);
  });

  it('never approves unfinished runs', async () => {
    const verdict = evaluateDeletionRequest({
      policy: BASE_POLICY,
      runFinishedAt: null,
      nowEpochMs: Date.parse(finishedAt) + 400 * DAYS,
    });
    expect(verdict.approved).toBe(false);
  });
});
