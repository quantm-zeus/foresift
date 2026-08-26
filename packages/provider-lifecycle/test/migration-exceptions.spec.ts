/**
 * T113: migration exceptions — APPROVED-plan requirement, strict windows,
 * single-active enforcement, and USE-TIME expiry (fail-closed, no grace).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import { makeProvEngine, testDefinition, wireEngine, type Wired } from './helpers.ts';
import { ProvErrorCode } from '../src/errors.ts';

function ts(value: string): UtcTimestamp {
  return value as UtcTimestamp;
}

let closeDb: () => Promise<void>;
let wired: Wired;

const TARGET = { providerId: 'prov-test', operationId: 'op-exc', version: 'v1' } as const;

function plan(planId: string) {
  return {
    planId,
    targetProviderId: TARGET.providerId,
    targetOperationId: TARGET.operationId,
    targetVersion: TARGET.version,
    plannedMigrationDeadline: ts('2026-12-31T00:00:00Z'),
    milestones: ['audit', 'cutover'],
    status: 'APPROVED' as const,
  };
}

beforeAll(async () => {
  const { db, engine } = await makeProvEngine();
  closeDb = () => db.close();
  wired = wireEngine(engine);
  await wired.registry.registerProvider({
    providerId: 'prov-test',
    displayName: 'Test Provider',
    providerGroup: 'g',
  });
  await wired.registry.registerOperation(testDefinition({ operationId: 'op-exc' }));
});

afterAll(async () => {
  await closeDb();
});

describe('T113 migration exceptions', () => {
  it('requires an APPROVED replacement plan', async () => {
    await expect(
      wired.exceptions.grant({
        target: TARGET,
        approver: 'approver',
        reason: 'r',
        replacementPlan: { ...plan('plan-draft'), status: 'DRAFT' },
        expiresAt: ts('2026-09-01T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_WINDOW_INVALID });
  });

  it('refuses windows that do not lie strictly in the future', async () => {
    await expect(
      wired.exceptions.grant({
        target: TARGET,
        approver: 'approver',
        reason: 'already lapsed',
        replacementPlan: plan('plan-past'),
        expiresAt: ts('2020-01-01T00:00:00Z'), // before fixed clock 2026-08-26
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_WINDOW_INVALID });
  });

  it('enforces ONE active exception per operation version', async () => {
    const first = await wired.exceptions.grant({
      target: TARGET,
      approver: 'approver-1',
      reason: 'first window',
      replacementPlan: plan('plan-a'),
      expiresAt: ts('2026-09-15T00:00:00Z'),
    });
    expect(first.exceptionId).toBeTruthy();
    // Identical retry resolves to the SAME exception.
    const retry = await wired.exceptions.grant({
      target: TARGET,
      approver: 'approver-1',
      reason: 'first window',
      replacementPlan: plan('plan-a'),
      expiresAt: ts('2026-09-15T00:00:00Z'),
    });
    expect(retry.exceptionId).toBe(first.exceptionId);

    // A DIFFERENT active exception for the same version conflicts.
    await expect(
      wired.exceptions.grant({
        target: TARGET,
        approver: 'approver-2',
        reason: 'second window',
        replacementPlan: plan('plan-b'),
        expiresAt: ts('2026-09-20T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_CONFLICT });

    // After revocation a NEW grant is possible.
    await wired.exceptions.revoke(first.exceptionId, 'approver-1');
    const second = await wired.exceptions.grant({
      target: TARGET,
      approver: 'approver-2',
      reason: 'second window',
      replacementPlan: plan('plan-b'),
      expiresAt: ts('2026-09-20T00:00:00Z'),
    });
    expect(second.exceptionId).not.toBe(first.exceptionId);
  });

  it('re-blocks automatically the moment the exception lapses (use-time expiry)', async () => {
    const target = { providerId: 'prov-test', operationId: 'op-lapse', version: 'v1' };
    await wired.registry.registerOperation(
      testDefinition({ operationId: 'op-lapse', verificationExpiresAt: ts('2099-01-01T00:00:00Z') }),
    );
    await wired.rules.deprecate({ target, actor: 'bot' });
    // Deprecation blocked dependency registration…
    await expect(wired.rules.assertDependencyRegistrationAllowed(target)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_DEPENDENCY_BLOCKED,
    });
    // …the exception opens the gate…
    await wired.exceptions.grant({
      target,
      approver: 'approver-3',
      reason: 'short bridge',
      replacementPlan: { ...plan('plan-c'), targetOperationId: 'op-lapse' },
      expiresAt: ts('2026-08-27T00:00:00Z'),
    });
    await expect(wired.rules.assertDependencyRegistrationAllowed(target)).resolves.toBeUndefined();
    // …and WITHOUT any sweep, advancing the clock past expiry re-blocks:
    // the same DB, a later injected clock, no other change.
    const later = wireEngine(wired.engine, {
      now: () => ts('2026-08-28T00:00:00Z'),
      nowEpochMs: () => Date.parse('2026-08-28T00:00:00Z'),
    });
    await expect(later.rules.assertDependencyRegistrationAllowed(target)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_DEPENDENCY_BLOCKED,
    });
    await expect(later.exceptions.assertValidForUse(target)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
    });
  });

  it('refuses unknown ids and conflicting replayed revocations', async () => {
    await expect(
      wired.exceptions.revoke('no-such-exception', 'actor'),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_UNKNOWN });

    const target = { providerId: 'prov-test', operationId: 'op-revoke', version: 'v1' };
    await wired.registry.registerOperation(
      testDefinition({ operationId: 'op-revoke', verificationExpiresAt: ts('2099-01-01T00:00:00Z') }),
    );
    const granted = await wired.exceptions.grant({
      target,
      approver: 'approver-4',
      reason: 'to be revoked',
      replacementPlan: { ...plan('plan-d'), targetOperationId: 'op-revoke' },
      expiresAt: ts('2026-10-01T00:00:00Z'),
    });
    await wired.exceptions.revoke(granted.exceptionId, 'revoker-a');
    // Same revocation replayed → idempotent.
    await expect(
      wired.exceptions.revoke(granted.exceptionId, 'revoker-a'),
    ).resolves.toBeUndefined();
    // A different actor claiming the same revocation refuses.
    await expect(
      wired.exceptions.revoke(granted.exceptionId, 'revoker-b'),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_REVOKED });
    // And the revoked exception no longer authorizes anything.
    await expect(wired.exceptions.findActive(target)).resolves.toBeNull();
  });
});
