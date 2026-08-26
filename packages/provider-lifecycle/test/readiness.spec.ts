// Activation readiness (AC-272): ELIGIBLE only when every gate agrees at the
// injected instant; BLOCKED always carries typed, machine-readable reasons.
import { describe, expect, it } from 'vitest';
import { fixedClock } from '@foresift/domain';
import type { UtcTimestamp } from '@foresift/domain';
import { DECISION_CRITICAL_VERIFICATION_KINDS } from '../src/vocabularies.ts';
import { ReadinessRefusalError } from '../src/errors.ts';
import { makeProvStack, closeProvStack, seedOperation, T0 } from './helpers.ts';

const at = (iso: string) => iso as UtcTimestamp;

/** Fully verified world: TTLs configured + full OFFICIAL_DOC/LIVE pairs that
 * stay fresh through the whole scenario window (30-day TTLs). */
async function fullyVerify(
  stack: Awaited<ReturnType<typeof makeProvStack>>,
  ref: { providerId: string; operationId: string; version: string },
) {
  for (const kind of DECISION_CRITICAL_VERIFICATION_KINDS) {
    await stack.verifications.configureTtl({ configId: `ttl-${kind}`, kind, ttlSeconds: 2_592_000 });
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await stack.verifications.recordVerification({
        ref,
        kind,
        source,
        outcome: 'PASS',
        verifiedAt: T0,
        evidenceRefs: [`${source.toLowerCase()}:${kind}`],
        recordedBy: 'test',
        idempotencyKey: `${kind}:${source}:seed`,
      });
    }
  }
}

async function declareRights(stack: Awaited<ReturnType<typeof makeProvStack>>) {
  await stack.rights.declare({
    ref: { providerId: 'prov-test', operationId: 'get-token-price', version: '1.0.0' },
    rightsVersion: 'v1',
    commercialUseAllowed: false,
    personalResearchAllowed: true,
    cacheAllowed: false,
    maximumCacheDuration: null,
    rawRetentionAllowed: true,
    derivedFeaturesAllowed: true,
    modelTrainingAllowed: false,
    redistributionAllowed: false,
    publicAlertDerivativeAllowed: true,
    attributionRequired: true,
    userByokRequired: false,
    rawExportAllowed: false,
    jurisdictionRestrictions: [],
    termsVersion: 'terms-1',
    verifiedAt: T0,
    verificationExpiresAt: at('2026-12-01T00:00:00Z'),
  });
}

describe('readiness evaluation (AC-272)', () => {
  it('ELIGIBLE when registered, verified in full pairs, rights current, not deprecated', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await fullyVerify(stack, op);
      await declareRights(stack);
      const evaluation = await stack.readiness.evaluate(op, fixedClock(T0));
      expect(evaluation.status).toBe('ELIGIBLE');
      await expect(stack.readiness.assertEligible(op, fixedClock(T0))).resolves.toBeUndefined();
    } finally {
      await closeProvStack(stack);
    }
  });

  it('BLOCKED with PROV_OPERATION_UNKNOWN when unregistered', async () => {
    const stack = await makeProvStack();
    try {
      const evaluation = await stack.readiness.evaluate(
        { providerId: 'ghost', operationId: 'op', version: '1' },
        fixedClock(T0),
      );
      expect(evaluation.status).toBe('BLOCKED');
      if (evaluation.status === 'BLOCKED') {
        expect(evaluation.reasons.map((r) => r.code)).toEqual(['PROV_OPERATION_UNKNOWN']);
      }
    } finally {
      await closeProvStack(stack);
    }
  });

  it('BLOCKED when decision-critical verifications are missing or single-source', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await declareRights(stack);
      const none = await stack.readiness.evaluate(op, fixedClock(T0));
      expect(none.status).toBe('BLOCKED');
      if (none.status === 'BLOCKED') {
        const codes = none.reasons.map((r) => r.code);
        expect(codes).toContain('PROV_VERIFICATION_EXPIRED');
      }

      // Half-pairs still block — one reason per critical kind.
      for (const kind of DECISION_CRITICAL_VERIFICATION_KINDS) {
        await stack.verifications.configureTtl({ configId: `ttl-${kind}`, kind, ttlSeconds: 86_400 });
        await stack.verifications.recordVerification({
          ref: op,
          kind,
          source: 'OFFICIAL_DOC',
          outcome: 'PASS',
          verifiedAt: T0,
          evidenceRefs: ['e'],
          recordedBy: 'test',
          idempotencyKey: `${kind}:half`,
        });
      }
      const half = await stack.readiness.evaluate(op, fixedClock(T0));
      expect(half.status).toBe('BLOCKED');
      if (half.status === 'BLOCKED') {
        expect(half.reasons.filter((r) => r.code === 'PROV_REFRESH_PAIR_INCOMPLETE')).toHaveLength(
          DECISION_CRITICAL_VERIFICATION_KINDS.length,
        );
      }
    } finally {
      await closeProvStack(stack);
    }
  });

  it('BLOCKED when rights are absent or verification lapsed', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack);
      await fullyVerify(stack, op);
      // No declaration at all.
      const absent = await stack.readiness.evaluate(op, fixedClock(T0));
      expect(absent.status).toBe('BLOCKED');
      if (absent.status === 'BLOCKED') {
        expect(absent.reasons.map((r) => r.code)).toContain('PROV_RIGHTS_VERSION_UNKNOWN');
      }
      // Declared but expired at evaluation instant.
      await declareRights(stack);
      const later = await stack.readiness.evaluate(op, fixedClock(at('2027-01-01T00:00:00Z')));
      expect(later.status).toBe('BLOCKED');
      if (later.status === 'BLOCKED') {
        expect(later.reasons.map((r) => r.code)).toContain('PROV_RIGHTS_VERIFICATION_EXPIRED');
      }
    } finally {
      await closeProvStack(stack);
    }
  });

  it('BLOCKED when deprecated without a currently valid migration exception; eligible with one', async () => {
    const stack = await makeProvStack();
    try {
      const op = await seedOperation(stack, {
        deprecatedAt: T0,
        replacementOperationId: 'get-token-price-v2',
      });
      await fullyVerify(stack, op);
      await declareRights(stack);
      const noException = await stack.readiness.evaluate(op, fixedClock(T0));
      expect(noException.status).toBe('BLOCKED');
      if (noException.status === 'BLOCKED') {
        expect(noException.reasons.map((r) => r.code)).toContain(
          'PROV_MIGRATION_EXCEPTION_EXPIRED',
        );
      }

      await stack.exceptions.grant({
        exceptionId: 'exc-ready',
        ref: op,
        approver: 'ops',
        replacementPlanRef: 'plan://migrate',
        reason: 'window',
        createdAt: T0,
        expiresAt: at('2026-08-05T00:00:00Z'),
      });
      const inside = await stack.readiness.evaluate(op, fixedClock(at('2026-08-04T23:59:59Z')));
      expect(inside.status).toBe('ELIGIBLE');

      // Lapse re-blocks automatically.
      const after = await stack.readiness.evaluate(op, fixedClock(at('2026-08-05T00:00:01Z')));
      expect(after.status).toBe('BLOCKED');

      await expect(stack.readiness.assertEligible(op, fixedClock(at('2026-08-06T00:00:00Z')))).rejects.toBeInstanceOf(
        ReadinessRefusalError,
      );
    } finally {
      await closeProvStack(stack);
    }
  });
});
