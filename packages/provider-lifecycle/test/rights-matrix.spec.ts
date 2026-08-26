/**
 * T120: rights matrices (FR-PROV-009, AC-273). Sixteen-field versioned
 * declarations, consecutive-version change diffs into newly-prohibited use
 * paths, audited tightening, and the fail-closed per-artifact decision API.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditChain } from '@foresift/security';
import type { RightsUsePath } from '../src/index.ts';
import {
  RightsMatrixEngine,
  diffRights,
  ProvErrorCode,
} from '../src/index.ts';
import type { RightsDeclaration } from '../src/index.ts';
import { makeProvEngine, seedOperationRow, ts } from './helpers.ts';

let engine: Awaited<ReturnType<typeof makeProvEngine>>['engine'];
let closeDb: () => Promise<void>;
let rights: RightsMatrixEngine;

const NOW = ts('2026-08-26T12:00:00Z');
const LATER = ts('2027-08-26T12:00:00Z');

/** An OPEN declaration — every path allowed, long window. */
export function openDeclaration(overrides: Partial<RightsDeclaration> = {}): RightsDeclaration {
  return {
    commercialUseAllowed: true,
    personalResearchAllowed: true,
    cacheAllowed: true,
    maximumCacheDurationSeconds: 86_400,
    rawRetentionAllowed: true,
    derivedFeaturesAllowed: true,
    modelTrainingAllowed: true,
    redistributionAllowed: true,
    publicAlertDerivativeAllowed: true,
    attributionRequired: false,
    userByokRequired: false,
    rawExportAllowed: true,
    jurisdictionRestrictions: [],
    termsVersion: 'terms@1',
    verifiedAt: NOW,
    verificationExpiresAt: LATER,
    ...overrides,
  };
}

beforeAll(async () => {
  const made = await makeProvEngine();
  engine = made.engine;
  closeDb = () => made.db.close();
  // The declarations table carries a provider FK; seed one provider+operation.
  await seedOperationRow(engine, { providerId: 'prov-test', operationId: 'op-rights', version: 'v1' });
  rights = new RightsMatrixEngine({
    engine,
    clock: { now: () => NOW, nowEpochMs: () => Date.parse(NOW) },
    auditChain: new AuditChain({ engine }),
  });
});

afterAll(async () => {
  await closeDb();
});

describe('T120 pure diff', () => {
  it('maps true→false gate flips onto the seven use paths', () => {
    const to = openDeclaration({
      rawRetentionAllowed: false,
      modelTrainingAllowed: false,
      maximumCacheDurationSeconds: 60,
      jurisdictionRestrictions: ['EU'],
    });
    const { newlyProhibitedUses, tightened } = diffRights(openDeclaration(), to);
    expect(newlyProhibitedUses.sort()).toEqual(['MODEL_TRAINING', 'STORAGE']);
    expect(tightened).toBe(true);
  });

  it('is not a tightening when everything stays equal', () => {
    expect(diffRights(openDeclaration(), openDeclaration())).toEqual({
      newlyProhibitedUses: [],
      tightened: false,
    });
  });

  it('flags a shortened cache window as a tightening without a prohibited path', () => {
    const to = openDeclaration({ maximumCacheDurationSeconds: 10 });
    const result = diffRights(openDeclaration(), to);
    expect(result.newlyProhibitedUses).toEqual([]);
    expect(result.tightened).toBe(true);
  });
});

describe('T120 declarations + changes + fail-closed decisions', () => {
  it('declares v1 and refuses an inverted verification window', async () => {
    const declared = await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-rights',
      rightsVersion: 1,
      declaration: openDeclaration(),
    });
    expect(declared.declarationId.startsWith('prt:')).toBe(true);
    await expect(
      rights.declareRights({
        providerId: 'prov-test',
        operationId: 'op-bad',
        rightsVersion: 1,
        declaration: openDeclaration({ verifiedAt: LATER, verificationExpiresAt: NOW }),
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_MATRIX_INVALID });
  });

  it('records a tightening change with its computed diff and audits it', async () => {
    // Seed the audit count before the change.
    const before = await auditCount();
    const change = await rights.changeRights({
      providerId: 'prov-test',
      operationId: 'op-rights',
      nextVersion: 2,
      declaration: openDeclaration({
        termsVersion: 'terms@2',
        rawRetentionAllowed: false, // STORAGE newly prohibited
      }),
      actor: 'rights-operator',
      changedAt: ts('2026-08-26T13:00:00Z'),
    });
    expect(change.fromRightsVersion).toBe(1);
    expect(change.toRightsVersion).toBe(2);
    expect(change.newlyProhibitedUses).toContain('STORAGE');
    expect(change.changeId.startsWith('prc:')).toBe(true);
    expect((await auditCount()) - before).toBeGreaterThanOrEqual(1);

    // Replay resolves to the SAME change row (deterministic id) and does NOT
    // re-audit or advance the version again.
    const replay = await rights.changeRights({
      providerId: 'prov-test',
      operationId: 'op-rights',
      nextVersion: 2,
      declaration: openDeclaration({
        termsVersion: 'terms@2',
        rawRetentionAllowed: false,
      }),
      actor: 'rights-operator',
      changedAt: ts('2026-08-26T13:00:00Z'),
    });
    expect(replay.changeId).toBe(change.changeId);
    expect((await auditCount()) - before).toBe(1);
  });

  it('refuses a non-consecutive next version and a first change with no v1', async () => {
    await expect(
      rights.changeRights({
        providerId: 'prov-test',
        operationId: 'op-rights',
        nextVersion: 9,
        declaration: openDeclaration(),
        actor: 'x',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_MATRIX_INVALID });
    await expect(
      rights.changeRights({
        providerId: 'prov-test',
        operationId: 'op-never-declared',
        nextVersion: 2,
        declaration: openDeclaration(),
        actor: 'x',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN });
  });

  it('binds later tightenings onto pre-tightening captures and fails closed on unknown versions', async () => {
    // Artifact captured at v1: STORAGE was allowed AT CAPTURE TIME, but the
    // v2 tightening binds IMMEDIATELY (AC-273) — pre-tightening captures refuse.
    await expect(
      rights.decideForArtifact({
        providerId: 'prov-test',
        operationId: 'op-rights',
        capturedRightsVersion: 1,
        path: 'STORAGE' as RightsUsePath,
      }),
    ).resolves.toEqual({ allowed: false });
    // Captured at v2 → STORAGE is now PROHIBITED even though the row predates the change.
    await expect(
      rights.decideForArtifact({
        providerId: 'prov-test',
        operationId: 'op-rights',
        capturedRightsVersion: 2,
        path: 'STORAGE' as RightsUsePath,
      }),
    ).resolves.toEqual({ allowed: false });
    // Unknown captured version → hard refusal (fail-closed).
    await expect(
      rights.decideForArtifact({
        providerId: 'prov-test',
        operationId: 'op-rights',
        capturedRightsVersion: 99,
        path: 'STORAGE' as RightsUsePath,
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN });
  });

  it('fails closed on an expired verification window', async () => {
    await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-expired',
      rightsVersion: 1,
      declaration: openDeclaration({
        verifiedAt: ts('2026-08-01T00:00:00Z'),
        verificationExpiresAt: ts('2026-08-26T06:00:00Z'), // valid window, lapsed vs NOW
      }),
    });
    await expect(
      rights.decideForNewCapture({
        providerId: 'prov-test',
        operationId: 'op-expired',
        path: 'CACHING' as RightsUsePath,
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERIFICATION_EXPIRED });
  });

  it('fails closed for operations with NO declaration at all', async () => {
    await expect(
      rights.decideForNewCapture({
        providerId: 'prov-test',
        operationId: 'op-no-rights',
        path: 'EXPORT' as RightsUsePath,
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_RIGHTS_VERSION_UNKNOWN });
  });

  it('re-declaring the SAME version is idempotent (no duplicate rows)', async () => {
    await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-idem',
      rightsVersion: 1,
      declaration: openDeclaration(),
    });
    await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-idem',
      rightsVersion: 1,
      declaration: openDeclaration(),
    });
    const rows = await engine.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM prov.prov_rights_declarations
       WHERE provider_id='prov-test' AND operation_id='op-idem'`,
    );
    expect(Number(rows.rows[0]?.n ?? '0')).toBe(1);
  });
});

async function auditCount(): Promise<number> {
  const rows = await engine.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM sec.sec_audit_events');
  return Number(rows.rows[0]?.n ?? '0');
}
