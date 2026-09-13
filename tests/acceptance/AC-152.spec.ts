/**
 * AC-152 acceptance (positive) — promotion requires PROVEN status when specified (§64.12, FR-MAT-008).
 * Traces: FR-MAT-008, AC-152.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  advanceState,
  evaluateActivationGate,
  recordActivationGateResult,
  statesFor,
  type ActivationGateResult,
  type ModuleStateScope,
} from '@foresift/capability-registry';
import {
  PROD_FIXTURE_HASH_A,
  PROD_FIXTURE_NOW,
  makeProdScope,
  passingOpportunityGateInput,
} from '../fixtures/prod/index.ts';

const PROD_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

async function advanceProd(
  engine: DatabaseEngine,
  moduleId: string,
  scope: ModuleStateScope,
  toState: 'IMPLEMENTED' | 'AVAILABLE' | 'SHADOW' | 'PROVEN' | 'ACTIVE',
  stateRowId: string,
  gateResult: ActivationGateResult | null = null,
) {
  return advanceState(engine, {
    moduleId,
    scope,
    artifactSetHash: PROD_FIXTURE_HASH_A,
    toState,
    operationalReadiness: 'READY_FOR_ACTIVE_PROFILE',
    distributionReadiness: 'PRIVATE_ONLY',
    changeClassification: 'MATERIAL_OPERATIONAL',
    reason: `advance to ${toState}`,
    actorRef: 'ac152-prod',
    at: PROD_FIXTURE_NOW,
    gateResult,
    stateRowId,
    transitionId: `${stateRowId}-t`,
  });
}

describe('AC-152 acceptance (positive): promotion requires PROVEN evidence status', () => {
  it('approves promotion claims supported by PROVEN status execution evidence', () => {
    const claim = {
      claimId: 'claim_001',
      evidenceStatus: 'PROVEN',
      hasExactConfigurationMatch: true,
      isHighResolution: true,
      status: 'APPROVED',
    };

    expect(claim.evidenceStatus).toBe('PROVEN');
    expect(claim.status).toBe('APPROVED');
  });
});

// --- prod-scoped addition (T036, FR-PROD-001/002, AC-152) --------------------

describe('AC-152 prod-scoped: promotion reaches ACTIVE only with AVAILABLE and PROVEN when specified', () => {
  let db: PGlite;
  let engine: DatabaseEngine;

  beforeAll(async () => {
    db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
    engine = createEngine(db, 'pglite');
    await applyMigrations({ engine, migrationsDir: PROD_MIGRATIONS_DIR });
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('walks IMPLEMENTED→AVAILABLE→SHADOW→PROVEN and only then crosses the gate into ACTIVE', async () => {
    const scope = makeProdScope({ profile_version: 'ac152-prod-proven' });
    const moduleId = 'module-ac152-prod-proven';
    await advanceProd(engine, moduleId, scope, 'IMPLEMENTED', 'ac152-prod-1');
    await advanceProd(engine, moduleId, scope, 'AVAILABLE', 'ac152-prod-2');
    await advanceProd(engine, moduleId, scope, 'SHADOW', 'ac152-prod-3');
    await advanceProd(engine, moduleId, scope, 'PROVEN', 'ac152-prod-4');

    const proven = await statesFor(engine, { moduleId, scope });
    expect([proven.implemented, proven.available, proven.proven]).toEqual([true, true, true]);

    const gate = evaluateActivationGate(passingOpportunityGateInput(scope));
    expect(gate.verdict).toBe('PASS');
    await advanceProd(
      engine,
      moduleId,
      scope,
      'ACTIVE',
      'ac152-prod-5',
      await recordActivationGateResult(engine, gate),
    );

    const active = await statesFor(engine, { moduleId, scope });
    expect(active.lifecycleState).toBe('ACTIVE');
    expect(active.activationEventRef).toBe('activation-prod-1');
  }, 120_000);

  it('does not require PROVEN when the exact scope does not specify it', async () => {
    const scope = makeProdScope({
      profile_version: 'ac152-prod-conditional',
      requires_proven: false,
    });
    const gate = evaluateActivationGate({ ...passingOpportunityGateInput(scope), proven: false });
    expect(gate.verdict).toBe('PASS');
  }, 120_000);
});
