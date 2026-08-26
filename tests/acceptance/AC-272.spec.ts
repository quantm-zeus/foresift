// AC-272 (acceptance): activation readiness composes EVERY gate —
// registration, lifecycle state, decision-critical verification pairs,
// current rights, and deprecation exceptions — into one ELIGIBLE verdict,
// and the operation then completes DISCOVERED → VERIFIED → ACTIVE only
// through that gate.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import {
  atOffset,
  closeProvAcceptanceStack,
  configureAllCriticalTtls,
  makeProvAcceptanceStack,
  recordFullPairs,
  seedAcOperation,
  T0,
} from '../helpers/prov.ts';

function acRights(
  op: { readonly providerId: string; readonly operationId: string; readonly version: string },
  rightsVersion: string,
) {
  return {
    ref: op,
    rightsVersion,
    commercialUseAllowed: true,
    personalResearchAllowed: true,
    cacheAllowed: true,
    maximumCacheDuration: 'PT5M',
    rawRetentionAllowed: true,
    derivedFeaturesAllowed: true,
    modelTrainingAllowed: false,
    redistributionAllowed: false,
    publicAlertDerivativeAllowed: true,
    attributionRequired: true,
    userByokRequired: false,
    rawExportAllowed: false,
    jurisdictionRestrictions: [],
    termsVersion: rightsVersion,
    verifiedAt: T0,
    verificationExpiresAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
  };
}

describe('AC-272: activation readiness is the single composed gate', () => {
  it('the complete world evaluates ELIGIBLE and the operation reaches ACTIVE through it', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await configureAllCriticalTtls(stack, 86_400);
      await recordFullPairs(stack, op, T0);
      await stack.rights.declare(acRights(op, 'ac-terms-v1'));
      const clock = { now: (): UtcTimestamp => atOffset(10) };

      const evaluation = await stack.readiness.evaluate(op, clock);
      expect(evaluation.status).toBe('ELIGIBLE');
      await expect(stack.readiness.assertEligible(op, clock)).resolves.toBeUndefined();

      // The gated path to ACTIVE works.
      await stack.machine.transition({
        ref: op,
        to: 'VERIFIED',
        reasonClass: 'REGISTRATION_VERIFIED',
        actor: 'ac',
        occurredAt: atOffset(11),
        effectiveAt: atOffset(11),
        idempotencyKey: 'ac272-v',
      });
      await expect(stack.readiness.assertEligible(op, clock)).resolves.toBeUndefined();
      await stack.machine.transition({
        ref: op,
        to: 'ACTIVE',
        reasonClass: 'OPERATION_ACTIVATED',
        actor: 'ac',
        occurredAt: atOffset(12),
        effectiveAt: atOffset(12),
        idempotencyKey: 'ac272-a',
      });
      expect(await stack.machine.currentState(op)).toBe('ACTIVE');
      expect(await stack.machine.currentHealthStatus(op)).toBe('HEALTHY');
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('a deprecated operation becomes eligible ONLY with a valid migration exception, and re-blocks when it lapses', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack, {
        deprecatedAt: T0,
        replacementOperationId: 'get-token-price@2.0.0',
      });
      await configureAllCriticalTtls(stack, 86_400);
      await recordFullPairs(stack, op, T0);
      await stack.rights.declare(acRights(op, 'ac-terms-v1'));
      const clock = { now: (): UtcTimestamp => atOffset(10) };

      // Deprecated without an exception ⇒ blocked.
      let blocked = await stack.readiness.evaluate(op, clock);
      expect(blocked.status).toBe('BLOCKED');
      expect(blocked.reasons.map((reason) => reason.code)).toContain(
        'PROV_MIGRATION_EXCEPTION_EXPIRED',
      );

      await stack.exceptions.grant({
        exceptionId: 'exc-ac272',
        ref: op,
        approver: 'operator',
        replacementPlanRef: 'plan://migrate-price-v2',
        reason: 'documented transition window',
        createdAt: T0,
        expiresAt: atOffset(60),
      });
      const eligible = await stack.readiness.evaluate(op, clock);
      expect(eligible.status).toBe('ELIGIBLE');

      // Lapse the exception window; readiness re-blocks.
      const afterExpiry = { now: (): UtcTimestamp => atOffset(61) };
      blocked = await stack.readiness.evaluate(op, afterExpiry);
      expect(blocked.status).toBe('BLOCKED');
      await expect(stack.readiness.assertEligible(op, afterExpiry)).rejects.toMatchObject({
        code: 'PROV_READINESS_BLOCKED',
      });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});
