/**
 * AC-273 acceptance (positive).
 * Traces: FR-PROV-009.
 * AC text (manifest, abridged): a rights TIGHTENING immediately flips use
 * decisions to REFUSE for newly prohibited cache / raw-retention / export /
 * redistribution / model-use paths, and enumerates existing affected
 * artifacts into quarantine/retire actions.
 *
 * Scenario data: tests/fixtures/prov/scenarios/rights-change.scenario.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type ClockPort, type UtcTimestamp } from '@foresift/domain';
import {
  ArtifactRegistry,
  OperationRegistry,
  RightsMatrixEngine,
  type OperationDefinition,
  type OperationTarget,
  type RightsChangeRecord,
  type RightsDeclaration,
} from '@foresift/provider-lifecycle';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const SCENARIO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/prov/scenarios/rights-change.scenario.json',
);
interface Scenario {
  providerId: string;
  operationId: string;
  v1RightsVersion: number;
  v2RightsVersion: number;
  v1Declaration: RightsDeclaration;
  v2Declaration: RightsDeclaration;
  expectedDiff: { newlyProhibitedUses: string[]; tightened: boolean };
  artifacts: { objectRef: string; capturedRightsVersion: number; comment?: string }[];
}
const SCENARIO = JSON.parse(readFileSync(SCENARIO_PATH, 'utf8')) as Scenario;

const clock: ClockPort = {
  now: () => utcTimestamp('2026-08-26T12:00:00Z'),
  nowEpochMs: () => Date.parse('2026-08-26T12:00:00Z'),
};

let tdb: TestDatabase;
let rights: RightsMatrixEngine;
let artifacts: ArtifactRegistry;
const target: OperationTarget = {
  providerId: SCENARIO.providerId,
  operationId: SCENARIO.operationId,
  version: 'v1',
};
let changeRecord: RightsChangeRecord | undefined;

function definition(): OperationDefinition {
  return {
    providerId: SCENARIO.providerId,
    operationId: SCENARIO.operationId,
    version: 'v1',
    capabilityClass: 'READ_MARKET',
    costClass: 'PAID_EXPLICIT',
    supportedChains: ['solana'],
    supportedPrograms: [],
    inputSchemaId: 'in@1',
    rawOutputSchemaId: 'raw@1',
    normalizedOutputSchemaId: 'norm@1',
    quotaModelId: 'qm@1',
    cachePolicyId: 'cp@1',
    timeoutMs: 1000,
    retryPolicyId: 'rp@1',
    declaredIndependenceGroup: 'group-ac273',
    upstreamLineage: [],
    licensePolicyId: 'lic@1',
    estimatedQuotaUnits: 0,
    quotaResetPolicyId: 'qrp@1',
    batchCapability: null,
    minimumCandidateStage: null,
    protectedReserveEligible: false,
    allowedInStrictFree: false,
    paidFallbackAllowed: false,
    deprecatedAt: null,
    sunsetAt: null,
    replacementOperationId: null,
    verificationExpiresAt: utcTimestamp('2020-01-01T00:00:00Z') as UtcTimestamp,
    forbiddenOutputFields: [],
    negativeCapabilities: [],
  };
}

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const registry = new OperationRegistry(tdb.engine, clock);
  await registry.registerProvider({
    providerId: SCENARIO.providerId,
    displayName: 'AC-273 provider',
    providerGroup: 'acceptance',
  });
  await registry.registerOperation(definition());
  rights = new RightsMatrixEngine({ engine: tdb.engine, clock });
  artifacts = new ArtifactRegistry({ engine: tdb.engine, clock });

  await rights.declareRights({
    providerId: SCENARIO.providerId,
    operationId: SCENARIO.operationId,
    rightsVersion: SCENARIO.v1RightsVersion,
    declaration: SCENARIO.v1Declaration,
  });
  // Pre-tightening captures under v1.
  for (const artifact of SCENARIO.artifacts) {
    if (artifact.capturedRightsVersion === 1) {
      await artifacts.registerArtifact({
        target,
        objectRef: artifact.objectRef,
        rightsVersion: artifact.capturedRightsVersion,
      });
    }
  }
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-273 tightening enforcement', () => {
  it('records the v1→v2 change with the EXPECTED newly-prohibited diff', async () => {
    changeRecord = await rights.changeRights({
      providerId: SCENARIO.providerId,
      operationId: SCENARIO.operationId,
      nextVersion: SCENARIO.v2RightsVersion,
      declaration: SCENARIO.v2Declaration,
      actor: 'ac273-operator',
    });
    expect([...changeRecord.newlyProhibitedUses].sort()).toEqual(
      [...SCENARIO.expectedDiff.newlyProhibitedUses].sort(),
    );
    expect(changeRecord.tightened).toBe(true);
  });

  it('use decisions flip to REFUSE IMMEDIATELY on every newly prohibited path', async () => {
    if (changeRecord === undefined) throw new Error('change must be recorded first');
    const newlyProhibited = new Set(changeRecord.newlyProhibitedUses);
    // Every path the scenario closes refuses for pre-tightening captures.
    for (const path of ['STORAGE', 'REDISTRIBUTION', 'EXPORT'] as const) {
      expect(newlyProhibited.has(path)).toBe(true);
      const verdict = await rights.decideForArtifact({
        providerId: SCENARIO.providerId,
        operationId: SCENARIO.operationId,
        capturedRightsVersion: 1,
        path,
      });
      expect(verdict.allowed, `${path} must refuse after tightening`).toBe(false);
    }
    // Caching remains an ALLOWED gate — only its window shortened; the
    // decision API still admits it while cache layers bind to the shorter
    // maximum_cache_duration_seconds (dynamic enforcement).
    const caching = await rights.decideForArtifact({
      providerId: SCENARIO.providerId,
      operationId: SCENARIO.operationId,
      capturedRightsVersion: 1,
      path: 'CACHING',
    });
    expect(caching.allowed).toBe(true);
    // MODEL_TRAINING was already closed at v1 and stays closed at v2.
    const training = await rights.decideForArtifact({
      providerId: SCENARIO.providerId,
      operationId: SCENARIO.operationId,
      capturedRightsVersion: 1,
      path: 'MODEL_TRAINING',
    });
    expect(training.allowed).toBe(false);
  });

  it('enumerates affected artifacts into RETIRE actions (STORAGE revoked)', async () => {
    if (changeRecord === undefined) throw new Error('change must be recorded first');
    const applied = await artifacts.applyRightsChange({
      change: changeRecord,
      providerId: SCENARIO.providerId,
      operationId: SCENARIO.operationId,
    });
    // Exactly the pre-v2 ACTIVE artifact(s); STORAGE ∈ newly prohibited ⇒ RETIRE.
    const preV2Refs = SCENARIO.artifacts.filter((a) => a.capturedRightsVersion < 2);
    expect(applied).toHaveLength(preV2Refs.length);
    for (const action of applied) expect(action.action).toBe('RETIRE');
    for (const ref of preV2Refs.map((a) => a.objectRef)) {
      const row = await artifacts.get((await lookupByRef(ref)).artifactId);
      expect(row?.state).toBe('RETIRED');
    }
    // The post-change capture (captured AT v2) is NOT affected.
    const postCapture = await artifacts.registerArtifact({
      target,
      objectRef: SCENARIO.artifacts.find((a) => a.capturedRightsVersion === 2)?.objectRef ?? 'obs://scenario-artifact-2',
      rightsVersion: 2,
    });
    expect(postCapture.state).toBe('ACTIVE');
  });

  async function lookupByRef(ref: string): Promise<{ artifactId: string }> {
    const rows = await tdb.engine.query<{ artifact_id: string }>(
      `SELECT artifact_id FROM prov.prov_provider_artifacts WHERE object_ref = $1`,
      [ref],
    );
    const id = rows.rows[0]?.artifact_id;
    if (id === undefined) throw new Error(`no artifact row for ${ref}`);
    return { artifactId: id };
  }
});
