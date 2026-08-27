/**
 * AC-270 negative.
 * Traces: FR-PROV-002, FR-PROV-003, FR-PROV-001.
 * Refusals proven: a PARTIAL single-source refresh does NOT satisfy the pair
 * rule; refreshing the WRONG KIND does not help; stale pre-expiry
 * verification records do not satisfy; lapsed migration exceptions re-block
 * use of deprecated operations with no grace period.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { utcTimestamp } from '@foresift/domain';
import {
  LifecycleMachine,
  MigrationExceptions,
  OperationRegistry,
  VerificationTtlEngine,
  ProvErrorCode,
} from '@foresift/provider-lifecycle';
import type { OperationTarget, ProviderVerificationKind } from '@foresift/provider-lifecycle';
import {
  closeProvTestDatabase,
  makeMutableClock,
  makeProvTestDatabase,
  provOperationDefinition,
  recordVerification,
  type MutableClock,
  type ProvTestDatabase,
} from '../helpers/prov.ts';

const clockControl: MutableClock = makeMutableClock('2026-01-10T00:00:00Z');
const clock = clockControl.clock;

let tdb: ProvTestDatabase;
let registry: OperationRegistry;
let machine: LifecycleMachine;
let ttl: VerificationTtlEngine;

beforeAll(async () => {
  tdb = await makeProvTestDatabase();
  registry = new OperationRegistry(tdb.engine, clock);
  machine = new LifecycleMachine({ engine: tdb.engine, clock });
  ttl = new VerificationTtlEngine({ engine: tdb.engine, clock, machine });
  await registry.registerProvider({
    providerId: 'ac270neg-provider',
    displayName: 'AC-270 negative provider',
    providerGroup: 'acceptance',
  });
});

afterAll(async () => {
  await closeProvTestDatabase(tdb);
});

/**
 * Records one verification. The window defaults to [now, now+1h] — strictly
 * ordered at ANY injected clock instant; backdated windows are pinned
 * explicitly by the stale-record test.
 */
async function recordOne(
  target: OperationTarget,
  kind: ProviderVerificationKind,
  source: 'OFFICIAL_DOC' | 'LIVE_CONTRACT',
  window: { verifiedAt?: string; expiresAt?: string } = {},
): Promise<void> {
  await recordVerification(ttl, { target, kind, source, clock, window });
}

describe('AC-270 refusals', () => {
  it('refuses a PARTIAL single-source refresh', async () => {
    const target: OperationTarget = {
      providerId: 'ac270neg-provider',
      operationId: 'op-partial',
      version: 'v1',
    };
    await registry.registerOperation(provOperationDefinition(target));
    await ttl.configureTtl({ kind: 'DOCUMENTATION', ttlSeconds: 60 });
    // The window lapses unrecorded; then ONE source is refreshed.
    clockControl.setNow('2026-03-01T00:00:00Z');
    await recordOne(target, 'DOCUMENTATION', 'OFFICIAL_DOC');
    const freshness = await ttl.evaluateKind(target, 'DOCUMENTATION');
    expect(freshness.officialDoc.fresh).toBe(true);
    expect(freshness.liveContract.fresh).toBe(false);
    expect(freshness.pairFresh).toBe(false);
    await expect(ttl.assertActiveUseAllowed(target, 'DOCUMENTATION')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE,
    });
  });

  it('refuses when only the WRONG KIND was refreshed', async () => {
    const target: OperationTarget = {
      providerId: 'ac270neg-provider',
      operationId: 'op-wrongkind',
      version: 'v1',
    };
    await registry.registerOperation(provOperationDefinition(target));
    await ttl.configureTtl({ kind: 'DOCUMENTATION', ttlSeconds: 3_600 });
    await ttl.configureTtl({ kind: 'SCHEMA', ttlSeconds: 3_600 });
    // SCHEMA gets a complete fresh pair; DOCUMENTATION gets nothing.
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await recordOne(target, 'SCHEMA', source);
    }
    const schemaFreshness = await ttl.assertActiveUseAllowed(target, 'SCHEMA');
    expect(schemaFreshness.pairFresh).toBe(true); // right kind works...
    const docFreshness = await ttl.evaluateKind(target, 'DOCUMENTATION');
    expect(docFreshness.pairFresh).toBe(false); // ...wrong kind does not count
    await expect(ttl.assertActiveUseAllowed(target, 'DOCUMENTATION')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE,
    });
  });

  it('stale pre-expiry verification does not satisfy the pair rule', async () => {
    const target: OperationTarget = {
      providerId: 'ac270neg-provider',
      operationId: 'op-backdated',
      version: 'v1',
    };
    await registry.registerOperation(provOperationDefinition(target));
    await ttl.configureTtl({ kind: 'DOCUMENTATION', ttlSeconds: 60 });
    // BOTH sources recorded — but their windows ALREADY ended before "now"
    // (verified Feb 1, expired Mar 15, clock now Apr 1).
    clockControl.setNow('2026-04-01T00:00:00Z');
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await recordOne(target, 'DOCUMENTATION', source, {
        verifiedAt: '2026-02-01T00:00:00Z',
        expiresAt: '2026-03-15T00:00:00Z',
      });
    }
    const freshness = await ttl.evaluateKind(target, 'DOCUMENTATION');
    expect(freshness.officialDoc.fresh).toBe(false);
    expect(freshness.liveContract.fresh).toBe(false);
    await expect(ttl.assertActiveUseAllowed(target, 'DOCUMENTATION')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE,
      detail: expect.objectContaining({
        officialDocFresh: false,
        liveContractFresh: false,
      }),
    });
  });

  it('lapsed migration exceptions re-block use of a DEPRECATED operation', async () => {
    const target: OperationTarget = {
      providerId: 'ac270neg-provider',
      operationId: 'op-exc-lapse',
      version: 'v1',
    };
    await registry.registerOperation(
      provOperationDefinition(target, { deprecatedAt: utcTimestamp('2026-01-01T00:00:00Z') }),
    );
    const exceptions = new MigrationExceptions(tdb.engine, clock);
    // Grant while the clock sits BEFORE the requested expiry (window valid).
    const granted = await exceptions.grant({
      target,
      approver: 'ac270-operator',
      reason: 'deprecated parser still sole coverage',
      replacementPlan: {
        planId: 'plan/ac270-lapse',
        targetProviderId: target.providerId,
        targetOperationId: 'op-replacement',
        targetVersion: 'v1',
        plannedMigrationDeadline: utcTimestamp('2026-06-01T00:00:00Z'),
        milestones: ['milestone/audit-decode-path'],
        status: 'APPROVED',
      },
      expiresAt: utcTimestamp('2026-05-01T00:00:00Z'),
    });
    expect(granted.exceptionId).toBeTruthy();
    clockControl.setNow('2026-04-30T23:59:59Z'); // inside the exception window
    await exceptions.assertValidForUse(target);
    clockControl.setNow('2026-05-01T00:00:01Z'); // one second past → re-blocked, NO grace
    await expect(exceptions.assertValidForUse(target)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_MIGRATION_EXCEPTION_EXPIRED,
    });
  });
});
