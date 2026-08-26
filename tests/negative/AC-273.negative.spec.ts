/**
 * AC-273 negative.
 * Traces: FR-PROV-009.
 * Post-change attempts on now-prohibited paths are refused; the affected-
 * artifact enumeration is COMPLETE with no silent retention; loosening a
 * right NEVER reactivates enforced artifacts, and divergent replays of an
 * already-recorded transition are refused outright.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type ClockPort, type UtcTimestamp } from '@foresift/domain';
import {
  ArtifactRegistry,
  OperationRegistry,
  ProvErrorCode,
  RightsMatrixEngine,
  type OperationDefinition,
  type OperationTarget,
  type RightsDeclaration,
} from '@foresift/provider-lifecycle';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';

interface Scenario {
  providerId: string;
  operationId: string;
  v1Declaration: RightsDeclaration;
  v2Declaration: RightsDeclaration;
}
const SCENARIO = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/prov/scenarios/rights-change.scenario.json'),
    'utf8',
  ),
) as Scenario;

const clock: ClockPort = {
  now: () => utcTimestamp('2026-08-26T12:00:00Z'),
  nowEpochMs: () => Date.parse('2026-08-26T12:00:00Z'),
};

let tdb: TestDatabase;
let rights: RightsMatrixEngine;
let artifacts: ArtifactRegistry;
const target: OperationTarget = {
  providerId: SCENARIO.providerId,
  operationId: `${SCENARIO.operationId}-neg`,
  version: 'v1',
};

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

function definition(): OperationDefinition {
  return {
    providerId: SCENARIO.providerId,
    operationId: target.operationId,
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
    declaredIndependenceGroup: 'group-ac273neg',
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

describe('AC-273 refusals and enforcement completeness', () => {
  let changeId = '';

  beforeAll(async () => {
    const registry = new OperationRegistry(tdb.engine, clock);
    await registry.registerProvider({
      providerId: SCENARIO.providerId,
      displayName: 'AC-273 negative provider',
      providerGroup: 'acceptance',
    });
    await registry.registerOperation(definition());
    rights = new RightsMatrixEngine({ engine: tdb.engine, clock });
    artifacts = new ArtifactRegistry({ engine: tdb.engine, clock });
    await rights.declareRights({
      providerId: SCENARIO.providerId,
      operationId: target.operationId,
      rightsVersion: 1,
      declaration: SCENARIO.v1Declaration,
    });
    await artifacts.registerArtifact({ target, objectRef: 'obs://neg-pre-tighten', rightsVersion: 1 });
    const change = await rights.changeRights({
      providerId: SCENARIO.providerId,
      operationId: target.operationId,
      nextVersion: 2,
      declaration: SCENARIO.v2Declaration,
      actor: 'ac273n-operator',
    });
    changeId = change.changeId;
  });

  it('post-change attempts on now-prohibited paths are REFUSED', async () => {
    for (const path of ['STORAGE', 'REDISTRIBUTION', 'EXPORT'] as const) {
      const verdict = await rights.decideForArtifact({
        providerId: SCENARIO.providerId,
        operationId: target.operationId,
        capturedRightsVersion: 1,
        path,
      });
      expect(verdict.allowed).toBe(false);
    }
  });

  it('enumeration is COMPLETE — no silent retention remains', async () => {
    const applied = await artifacts.applyRightsChange({
      change: {
        changeId,
        fromRightsVersion: 1,
        toRightsVersion: 2,
        newlyProhibitedUses: ['STORAGE', 'REDISTRIBUTION', 'EXPORT'],
        tightened: true,
      },
      providerId: SCENARIO.providerId,
      operationId: target.operationId,
    });
    expect(applied).toHaveLength(1); // obs://neg-pre-tighten

    // SQL sweep: ZERO artifacts remain ACTIVE below the tightening boundary.
    const remaining = await tdb.engine.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM prov.prov_provider_artifacts
       WHERE provider_id = $1 AND operation_id = $2
         AND rights_version < 2 AND state = 'ACTIVE'`,
      [SCENARIO.providerId, target.operationId],
    );
    expect(Number(remaining.rows[0]?.n ?? '0')).toBe(0);

    // The action ledger covers EVERY pre-boundary artifact exactly once.
    const ledger = await artifacts.actionsForChange(changeId);
    expect(ledger).toHaveLength(1);
  });

  it('replaying the execution does NOT duplicate actions or flip states back', async () => {
    const again = await artifacts.applyRightsChange({
      change: {
        changeId,
        fromRightsVersion: 1,
        toRightsVersion: 2,
        newlyProhibitedUses: ['STORAGE', 'REDISTRIBUTION', 'EXPORT'],
        tightened: true,
      },
      providerId: SCENARIO.providerId,
      operationId: target.operationId,
    });
    expect(again).toHaveLength(0);
    const ledger = await artifacts.actionsForChange(changeId);
    expect(ledger).toHaveLength(1);
  });

  it('LOOSENING never reactivates enforced artifacts without reverification', async () => {
    // v3 reopens everything the v2 tightening closed.
    const v3: RightsDeclaration = {
      ...SCENARIO.v2Declaration,
      termsVersion: 'terms@scenario-v3-loosened',
      rawRetentionAllowed: true,
      redistributionAllowed: true,
      rawExportAllowed: true,
    };
    const loosened = await rights.changeRights({
      providerId: SCENARIO.providerId,
      operationId: target.operationId,
      nextVersion: 3,
      declaration: v3,
      actor: 'ac273n-operator',
    });
    expect(loosened.newlyProhibitedUses).toEqual([]); // pure loosening
    expect(loosened.tightened).toBe(false);

    // The RETIRED artifact stays RETIRED; re-capture under v3 is the only road back.
    const rows = await tdb.engine.query<{ state: string }>(
      `SELECT state FROM prov.prov_provider_artifacts WHERE object_ref = 'obs://neg-pre-tighten'`,
    );
    expect(rows.rows[0]?.state).toBe('RETIRED');
  });

  it('a replay smuggling a DIFFERENT outcome into a recorded transition is refused outright', async () => {
    // Same transition (v1→v2), but the replay RE-OPENS raw retention —
    // laundering a loosening through the change ledger must fail: the first
    // recorded outcome of a transition is immutable.
    await expect(
      rights.changeRights({
        providerId: SCENARIO.providerId,
        operationId: target.operationId,
        nextVersion: 2,
        declaration: { ...SCENARIO.v2Declaration, rawRetentionAllowed: true },
        actor: 'ac273n-operator',
      }),
    ).rejects.toMatchObject({
      code: ProvErrorCode.PROV_RIGHTS_REACTIVATION_REQUIRES_REVERIFICATION,
    });
  });
});
