/**
 * AC-272 acceptance (positive).
 * Traces: FR-PROV-009, FR-PROV-002, FR-PROV-003, FR-PROV-004.
 * AC text (manifest, abridged): FULLY verified rights + healthy lifecycle +
 * zero prohibited exposure yields ELIGIBLE readiness for the future
 * workspace/public activation gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditChain } from '@foresift/security';
import {
  LifecycleMachine,
  OperationRegistry,
  ReadinessEvaluator,
  RightsMatrixEngine,
  VerificationTtlEngine,
} from '@foresift/provider-lifecycle';
import type { OperationTarget, ProviderVerificationKind } from '@foresift/provider-lifecycle';
import {
  closeProvTestDatabase,
  makeFixedClock,
  makeProvTestDatabase,
  openRightsDeclaration,
  provOperationDefinition,
  recordVerificationPair,
  type ProvTestDatabase,
} from '../helpers/prov.ts';

const TARGET: OperationTarget = {
  providerId: 'ac272-provider',
  operationId: 'op-ac272',
  version: 'v1',
};
const KINDS: readonly ProviderVerificationKind[] = ['DOCUMENTATION', 'PRICING_PLAN', 'RIGHTS'];

const clock = makeFixedClock('2026-08-26T12:00:00Z');

let tdb: ProvTestDatabase;
let registry: OperationRegistry;
let machine: LifecycleMachine;
let ttl: VerificationTtlEngine;
let rights: RightsMatrixEngine;
let evaluator: ReadinessEvaluator;

beforeAll(async () => {
  tdb = await makeProvTestDatabase();
  registry = new OperationRegistry(tdb.engine, clock);
  machine = new LifecycleMachine({ engine: tdb.engine, clock });
  ttl = new VerificationTtlEngine({ engine: tdb.engine, clock, machine });
  rights = new RightsMatrixEngine({
    engine: tdb.engine,
    clock,
    auditChain: new AuditChain({ engine: tdb.engine }),
  });
  evaluator = new ReadinessEvaluator({
    clock,
    registry,
    ttl,
    verificationKinds: KINDS,
    rights,
  });

  await registry.registerProvider({
    providerId: TARGET.providerId,
    displayName: 'AC-272 provider',
    providerGroup: 'acceptance',
  });
  await registry.registerOperation(provOperationDefinition(TARGET));
  // Healthy lifecycle walk to ACTIVE.
  await machine.transition({
    target: TARGET,
    toState: 'VERIFIED',
    reasonClass: 'VERIFICATION_PASSED',
    actor: 'ac272',
  });
  await machine.transition({
    target: TARGET,
    toState: 'ACTIVE',
    reasonClass: 'ACTIVATION',
    actor: 'ac272',
  });
  // Fresh AC-270 pair per kind.
  for (const kind of KINDS) {
    await ttl.configureTtl({ kind, ttlSeconds: 86_400 });
    await recordVerificationPair(ttl, {
      target: TARGET,
      kind,
      clock,
      window: { verifiedAt: '2026-08-26T10:00:00Z', expiresAt: '2027-01-01T00:00:00Z' },
    });
  }
  // Fully verified rights declaration.
  await rights.declareRights({
    providerId: TARGET.providerId,
    operationId: TARGET.operationId,
    rightsVersion: 1,
    declaration: openRightsDeclaration({ termsVersion: 'terms@ac272-v1' }),
  });
});

afterAll(async () => {
  await closeProvTestDatabase(tdb);
});

describe('AC-272 readiness eligibility', () => {
  it('yields ELIGIBLE for the workspace/public gate with every dimension green', async () => {
    const verdict = await evaluator.evaluate(TARGET, 'PUBLIC');
    expect(verdict.status).toBe('ELIGIBLE');
    if (verdict.status !== 'ELIGIBLE') throw new Error(JSON.stringify(verdict.reasons));
    expect(verdict.scope).toBe('PUBLIC');
    expect(verdict.checkedAt).toBeTruthy();
  });

  it('applies the SAME evidence bar in the WORKSPACE scope', async () => {
    const verdict = await evaluator.evaluate(TARGET, 'WORKSPACE');
    expect(verdict.status).toBe('ELIGIBLE');
    if (verdict.status !== 'ELIGIBLE') throw new Error(JSON.stringify(verdict.reasons));
    expect(verdict.scope).toBe('WORKSPACE');
  });

  it('stays ELIGIBLE under re-evaluation (idempotent reads, no state churn)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const verdict = await evaluator.evaluate(TARGET);
      expect(verdict.status).toBe('ELIGIBLE');
    }
  });
});
