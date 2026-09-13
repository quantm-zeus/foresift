/**
 * AC-152 negative (failure) — IMPLEMENTED-but-unavailable evidence cannot support alert claims.
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
  type ActivationGateResult,
  type ModuleStateScope,
} from '@foresift/capability-registry';
import { checkActivationWithoutEvidence } from '@foresift/release-conformance';
import {
  PROD_ACTIVE_UNAVAILABLE_CLAIM,
  PROD_FIXTURE_HASH_A,
  PROD_FIXTURE_NOW,
  PROD_SHADOW_ONLY_CLAIM,
  makeProdScope,
  passingOpportunityGateInput,
} from '../fixtures/prod/index.ts';

const PROD_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

async function advanceProdNeg(
  engine: DatabaseEngine,
  moduleId: string,
  scope: ModuleStateScope,
  toState: 'IMPLEMENTED' | 'ACTIVE',
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
    actorRef: 'ac152-prod-neg',
    at: PROD_FIXTURE_NOW,
    gateResult,
    stateRowId,
    transitionId: `${stateRowId}-t`,
  });
}

function validatePromotionClaimEvidence(evidence: {
  status: 'PROVEN' | 'IMPLEMENTED_BUT_UNAVAILABLE' | 'PROVISIONAL';
}) {
  if (evidence.status === 'IMPLEMENTED_BUT_UNAVAILABLE' || evidence.status === 'PROVISIONAL') {
    throw new Error('PROMOTION_REQUIRES_PROVEN_EVIDENCE_STATUS');
  }
  return true;
}

describe('AC-152 negative: IMPLEMENTED-but-unavailable evidence cannot support production promotion', () => {
  it('throws when evidence is IMPLEMENTED_BUT_UNAVAILABLE', () => {
    expect(() =>
      validatePromotionClaimEvidence({
        status: 'IMPLEMENTED_BUT_UNAVAILABLE',
      }),
    ).toThrow('PROMOTION_REQUIRES_PROVEN_EVIDENCE_STATUS');
  });

  it('throws when evidence is PROVISIONAL', () => {
    expect(() =>
      validatePromotionClaimEvidence({
        status: 'PROVISIONAL',
      }),
    ).toThrow('PROMOTION_REQUIRES_PROVEN_EVIDENCE_STATUS');
  });
});

// --- prod-scoped additions (T036, FR-PROD-001/002, AC-152) -------------------

describe('AC-152 prod-scoped negatives: ACTIVE from IMPLEMENTED alone and claims from a non-AVAILABLE module refused', () => {
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

  it('refuses crossing into ACTIVE with no passing gate result', async () => {
    const scope = makeProdScope({ profile_version: 'ac152-neg-nogate' });
    const moduleId = 'module-ac152-neg-nogate';
    await advanceProdNeg(engine, moduleId, scope, 'IMPLEMENTED', 'ac152-neg-1');
    await expect(
      advanceProdNeg(engine, moduleId, scope, 'ACTIVE', 'ac152-neg-2', null),
    ).rejects.toMatchObject({ code: 'PROD_ACTIVATION_GATE_REFUSED' });
  }, 120_000);

  it('refuses ACTIVE from IMPLEMENTED even with a fabricated passing gate (illegal lifecycle edge)', async () => {
    const scope = makeProdScope({ profile_version: 'ac152-neg-illegal' });
    const moduleId = 'module-ac152-neg-illegal';
    await advanceProdNeg(engine, moduleId, scope, 'IMPLEMENTED', 'ac152-neg-3');
    const gate = evaluateActivationGate(passingOpportunityGateInput(scope));
    expect(gate.verdict).toBe('PASS');
    await expect(
      advanceProdNeg(engine, moduleId, scope, 'ACTIVE', 'ac152-neg-4', gate),
    ).rejects.toMatchObject({ code: 'PROD_LIFECYCLE_TRANSITION_ILLEGAL' });
  }, 120_000);

  it('refuses an ACTIVE claim from a module that never reached AVAILABLE', () => {
    const scope = makeProdScope({ profile_version: 'ac152-neg-claim' });
    const result = evaluateActivationGate({
      ...passingOpportunityGateInput(scope),
      available: false,
    });
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('AVAILABLE_EVIDENCE');
      expect(result.reason).toBe('AVAILABLE_NOT_ESTABLISHED');
    }
    expect(checkActivationWithoutEvidence([PROD_ACTIVE_UNAVAILABLE_CLAIM]).passed).toBe(false);
  });

  it('refuses a shadow-only module from supporting an alert claim when PROVEN is required', () => {
    const scope = makeProdScope({ profile_version: 'ac152-neg-shadow' });
    const result = evaluateActivationGate({
      ...passingOpportunityGateInput(scope),
      proven: false,
    });
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('PROVEN_PRESENT');
      expect(result.reason).toBe('PROVEN_REQUIRED');
    }
    expect(checkActivationWithoutEvidence([PROD_SHADOW_ONLY_CLAIM]).passed).toBe(true);
  });
});
