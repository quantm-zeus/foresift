/**
 * T110: guarded transitions — graph enforcement, mandatory reasons, INV-009
 * retry dedupe, AC-270 activation gating, audit emission, and the guarantee
 * that expiry-style exits never mutate stored ledger evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UtcTimestamp } from '@foresift/domain';
import { makeProvEngine, testDefinition, wireEngine, type Wired } from './helpers.ts';
import type { LifecycleAuditBridge } from '../src/audit-bridges.ts';
import { LifecycleMachine } from '../src/lifecycle-machine.ts';
import { ProvErrorCode } from '../src/errors.ts';

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

async function seedActive(operationId = 'op-machine'): Promise<void> {
  await wired.registry.registerProvider({
    providerId: 'prov-test',
    displayName: 'Test Provider',
    providerGroup: 'group-a',
  });
  await wired.registry.registerOperation(testDefinition({ operationId }));
  const target = { providerId: 'prov-test', operationId, version: 'v1' };
  await wired.machine.transition({ target, toState: 'VERIFIED', reasonClass: 'VERIFICATION_PASSED', actor: 'test' });
  await wired.machine.transition({ target, toState: 'ACTIVE', reasonClass: 'ACTIVATION', actor: 'test' });
}

describe('T110 lifecycle machine', () => {
  it('walks the legal path and projects state', async () => {
    await seedActive('op-walk');
    const target = { providerId: 'prov-test', operationId: 'op-walk', version: 'v1' };
    expect(await wired.machine.currentState(target)).toBe('ACTIVE');
    await wired.machine.transition({ target, toState: 'DEGRADED', reasonClass: 'PROBE_FAILED', actor: 'test' });
    expect(await wired.machine.currentState(target)).toBe('DEGRADED');
    await wired.machine.transition({ target, toState: 'ACTIVE', reasonClass: 'RECOVERY', actor: 'test' });
    const history = await wired.machine.history(target);
    expect(history.map((h) => h.toState)).toEqual(['VERIFIED', 'ACTIVE', 'DEGRADED', 'ACTIVE']);
  });

  it('refuses illegal edges and empty reason classes before any write', async () => {
    await seedActive('op-illegal');
    const target = { providerId: 'prov-test', operationId: 'op-illegal', version: 'v1' };
    await expect(
      wired.machine.transition({ target, toState: 'DISCOVERED', reasonClass: 'TIME_TRAVEL', actor: 'test' }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_LIFECYCLE_TRANSITION_ILLEGAL });
    await expect(
      wired.machine.transition({ target, toState: 'BLOCKED', reasonClass: '   ', actor: 'test' }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_LIFECYCLE_REASON_REQUIRED });
    expect(await wired.machine.currentState(target)).toBe('ACTIVE');
    // No events were appended by the refusals.
    expect(await wired.machine.history(target)).toHaveLength(2);
  });

  it('dedupes a retried transition to the SAME event (INV-009)', async () => {
    await seedActive('op-retry');
    const target = { providerId: 'prov-test', operationId: 'op-retry', version: 'v1' };
    await wired.machine.transition({ target, toState: 'DEGRADED', reasonClass: 'PROBE_FAILED', actor: 'test' });
    const retry = await wired.machine.transition({
      target,
      toState: 'DEGRADED',
      reasonClass: 'PROBE_FAILED',
      actor: 'test',
    });
    expect(retry.deduped).toBe(true);
    // Exactly ONE PROBE_FAILED event exists.
    const history = await wired.machine.history(target);
    expect(history.filter((h) => h.reasonClass === 'PROBE_FAILED')).toHaveLength(1);
    // And a fully-completed retry (projection already moved) still resolves.
    const replay = await wired.machine.transition({
      target,
      toState: 'DEGRADED',
      reasonClass: 'PROBE_FAILED',
      actor: 'test',
    });
    expect(replay.deduped).toBe(true);
  });

  it('emits audit through the bridge — BLOCKED_OPERATION for blocks — and skips audit on dedupe', async () => {
    const emitted: { actionClass: string; toState: string }[] = [];
    const auditSink = {
      transitionAppended: async (input: {
        toState: string;
        eventId: string;
      }): Promise<void> => {
        emitted.push({
          actionClass: input.toState === 'BLOCKED' ? 'BLOCKED_OPERATION' : 'PROVIDER_COLLECTOR_ACCESS',
          toState: input.toState,
        });
        void input.eventId;
      },
    };
    const { db, engine } = await makeProvEngine();
    try {
      const audited = wireEngine(engine);
      const machine = new LifecycleMachine({ engine, clock: audited.clock, audit: auditSink as unknown as LifecycleAuditBridge });
      await audited.registry.registerProvider({
        providerId: 'prov-test',
        displayName: 'Test Provider',
        providerGroup: 'g',
      });
      await audited.registry.registerOperation(testDefinition({ operationId: 'op-audit' }));
      const target = { providerId: 'prov-test', operationId: 'op-audit', version: 'v1' };
      await machine.transition({ target, toState: 'VERIFIED', reasonClass: 'V', actor: 'a' });
      await machine.transition({ target, toState: 'BLOCKED', reasonClass: 'MALICIOUS_RESPONSE', actor: 'a' });
      await machine.transition({ target, toState: 'BLOCKED', reasonClass: 'MALICIOUS_RESPONSE', actor: 'a' }); // dedupe
      expect(emitted.map((e) => e.actionClass)).toEqual([
        'PROVIDER_COLLECTOR_ACCESS',
        'BLOCKED_OPERATION',
      ]);
    } finally {
      await db.close();
    }
  });

  it('gates entry into ACTIVE through the injected activation gate', async () => {
    const { db, engine } = await makeProvEngine();
    try {
      const base = wireEngine(engine);
      let gateCalls = 0;
      const gated = new LifecycleMachine({
        engine,
        clock: base.clock,
        activationGate: async () => {
          gateCalls += 1;
          throw new Error('refresh pair incomplete');
        },
      });
      await base.registry.registerProvider({
        providerId: 'prov-test',
        displayName: 'Test Provider',
        providerGroup: 'g',
      });
      await base.registry.registerOperation(testDefinition({ operationId: 'op-gate' }));
      const target = { providerId: 'prov-test', operationId: 'op-gate', version: 'v1' };
      await gated.transition({ target, toState: 'VERIFIED', reasonClass: 'V', actor: 'a' });
      await expect(
        gated.transition({ target, toState: 'ACTIVE', reasonClass: 'A', actor: 'a' }),
      ).rejects.toThrow(/refresh pair incomplete/);
      expect(gateCalls).toBe(1); // VERIFIED→ did not hit the ACTIVE gate
      expect(await gated.currentState(target)).toBe('VERIFIED');
    } finally {
      await db.close();
    }
  });

  it('expiry-driven exits append history without mutating stored evidence', async () => {
    await seedActive('op-expiry');
    const target = { providerId: 'prov-test', operationId: 'op-expiry', version: 'v1' };
    const before = await wired.machine.history(target);
    // A sweep-style exit: effective at the LAPSED instant, health projected.
    await wired.machine.transition({
      target,
      toState: 'DEGRADED',
      reasonClass: 'VERIFICATION_EXPIRED:PRICING_PLAN',
      actor: 'verification-ttl-sweep',
      effectiveAt: '2026-08-26T00:00:00Z' as UtcTimestamp,
      projectHealthStatus: 'PLAN_UNVERIFIED',
    });
    const after = await wired.machine.history(target);
    // Prior rows byte-identical; only an APPEND happened.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
    const op = await wired.registry.getOperation(target);
    expect(op.healthStatus).toBe('PLAN_UNVERIFIED');
  });

  it('refuses transitions for unregistered operations', async () => {
    await expect(
      wired.machine.transition({
        target: { providerId: 'ghost', operationId: 'x', version: 'v1' },
        toState: 'VERIFIED',
        reasonClass: 'V',
        actor: 'a',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_OPERATION_UNKNOWN });
  });
});
