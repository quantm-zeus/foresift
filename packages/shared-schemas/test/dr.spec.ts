import { describe, expect, it } from 'vitest';
import {
  RecoveryDataClass,
  degradedHealthState,
  utcTimestamp,
  validateRecoveryTier,
  type RecoveryTier,
} from '@foresift/domain';
import { DR_SCHEMAS, DR_SCHEMA_REGISTRY_VERSION, type DrSchemaName } from '../src/dr.ts';

const at = utcTimestamp;

const tierFixture: RecoveryTier = {
  id: 'tier-meta' as RecoveryTier['id'],
  dataClass: RecoveryDataClass.CRITICAL_METADATA,
  rpoTargetMinutes: 15,
  rtoTargetMinutes: 60,
};

const policyFixture = {
  policyId: 'bp-nightly',
  retentionDays: 35,
  encryptionStatus: 'AES_256_GCM',
  locationRef: 's3://foresift-backups-eu',
  rightsRef: 'rights/public-data-basis@2',
  legalHold: false,
  deletionPolicy: 'HARD_DELETE_AFTER_RETENTION',
  keyReference: 'keyref:kms/eu-primary/rotation-7',
};

const runFixture = {
  runId: 'run-1',
  policyId: 'bp-nightly',
  startedAt: at('2026-04-01T03:00:00Z'),
  finishedAt: at('2026-04-01T03:12:00Z'),
  status: 'SUCCEEDED',
  artifactRefs: ['sha256:' + 'aa'.repeat(32)],
  failureReason: null,
};

const drillFixture = {
  drillId: 'drill-q2',
  startedAt: at('2026-04-02T04:00:00Z'),
  finishedAt: at('2026-04-02T04:40:00Z'),
  outcome: 'PASSED',
  checks: [
    { checkId: 'chk-1', name: 'migration-state', passed: true, detail: 'schema current' },
    { checkId: 'chk-2', name: 'object-hashes', passed: true, detail: '42 verified' },
  ],
  credentialProviderPresent: true,
};

describe('dr schema registry', () => {
  it('is versioned and covers the FR-DR family', () => {
    expect(DR_SCHEMA_REGISTRY_VERSION).toBe(1);
    expect(Object.keys(DR_SCHEMAS).sort()).toEqual(
      [
        'BackupPolicy',
        'BackupRun',
        'ProtectedAsset',
        'RecoveryHealthState',
        'RecoveryTier',
        'RestoreDrill',
        'TierMeasurement',
      ].sort(),
    );
  });
});

describe('round-trip: domain fixtures validate against their mirrors ', () => {
  const positives: readonly [DrSchemaName, unknown][] = [
    ['RecoveryTier', tierFixture],
    [
      'TierMeasurement',
      {
        tierId: tierFixture.id,
        achievedRpoMinutes: 9,
        achievedRtoMinutes: 41,
        outcome: 'WITHIN_TIER',
      },
    ],
    [
      'ProtectedAsset',
      {
        assetKey: 'table:observations',
        dataClass: RecoveryDataClass.CRITICAL_OBSERVATIONS_CHECKPOINTS,
        tierId: 'tier-obs' as RecoveryTier['id'],
      },
    ],
    ['BackupPolicy', policyFixture],
    ['BackupRun', runFixture],
    ['RestoreDrill', drillFixture],
    [
      'RecoveryHealthState',
      degradedHealthState(
        'observations',
        'INC-77',
        at('2026-04-02T05:00:00Z'),
        'RPO missed by 4 min',
      ),
    ],
  ];

  it('every fixture parses against its named schema', () => {
    for (const [name, fixture] of positives) {
      const result = DR_SCHEMAS[name].safeParse(fixture);
      if (!result.success) {
        throw new Error(
          `${name} fixture failed round-trip validation: ${JSON.stringify(result.error.issues)}`,
        );
      }
      expect(result.success).toBe(true);
    }
  });

  it('agrees with the domain validator on ceilings', () => {
    const looser = { ...tierFixture, rpoTargetMinutes: 16 };
    expect(() => validateRecoveryTier(looser)).toThrowError();
    expect(DR_SCHEMAS.RecoveryTier.safeParse(looser).success).toBe(false);
  });
});

describe('negative fixtures fail validation ', () => {
  const mustFail = (name: DrSchemaName, payload: unknown, why: string): void => {
    expect(DR_SCHEMAS[name].safeParse(payload).success, `${name}: ${why}`).toBe(false);
  };

  it('refuses tiers above the FR-DR-001 (§34.4-bound) ceilings', () => {
    // Stricter-than-ceiling targets are always allowed.
    expect(
      DR_SCHEMAS.RecoveryTier.safeParse({
        ...tierFixture,
        dataClass: RecoveryDataClass.CRITICAL_OBSERVATIONS_CHECKPOINTS,
      }).success,
    ).toBe(true);
    mustFail(
      'RecoveryTier',
      {
        ...tierFixture,
        rpoTargetMinutes: 61,
        dataClass: RecoveryDataClass.CRITICAL_OBSERVATIONS_CHECKPOINTS,
      },
      '61 > 60-minute ceiling',
    );
    mustFail(
      'RecoveryTier',
      {
        ...tierFixture,
        rpoTargetMinutes: 1441,
        dataClass: RecoveryDataClass.REPLAYABLE_RAW_PAYLOADS,
      },
      '1441 > 24-hour ceiling',
    );
    mustFail('RecoveryTier', { ...tierFixture, rtoTargetMinutes: 0 }, 'nonpositive RTO');
  });

  it('refuses key material smuggled into key references', () => {
    mustFail(
      'BackupPolicy',
      {
        ...policyFixture,
        keyReference: 'AES256:' + 'a'.repeat(64),
      },
      'raw-looking material instead of an opaque reference',
    );
  });

  it('refuses successful runs without artifacts and failed runs without reasons', () => {
    mustFail(
      'BackupRun',
      { ...runFixture, artifactRefs: [] },
      'SUCCEEDED with no artifact references',
    );
    mustFail(
      'BackupRun',
      { ...runFixture, status: 'FAILED', failureReason: null, artifactRefs: [] },
      'FAILED without a reason',
    );
  });

  it('refuses PASSED drills lacking credentials or green checks (fail-closed)', () => {
    mustFail(
      'RestoreDrill',
      { ...drillFixture, credentialProviderPresent: false },
      'restore without separately provided credentials cannot pass',
    );
    mustFail(
      'RestoreDrill',
      {
        ...drillFixture,
        checks: [{ checkId: 'chk-1', name: 'object-hashes', passed: false, detail: 'mismatch' }],
      },
      'a red check blocks PASS',
    );
    mustFail('RestoreDrill', { ...drillFixture, finishedAt: null }, 'unfinished drill cannot pass');
  });

  it('refuses health states that suppress risk monitoring or lack incidents', () => {
    mustFail(
      'RecoveryHealthState',
      {
        capability: 'alerts',
        kind: 'DEGRADED',
        confirmedOpportunityInfluenceBlocked: true,
        deterministicRiskMonitoringAllowed: false,
        incidentId: 'INC-8',
        evaluatedAt: at('2026-04-02T05:00:00Z'),
        reason: 'missed tier',
      },
      'risk monitoring must stay allowed',
    );
    mustFail(
      'RecoveryHealthState',
      {
        capability: 'alerts',
        kind: 'DEGRADED',
        confirmedOpportunityInfluenceBlocked: false,
        deterministicRiskMonitoringAllowed: true,
        incidentId: null,
        evaluatedAt: at('2026-04-02T05:00:00Z'),
        reason: 'missed tier',
      },
      'degraded without incident/blocked flag',
    );
    mustFail(
      'RecoveryHealthState',
      {
        capability: 'alerts',
        kind: 'HEALTHY',
        confirmedOpportunityInfluenceBlocked: false,
        deterministicRiskMonitoringAllowed: true,
        incidentId: 'INC-9',
        evaluatedAt: at('2026-04-02T06:00:00Z'),
        reason: 'routine evaluation',
      },
      'healthy state carrying an incident',
    );
  });
});
