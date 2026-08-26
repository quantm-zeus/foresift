/**
 * T112: deprecation rules — Rule 1 dependency blocking with the exception
 * escape hatch, Rule 2 incident raising through the security API, Rule 6
 * sole-source refusal, and STRICT_FREE plan-verification gating.
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

beforeAll(async () => {
  const { db, engine } = await makeProvEngine();
  closeDb = () => db.close();
  wired = wireEngine(engine);
});

afterAll(async () => {
  await closeDb();
});

async function seedDeprecated(operationId: string, options?: { sunsetAt?: string; noticeRef?: string }): Promise<void> {
  await wired.registry.registerProvider({
    providerId: 'prov-test',
    displayName: 'Test Provider',
    providerGroup: 'g',
  });
  await wired.registry.registerOperation(
    testDefinition({ operationId, verificationExpiresAt: ts('2099-01-01T00:00:00Z') }),
  );
  const input = {
    target: { providerId: 'prov-test', operationId, version: 'v1' },
    actor: 'deprecation-bot',
    ...(options?.sunsetAt !== undefined ? { sunsetAt: ts(options.sunsetAt) } : {}),
    ...(options?.noticeRef !== undefined ? { officialNoticeRef: options.noticeRef } : {}),
  };
  await wired.rules.deprecate(input);
}

describe('T112 deprecation rules', () => {
  it('deprecates an operation and records its metadata', async () => {
    await seedDeprecated('dep-basic');
    const target = { providerId: 'prov-test', operationId: 'dep-basic', version: 'v1' };
    expect((await wired.machine.currentState(target))).toBe('DEPRECATED');
    const op = await wired.registry.getOperation(target);
    expect(op.deprecatedAt).not.toBeNull();
  });

  it('Rule 1: blocks NEW dependency registration unless a valid exception exists', async () => {
    await seedDeprecated('dep-rule1');
    const target = { providerId: 'prov-test', operationId: 'dep-rule1', version: 'v1' };

    // Blocked without an exception.
    await expect(wired.rules.assertDependencyRegistrationAllowed(target)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_DEPENDENCY_BLOCKED,
    });
    await expect(
      wired.registry.registerDependency({ consumerKind: 'TOOL', consumerKey: 'tool-1', target }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_DEPRECATED_DEPENDENCY_BLOCKED });

    // Granting a valid exception opens the gate.
    await wired.exceptions.grant({
      target,
      approver: 'head-of-platform',
      reason: 'critical export until Q4 migration',
      replacementPlan: {
        planId: 'plan-1',
        targetProviderId: target.providerId,
        targetOperationId: target.operationId,
        targetVersion: target.version,
        plannedMigrationDeadline: ts('2026-12-31T00:00:00Z'),
        milestones: ['dual-write', 'cutover'],
        status: 'APPROVED',
      },
      expiresAt: ts('2026-09-30T00:00:00Z'),
    });
    const dep = await wired.registry.registerDependency({
      consumerKind: 'TOOL',
      consumerKey: 'tool-1',
      target,
    });
    expect(dep.created).toBe(true);
  });

  it('Rule 2: raises exactly one incident carrying the migration deadline', async () => {
    await seedDeprecated('dep-rule2', {
      sunsetAt: '2026-12-01T00:00:00Z',
      noticeRef: 'notice://provider/dep-2026-08',
    });
    const rows = await wired.engine.query<{ incident_id: string; evidence_refs: unknown }>(
      `SELECT incident_id, evidence_refs FROM sec.security_incidents
       WHERE evidence_refs::text LIKE '%lifecycle:prov-test/dep-rule2@v1%'`,
    );
    expect(rows.rows).toHaveLength(1);
    // PGlite returns jsonb columns already parsed — no JSON.parse round-trip.
    const refs = rows.rows[0]?.evidence_refs as string[];
    expect(refs).toContain('migration-deadline:2026-12-01T00:00:00Z');
    expect(refs).toContain('notice://provider/dep-2026-08');

    // A replayed deprecation must not open a second incident.
    await wired.rules.deprecate({
      target: { providerId: 'prov-test', operationId: 'dep-rule2', version: 'v1' },
      actor: 'deprecation-bot',
      sunsetAt: ts('2026-12-01T00:00:00Z'),
      officialNoticeRef: 'notice://provider/dep-2026-08',
    });
    const again = await wired.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sec.security_incidents
       WHERE evidence_refs::text LIKE '%lifecycle:prov-test/dep-rule2@v1%'`,
    );
    expect(again.rows[0]?.n).toBe('1');
  });

  it('Rule 6: refuses when deprecated op is the sole active source of a consumer', async () => {
    // Consumer depends ONLY on the soon-to-be-deprecated op.
    await wired.registry.registerProvider({
      providerId: 'prov-test',
      displayName: 'Test Provider',
      providerGroup: 'g',
    });
    await wired.registry.registerOperation(
      testDefinition({ operationId: 'dep-sole', verificationExpiresAt: ts('2099-01-01T00:00:00Z') }),
    );
    const soleTarget = { providerId: 'prov-test', operationId: 'dep-sole', version: 'v1' };
    await wired.machine.transition({ target: soleTarget, toState: 'VERIFIED', reasonClass: 'V', actor: 't' });
    await wired.registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'critical-dashboard',
      target: soleTarget,
    });
    // The op is not yet deprecated → no sole-source problem for OTHER ops.
    expect(await wired.rules.soleSourceConsumers(soleTarget)).toHaveLength(1);

    // Deprecation without an exception refuses (Rule 6).
    await expect(
      wired.rules.deprecate({ target: soleTarget, actor: 'bot' }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_DEPRECATED_SOLE_CRITICAL_SOURCE });

    // With a valid exception it proceeds.
    await wired.exceptions.grant({
      target: soleTarget,
      approver: 'approver-2',
      reason: 'dashboard migration scheduled',
      replacementPlan: {
        planId: 'plan-2',
        targetProviderId: soleTarget.providerId,
        targetOperationId: soleTarget.operationId,
        targetVersion: soleTarget.version,
        plannedMigrationDeadline: ts('2026-11-15T00:00:00Z'),
        milestones: ['audit'],
        status: 'APPROVED',
      },
      expiresAt: ts('2026-10-01T00:00:00Z'),
    });
    await wired.rules.deprecate({ target: soleTarget, actor: 'bot' });
    expect(await wired.machine.currentState(soleTarget)).toBe('DEPRECATED');
  });

  it('STRICT_FREE surfaces disabled metadata instead of fabricating availability', async () => {
    await wired.registry.registerProvider({
      providerId: 'prov-test',
      displayName: 'Test Provider',
      providerGroup: 'g',
    });
    // Not allowed on strict-free at all.
    await wired.registry.registerOperation(testDefinition({ operationId: 'sf-no' }));
    const sfNo = { providerId: 'prov-test', operationId: 'sf-no', version: 'v1' };
    expect(await wired.rules.strictFreeAvailability(sfNo)).toEqual({
      available: false,
      reason: 'NOT_ALLOWED',
    });

    // Allowed but WITHOUT current proven plan verification.
    await wired.registry.registerOperation(
      testDefinition({ operationId: 'sf-stale', allowedInStrictFree: true }),
    );
    const sfStale = { providerId: 'prov-test', operationId: 'sf-stale', version: 'v1' };
    expect(await wired.rules.strictFreeAvailability(sfStale)).toEqual({
      available: false,
      reason: 'PLAN_UNVERIFIED',
    });

    // Allowed WITH a fresh AC-270 PRICING_PLAN pair.
    await wired.ttl.configureTtl({ kind: 'PRICING_PLAN', ttlSeconds: 3600 });
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await wired.ttl.recordVerification({
        target: sfStale,
        kind: 'PRICING_PLAN',
        source,
        outcome: 'PASSED',
        evidenceRefs: [`plan-${source}`],
      });
    }
    expect(await wired.rules.strictFreeAvailability(sfStale)).toEqual({
      available: true,
      reason: 'ALLOWED',
    });
    await expect(wired.rules.assertStrictFreeAllowed(sfNo)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_STRICT_FREE_PLAN_UNVERIFIED,
    });
  });
});
