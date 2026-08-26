/**
 * T121: provider artifact registry + rights-change enforcement (AC-273).
 * Capture-time registration binds each artifact to its rights version;
 * applying a tightening quarantines or retires every affected artifact
 * (STORAGE revoked ⇒ RETIRE), replays are fenced to identical ledgers, and
 * there is no reactivation path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ArtifactRegistry,
  RightsMatrixEngine,
  type OperationTarget,
  type RightsChangeRecord,
  type RightsDeclaration,
} from '../src/index.ts';
import { makeProvEngine, seedOperationRow, ts } from './helpers.ts';

let engine: Awaited<ReturnType<typeof makeProvEngine>>['engine'];
let closeDb: () => Promise<void>;
let artifacts: ArtifactRegistry;
let rights: RightsMatrixEngine;

const NOW = ts('2026-08-26T12:00:00Z');
const LATER = ts('2027-08-26T12:00:00Z');
const TARGET: OperationTarget = { providerId: 'prov-test', operationId: 'op-art', version: 'v1' };

function openDeclaration(overrides: Partial<RightsDeclaration> = {}): RightsDeclaration {
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
  artifacts = new ArtifactRegistry({
    engine,
    clock: { now: () => NOW, nowEpochMs: () => Date.parse(NOW) },
  });
  rights = new RightsMatrixEngine({
    engine,
    clock: { now: () => NOW, nowEpochMs: () => Date.parse(NOW) },
  });
});

afterAll(async () => {
  await closeDb();
});

/** Registers the operation row once so artifact FKs resolve. */
async function seedOperation(): Promise<void> {
  await seedOperationRow(engine, { providerId: 'prov-test', operationId: 'op-art', version: 'v1' });
}

describe('T121 artifact registry + enforcement', () => {
  it('registers artifacts at capture time, bound to their rights version', async () => {
    await seedOperation();
    await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-art',
      rightsVersion: 1,
      declaration: openDeclaration(),
    });
    const first = await artifacts.registerArtifact({
      target: TARGET,
      objectRef: 'obs://a1',
      rightsVersion: 1,
    });
    expect(first.state).toBe('ACTIVE');
    // Deterministic retry resolves to the same id without mutating state.
    const replay = await artifacts.registerArtifact({
      target: TARGET,
      objectRef: 'obs://a1',
      rightsVersion: 1,
    });
    expect(replay.artifactId).toBe(first.artifactId);
    const fetched = await artifacts.get(first.artifactId);
    expect(fetched).not.toBeNull();
    if (fetched !== null) {
      expect(fetched.rightsVersion).toBe(1);
      expect(fetched.objectRef).toBe('obs://a1');
    }
  });

  it('STORAGE newly prohibited ⇒ affected artifacts RETIRED', async () => {
    for (const ref of ['obs://s1', 'obs://s2']) {
      await artifacts.registerArtifact({ target: TARGET, objectRef: ref, rightsVersion: 1 });
    }
    const change: RightsChangeRecord = await rights.changeRights({
      providerId: 'prov-test',
      operationId: 'op-art',
      nextVersion: 2,
      declaration: openDeclaration({ rawRetentionAllowed: false, termsVersion: 'terms@2' }),
      actor: 'rights-operator',
    });
    expect(change.newlyProhibitedUses).toEqual(['STORAGE']);
    const applied = await artifacts.applyRightsChange({
      change,
      providerId: 'prov-test',
      operationId: 'op-art',
    });
    expect(applied).toHaveLength(3); // obs://a1 + s1 + s2
    expect(applied.every((a) => a.action === 'RETIRE')).toBe(true);
    const s1 = await artifacts.get(applied[0]?.artifactId ?? '');
    expect(s1?.state).toBe('RETIRED');
  });

  it('OTHER paths newly prohibited ⇒ QUARANTINE only', async () => {
    // v3 re-opens everything (loosening never REACTIVATES old rows, but new
    // captures under v3 are legitimate); v4 then closes MODEL_TRAINING only.
    await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-art',
      rightsVersion: 3,
      declaration: openDeclaration({ termsVersion: 'terms@3' }),
    });
    const active = await artifacts.registerArtifact({
      target: TARGET,
      objectRef: 'obs://v3-active',
      rightsVersion: 3,
    });
    expect(active.state).toBe('ACTIVE');
    const change: RightsChangeRecord = await rights.changeRights({
      providerId: 'prov-test',
      operationId: 'op-art',
      nextVersion: 4,
      declaration: openDeclaration({ termsVersion: 'terms@4', modelTrainingAllowed: false }),
      actor: 'rights-operator',
    });
    expect(change.newlyProhibitedUses).toEqual(['MODEL_TRAINING']);
    const applied = await artifacts.applyRightsChange({
      change,
      providerId: 'prov-test',
      operationId: 'op-art',
    });
    // Only the still-ACTIVE pre-v4 artifact is affected, and only QUARANTINED.
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual({ artifactId: active.artifactId, action: 'QUARANTINE' });
    const row = await artifacts.get(active.artifactId);
    expect(row?.state).toBe('QUARANTINED');
  });

  it('replays of the SAME change resolve to the SAME action ledger (INV-009)', async () => {
    await seedOperationRow(engine, {
      providerId: 'prov-test',
      operationId: 'op-replay',
      version: 'v1',
    });
    await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-replay',
      rightsVersion: 1,
      declaration: openDeclaration(),
    });
    const target: OperationTarget = {
      providerId: 'prov-test',
      operationId: 'op-replay',
      version: 'v1',
    };
    await artifacts.registerArtifact({ target, objectRef: 'obs://r1', rightsVersion: 1 });
    const change = await rights.changeRights({
      providerId: 'prov-test',
      operationId: 'op-replay',
      nextVersion: 2,
      declaration: openDeclaration({ redistributionAllowed: false, termsVersion: 'terms@2' }),
      actor: 'rights-operator',
    });
    expect(change.newlyProhibitedUses).toEqual(['REDISTRIBUTION']);
    const first = await artifacts.applyRightsChange({
      change,
      providerId: 'prov-test',
      operationId: 'op-replay',
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.action).toBe('QUARANTINE');
    // Replay: no NEW actions, no state loosening.
    const second = await artifacts.applyRightsChange({
      change,
      providerId: 'prov-test',
      operationId: 'op-replay',
    });
    expect(second).toHaveLength(0);
    const ledger = await artifacts.actionsForChange(change.changeId);
    expect(ledger).toHaveLength(1);
    const r1 = await artifacts.get(first[0]?.artifactId ?? '');
    expect(r1?.state).toBe('QUARANTINED');
  });

  it('a tightened change with NO newly-prohibited path executes no storage actions', async () => {
    await rights.declareRights({
      providerId: 'prov-test',
      operationId: 'op-window',
      rightsVersion: 1,
      declaration: openDeclaration(),
    });
    const change = await rights.changeRights({
      providerId: 'prov-test',
      operationId: 'op-window',
      nextVersion: 2,
      declaration: openDeclaration({ maximumCacheDurationSeconds: 30, termsVersion: 'terms@w2' }),
      actor: 'rights-operator',
    });
    expect(change.tightened).toBe(true);
    expect(change.newlyProhibitedUses).toEqual([]);
    const applied = await artifacts.applyRightsChange({
      change,
      providerId: 'prov-test',
      operationId: 'op-window',
    });
    expect(applied).toEqual([]);
  });

  it('enforcement never LOOSENS an already-enforced artifact', async () => {
    // op-replay's artifact was QUARANTINED by the REDISTRIBUTION closure
    // above; re-reading confirms no path has flipped it back toward ACTIVE.
    const rows = await engine.query<{ state: string }>(
      `SELECT state FROM prov.prov_provider_artifacts
       WHERE provider_id='prov-test' AND operation_id='op-replay' AND object_ref='obs://r1'`,
    );
    expect(rows.rows[0]?.state).toBe('QUARANTINED');
  });
});
