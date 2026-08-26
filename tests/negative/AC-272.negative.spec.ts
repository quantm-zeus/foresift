// AC-272 (negative): each readiness blocker is individually visible, reasons
// COUNT (no silent first-error short-circuit), assertEligible refuses with
// the typed PROV_READINESS_BLOCKED error, and unregistered operations are
// blocked rather than assumed eligible.
import { describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import {
  atOffset,
  closeProvAcceptanceStack,
  configureAllCriticalTtls,
  DECISION_CRITICAL_KINDS,
  makeProvAcceptanceStack,
  recordFullPairs,
  seedAcOperation,
  T0,
} from '../helpers/prov.ts';

const CLOCK = { now: (): UtcTimestamp => atOffset(10) };

function acRights(
  op: { readonly providerId: string; readonly operationId: string; readonly version: string },
) {
  return {
    ref: op,
    rightsVersion: 'ac-terms-v1',
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
    termsVersion: 'ac-terms-v1',
    verifiedAt: T0,
    verificationExpiresAt: '2027-01-01T00:00:00Z' as UtcTimestamp,
  };
}

describe('AC-272 negative: every missing gate blocks activation', () => {
  it('an unregistered operation is BLOCKED, never silently eligible', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const evaluation = await stack.readiness.evaluate(
        { providerId: 'ghost', operationId: 'nope', version: '9.9.9' },
        CLOCK,
      );
      expect(evaluation.status).toBe('BLOCKED');
      expect(evaluation.reasons.map((reason) => reason.code)).toContain('PROV_OPERATION_UNKNOWN');
      await expect(stack.readiness.assertEligible({ providerId: 'ghost', operationId: 'nope', version: '9.9.9' }, CLOCK))
        .rejects.toMatchObject({ code: 'PROV_READINESS_BLOCKED' });
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('verification and rights blockers ACCUMULATE in one evaluation', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      // TTLs configured; every kind fully paired EXCEPT ENDPOINT's live side;
      // and no rights declaration at all.
      await configureAllCriticalTtls(stack, 3_600);
      for (const kind of DECISION_CRITICAL_KINDS) {
        await stack.verifications.recordVerification({
          ref: op,
          kind,
          source: 'OFFICIAL_DOC',
          outcome: 'PASS',
          verifiedAt: T0,
          evidenceRefs: [`doc:${kind}`],
          recordedBy: 'acceptance',
          idempotencyKey: `acc-doc:${kind}`,
        });
        // ENDPOINT deliberately gets no LIVE_CONTRACT side.
        if (kind === 'ENDPOINT') continue;
        await stack.verifications.recordVerification({
          ref: op,
          kind,
          source: 'LIVE_CONTRACT',
          outcome: 'PASS',
          verifiedAt: T0,
          evidenceRefs: [`live:${kind}`],
          recordedBy: 'acceptance',
          idempotencyKey: `acc-live:${kind}`,
        });
      }
      const evaluation = await stack.readiness.evaluate(op, CLOCK);
      expect(evaluation.status).toBe('BLOCKED');
      const codes = evaluation.reasons.map((reason) => reason.code);
      // Half pair on ENDPOINT…
      expect(codes).toContain('PROV_REFRESH_PAIR_INCOMPLETE');
      // …and absent rights, TOGETHER.
      expect(codes).toContain('PROV_RIGHTS_VERSION_UNKNOWN');
      expect(evaluation.reasons.length).toBeGreaterThanOrEqual(2);
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });

  it('expired RIGHTS verification blocks with its distinct code', async () => {
    const stack = await makeProvAcceptanceStack();
    try {
      const op = await seedAcOperation(stack);
      await configureAllCriticalTtls(stack, 86_400);
      await recordFullPairs(stack, op, T0);
      await stack.rights.declare({
        ...acRights(op),
        verifiedAt: T0,
        verificationExpiresAt: atOffset(30), // expires before evaluation instant
      });
      const evaluation = await stack.readiness.evaluate(op, { now: (): UtcTimestamp => atOffset(31) });
      expect(evaluation.status).toBe('BLOCKED');
      expect(evaluation.reasons.map((reason) => reason.code)).toContain(
        'PROV_RIGHTS_VERIFICATION_EXPIRED',
      );
    } finally {
      await closeProvAcceptanceStack(stack);
    }
  });
});
