/**
 * T123: activation readiness (AC-272). The provider-side evaluator returns
 * ELIGIBLE only when lifecycle state, exposure metadata, the AC-270
 * verification pair, rights presence, and deprecation-exception validity ALL
 * pass; every failure aggregates into a typed BLOCKED verdict (never a throw).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AuditChain } from '@foresift/security';
import {
  ReadinessEvaluator,
  RightsMatrixEngine,
  REQUIRED_NEGATIVE_CAPABILITIES,
  ProvErrorCode,
} from '../src/index.ts';
import type { OperationTarget, RightsDeclaration } from '../src/index.ts';
import { makeProvEngine, seedOperationRow, wireEngine, ts } from './helpers.ts';

let engine: Awaited<ReturnType<typeof makeProvEngine>>['engine'];
let closeDb: () => Promise<void>;
const NOW = '2026-08-26T12:00:00Z';

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
    verifiedAt: ts('2026-08-26T00:00:00Z'),
    verificationExpiresAt: ts('2027-08-26T00:00:00Z'),
    ...overrides,
  };
}

beforeAll(async () => {
  const made = await makeProvEngine();
  engine = made.engine;
  closeDb = () => made.db.close();
});

afterAll(async () => {
  await closeDb();
});

/** Full-graph evaluator over the wired registry/machine/TTL. */
async function makeEvaluator(options?: { withRights?: boolean }) {
  const wired = wireEngine(engine, {
    now: () => ts(NOW),
    nowEpochMs: () => Date.parse(NOW),
  });
  const audit = new AuditChain({ engine });
  const rights =
    options?.withRights === false
      ? undefined
      : new RightsMatrixEngine({ engine, clock: wired.clock, auditChain: audit });
  const evaluator = new ReadinessEvaluator({
    clock: wired.clock,
    registry: wired.registry,
    ttl: wired.ttl,
    rights,
    exceptions: wired.exceptions,
  });
  return { wired, evaluator, rights };
}

async function seedFullyActive(target: OperationTarget): Promise<void> {
  const { wired } = await makeEvaluator({ withRights: false });
  await seedOperationRow(engine, target, {
    negativeCapabilities: [...REQUIRED_NEGATIVE_CAPABILITIES],
  });
  // DISCOVERED → VERIFIED → ACTIVE.
  await wired.machine.transition({
    target,
    toState: 'VERIFIED',
    reasonClass: 'VERIFICATION_PASSED',
    actor: 'test',
  });
  await wired.machine.transition({
    target,
    toState: 'ACTIVE',
    reasonClass: 'ACTIVATION',
    actor: 'test',
  });
}

describe('T123 readiness evaluation', () => {
  it('is ELIGIBLE for an ACTIVE operation with complete evidence', async () => {
    const target: OperationTarget = { providerId: 'prov-r1', operationId: 'op-ok', version: 'v1' };
    await seedFullyActive(target);
    // TTL configs + fresh pair records for the three default kinds.
    const { wired, evaluator, rights } = await makeEvaluator();
    for (const kind of ['DOCUMENTATION', 'PRICING_PLAN', 'RIGHTS'] as const) {
      await wired.ttl.configureTtl({ kind, ttlSeconds: 86_400 });
      for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
        await wired.ttl.recordVerification({
          target,
          kind,
          source,
          outcome: 'PASSED',
          verifiedAt: ts('2026-08-26T10:00:00Z'),
          expiresAt: ts('2027-01-01T00:00:00Z'),
          evidenceRefs: [`evidence:${kind}:${source}`],
        });
      }
    }
    if (rights !== undefined) {
      await rights.declareRights({
        providerId: target.providerId,
        operationId: target.operationId,
        rightsVersion: 1,
        declaration: openDeclaration(),
      });
    }
    const verdict = await evaluator.evaluate(target, 'PUBLIC');
    expect(verdict.status).toBe('ELIGIBLE');
    if (verdict.status === 'BLOCKED') throw new Error(JSON.stringify(verdict.reasons));
    expect(verdict.scope).toBe('PUBLIC');
  });

  it('is BLOCKED while the operation has not reached ACTIVE', async () => {
    const target: OperationTarget = {
      providerId: 'prov-r2',
      operationId: 'op-discovered',
      version: 'v1',
    };
    await seedOperationRow(engine, target, {
      negativeCapabilities: [...REQUIRED_NEGATIVE_CAPABILITIES],
    });
    const { evaluator } = await makeEvaluator({ withRights: false });
    const verdict = await evaluator.evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    expect(verdict.reasons.map((r) => r.dimension)).toContain('LIFECYCLE');
    expect(
      verdict.reasons.some((r) => r.code === ProvErrorCode.PROV_LIFECYCLE_STATE_CONFLICT),
    ).toBe(true);
  });

  it('aggregates verification-pair staleness and missing rights into typed reasons', async () => {
    const target: OperationTarget = {
      providerId: 'prov-r3',
      operationId: 'op-stale',
      version: 'v1',
    };
    await seedFullyActive(target);
    const { wired, evaluator, rights } = await makeEvaluator();
    // TTL configured but NO verification records → both sources stale.
    await wired.ttl.configureTtl({ kind: 'DOCUMENTATION', ttlSeconds: 60 });
    const verdict = await evaluator.evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    expect(
      verdict.reasons.filter((r) => r.dimension === 'VERIFICATION').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      verdict.reasons.some((r) => r.code === ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE),
    ).toBe(true);
    expect(verdict.reasons.some((r) => r.dimension === 'RIGHTS')).toBe(true);
    void rights;
  });

  it('is BLOCKED when negative-capability metadata is incomplete (exposure)', async () => {
    const target: OperationTarget = {
      providerId: 'prov-r4',
      operationId: 'op-bare',
      version: 'v1',
    };
    await seedOperationRow(engine, target);
    // The REGISTRY auto-completes negatives at registration; the evaluator
    // still defends against out-of-band rows, so simulate one directly.
    await engine.query(
      `UPDATE prov.prov_operations SET negative_capabilities = '{}'
       WHERE provider_id='prov-r4' AND operation_id='op-bare' AND version='v1'`,
    );
    const { evaluator } = await makeEvaluator({ withRights: false });
    const verdict = await evaluator.evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    const exposure = verdict.reasons.find((r) => r.dimension === 'EXPOSURE');
    expect(exposure).toBeDefined();
    expect(exposure?.code).toBe(ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED);
  });

  it('is BLOCKED for an unknown operation without throwing', async () => {
    const { evaluator } = await makeEvaluator({ withRights: false });
    const verdict = await evaluator.evaluate({
      providerId: 'ghost',
      operationId: 'op-ghost',
      version: 'v9',
    });
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    expect(verdict.reasons[0]?.dimension).toBe('LIFECYCLE');
  });

  it('requires a valid migration exception for DEPRECATED operations', async () => {
    const target: OperationTarget = {
      providerId: 'prov-r5',
      operationId: 'op-deprecated',
      version: 'v1',
    };
    await seedOperationRow(engine, target, {
      negativeCapabilities: [...REQUIRED_NEGATIVE_CAPABILITIES],
      deprecatedAt: ts('2026-08-01T00:00:00Z'),
    });
    const { wired, evaluator } = await makeEvaluator({ withRights: false });
    // DISCOVERED → DEPRECATED is a legal direct exit.
    await wired.machine.transition({
      target,
      toState: 'DEPRECATED',
      reasonClass: 'DEPRECATION_NOTICE',
      actor: 'test',
    });
    const blocked = await evaluator.evaluate(target);
    expect(blocked.status).toBe('BLOCKED');
    if (blocked.status !== 'BLOCKED') return;
    expect(blocked.reasons.some((r) => r.dimension === 'DEPRECATION')).toBe(true);
  });

  it('fails closed on an expired rights window', async () => {
    const target: OperationTarget = {
      providerId: 'prov-r6',
      operationId: 'op-expired-rights',
      version: 'v1',
    };
    await seedFullyActive(target);
    const { wired, evaluator, rights } = await makeEvaluator();
    for (const kind of ['DOCUMENTATION', 'PRICING_PLAN', 'RIGHTS'] as const) {
      await wired.ttl.configureTtl({ kind, ttlSeconds: 86_400 });
      for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
        await wired.ttl.recordVerification({
          target,
          kind,
          source,
          outcome: 'PASSED',
          verifiedAt: ts('2026-08-26T10:00:00Z'),
          expiresAt: ts('2027-01-01T00:00:00Z'),
          evidenceRefs: [`evidence:${kind}:${source}`],
        });
      }
    }
    if (rights !== undefined) {
      await rights.declareRights({
        providerId: target.providerId,
        operationId: target.operationId,
        rightsVersion: 1,
        declaration: openDeclaration({ verificationExpiresAt: ts('2026-08-26T06:00:00Z') }),
      });
    }
    const verdict = await evaluator.evaluate(target);
    expect(verdict.status).toBe('BLOCKED');
    if (verdict.status !== 'BLOCKED') return;
    expect(
      verdict.reasons.some(
        (r) =>
          r.dimension === 'RIGHTS' && r.code === ProvErrorCode.PROV_RIGHTS_VERIFICATION_EXPIRED,
      ),
    ).toBe(true);
  });

  it('carries the WORKSPACE scope on its verdicts with the same evidence bar', async () => {
    const { evaluator } = await makeEvaluator({ withRights: false });
    const verdict = await evaluator.evaluate(
      { providerId: 'ghost', operationId: 'op-ghost', version: 'v1' },
      'WORKSPACE',
    );
    expect(verdict.status).toBe('BLOCKED'); // unknown op blocks in BOTH scopes
    if (verdict.status !== 'BLOCKED') return;
    expect(verdict.scope).toBe('WORKSPACE');
  });
});
