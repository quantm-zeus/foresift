/**
 * AC-264 negative / failure-path.
 * Traces: FR-DR-001, FR-DR-002.
 * Every loosening of backup governance is refused with a typed error:
 * degenerate retention windows, blank references, non-opaque or
 * material-bearing key fields, off-allowlist locations — and a restore
 * drill without its separately provided credentials blocks before any
 * verification runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  assertLocationAllowed,
  createBackupPolicy,
  migrationStateCheck,
  runRestoreDrill,
  scanForKeyMaterial,
  validateBackupPolicy,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  MIGRATIONS_DIR,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-264 negative: loosened governance fails typed validation', () => {
  const VALID = {
    policyId: 'policy-ac264n-base',
    retentionDays: 30,
    encryptionStatus: 'SERVER_SIDE_AES256',
    locationRef: 'primary-region-a',
    rightsRef: 'rights/provider-tos-v1',
    legalHold: false,
    deletionPolicy: 'HARD_DELETE_AFTER_RETENTION',
    keyReference: 'keyref:keystore-primary/ac264n',
  } as const;

  it('degenerate retention windows are refused', () => {
    for (const retentionDays of [0, -5]) {
      expect(() =>
        validateBackupPolicy({ ...VALID, policyId: `p-${retentionDays}`, retentionDays }),
      ).toThrow(/BACKUP_POLICY_INVALID/);
    }
    expect(() =>
      validateBackupPolicy({
        ...VALID,
        policyId: 'p-fractional',
        retentionDays: 2.5,
      }),
    ).toThrow();
  });

  it('blank governance references are refused', () => {
    for (const field of [
      'encryptionStatus',
      'locationRef',
      'rightsRef',
      'deletionPolicy',
    ] as const) {
      expect(() =>
        validateBackupPolicy({ ...VALID, policyId: `p-blank-${field}`, [field]: '   ' }),
      ).toThrow(/BACKUP_POLICY_INVALID/);
    }
  });

  it('non-opaque key references are refused', () => {
    expect(() =>
      validateBackupPolicy({ ...VALID, policyId: 'p-rawkey', keyReference: 'a3f9c1d0e7b2' }),
    ).toThrow(/BACKUP_POLICY_INVALID/);
    expect(() =>
      validateBackupPolicy({
        ...VALID,
        policyId: 'p-pemkey',
        keyReference: '-----BEGIN PRIVATE KEY-----',
      }),
    ).toThrow(/BACKUP_POLICY_INVALID/);
  });

  it('key material embedded in any policy field is refused fail-closed', async () => {
    const embedding = {
      ...VALID,
      policyId: 'policy-ac264n-embedded',
      rightsRef: 'rights/provider-tos-v1\naws4_secret_access_key=wJalrXUtnFEMI',
    };
    await expect(
      createBackupPolicy(tdb.engine, embedding, T('2026-06-01T12:30:00Z')),
    ).rejects.toMatchObject({ code: ErrorCode.BACKUP_POLICY_INVALID });
    // And nothing persisted.
    const rows = await tdb.engine.query(
      "SELECT 1 FROM backup_policies WHERE policy_id = 'policy-ac264n-embedded'",
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('off-allowlist backup locations are refused', () => {
    expect(() => assertLocationAllowed('unknown-region-z', ['primary-region-a'])).toThrow(
      /BACKUP_POLICY_INVALID/,
    );
  });

  it('key-material scanning flags tampered artifact text', () => {
    const findings = scanForKeyMaterial(
      '{"note":"rotate me"}\n-----BEGIN CERTIFICATE-----\nMIIDdTCC',
      'artifact/suspect',
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.location).toBe('artifact/suspect');
  });

  it('a restore drill without restore credentials blocks before any check runs', async () => {
    let checksRan = false;
    const report = await runRestoreDrill({
      engine: tdb.engine,
      drillId: 'drill-ac264n-no-credentials',
      startedAt: T('2026-06-01T13:10:00Z'),
      registeredChecks: [
        migrationStateCheck(MIGRATIONS_DIR),
        {
          name: 'never-ran',
          verify: async () => {
            checksRan = true;
            return { passed: true, detail: 'should never execute' };
          },
        },
      ],
    });
    expect(report.outcome).toBe('BLOCKED');
    expect(report.checks).toHaveLength(0);
    expect(checksRan).toBe(false);

    const row = await tdb.engine.query<{ credential_provider_present: boolean; outcome: string }>(
      'SELECT credential_provider_present, outcome FROM restore_drills WHERE drill_id = $1',
      ['drill-ac264n-no-credentials'],
    );
    expect(row.rows[0]?.outcome).toBe('BLOCKED');
    expect(row.rows[0]?.credential_provider_present).toBe(false);
  });
});
