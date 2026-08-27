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
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ArtifactRegistry,
  OperationRegistry,
  RightsMatrixEngine,
  type OperationTarget,
  type RightsChangeRecord,
  type RightsDeclaration,
} from '@foresift/provider-lifecycle';
import {
  closeProvTestDatabase,
  loadProvFixture,
  makeFixedClock,
  makeProvTestDatabase,
  provOperationDefinition,
  type ProvTestDatabase,
} from '../helpers/prov.ts';

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
const SCENARIO = loadProvFixture<Scenario>('scenarios', 'rights-change.scenario.json');

const clock = makeFixedClock('2026-08-26T12:00:00Z');

let tdb: ProvTestDatabase;
let rights: RightsMatrixEngine;
let artifacts: ArtifactRegistry;
const target: OperationTarget = {
  providerId: SCENARIO.providerId,
  operationId: SCENARIO.operationId,
  version: 'v1',
};
let changeRecord: RightsChangeRecord | undefined;

beforeAll(async () => {
  tdb = await makeProvTestDatabase();
  const registry = new OperationRegistry(tdb.engine, clock);
  await registry.registerProvider({
    providerId: SCENARIO.providerId,
    displayName: 'AC-273 provider',
    providerGroup: 'acceptance',
  });
  await registry.registerOperation(
    provOperationDefinition(target, {
      costClass: 'PAID_EXPLICIT',
      declaredIndependenceGroup: 'group-ac273',
      negativeCapabilities: [],
    }),
  );
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
  await closeProvTestDatabase(tdb);
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
      objectRef:
        SCENARIO.artifacts.find((a) => a.capturedRightsVersion === 2)?.objectRef ??
        'obs://scenario-artifact-2',
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
