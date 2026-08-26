/**
 * T111: verification TTLs fail closed — unconfigured TTLs refuse, AC-270
 * requires the OFFICIAL_DOC+LIVE_CONTRACT refresh pair, sweeps map expired
 * kinds to §15.4 health outcomes with idempotent (dedupe-safe) events.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClockPort, UtcTimestamp } from '@foresift/domain';
import { makeProvEngine, testDefinition, wireEngine, type Wired } from './helpers.ts';
import { expiryHealthFor } from '../src/verification-ttl.ts';
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

const TARGET = { providerId: 'prov-test', operationId: 'op-ttl', version: 'v1' } as const;

async function seedActive(operationId = 'op-ttl'): Promise<void> {
  await wired.registry.registerProvider({
    providerId: 'prov-test',
    displayName: 'Test Provider',
    providerGroup: 'g',
  });
  await wired.registry.registerOperation(
    testDefinition({ operationId, verificationExpiresAt: ts('2099-01-01T00:00:00Z') }),
  );
  const target = { ...TARGET, operationId };
  await wired.machine.transition({ target, toState: 'VERIFIED', reasonClass: 'V', actor: 't' });
  await wired.machine.transition({ target, toState: 'ACTIVE', reasonClass: 'A', actor: 't' });
}

describe('T111 verification TTL engine', () => {
  it('refuses freshness evaluation when no TTL is configured (fail-closed)', async () => {
    await seedActive('op-unconf');
    await expect(
      wired.ttl.evaluateKind({ ...TARGET, operationId: 'op-unconf' }, 'SCHEMA'),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_VERIFICATION_TTL_UNCONFIGURED });
  });

  it('enforces the AC-270 refresh pair per kind', async () => {
    await seedActive('op-pair');
    const target = { ...TARGET, operationId: 'op-pair' };
    await wired.ttl.configureTtl({ kind: 'SCHEMA', ttlSeconds: 3600 });
    await wired.ttl.configureTtl({ kind: 'PRICING_PLAN', ttlSeconds: 60 });

    // Only OFFICIAL_DOC so far.
    await wired.ttl.recordVerification({
      target,
      kind: 'SCHEMA',
      source: 'OFFICIAL_DOC',
      outcome: 'PASSED',
      evidenceRefs: ['doc://schema@1'],
    });
    await expect(wired.ttl.assertActiveUseAllowed(target, 'SCHEMA')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_VERIFICATION_REFRESH_INCOMPLETE,
    });

    // LIVE_CONTRACT completes the pair.
    await wired.ttl.recordVerification({
      target,
      kind: 'SCHEMA',
      source: 'LIVE_CONTRACT',
      outcome: 'PASSED',
      evidenceRefs: ['probe://schema-live/1'],
    });
    const fresh = await wired.ttl.evaluateKind(target, 'SCHEMA');
    expect(fresh.pairFresh).toBe(true);

    // FAILED records never count as fresh evidence.
    await wired.ttl.recordVerification({
      target,
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'FAILED',
      evidenceRefs: ['doc://plan'],
    });
    const planFreshness = await wired.ttl.evaluateKind(target, 'PRICING_PLAN');
    expect(planFreshness.pairFresh).toBe(false);
  });

  it('expires records against the injected clock only', async () => {
    const { db, engine } = await makeProvEngine();
    try {
      let now = Date.parse('2026-08-26T00:00:00Z');
      const mutableClock: ClockPort = {
        now: () => ts(new Date(now).toISOString()),
        nowEpochMs: () => now,
      };
      const w = wireEngine(engine, mutableClock);
      await w.registry.registerProvider({ providerId: 'p', displayName: 'P', providerGroup: 'g' });
      await w.registry.registerOperation(
        testDefinition({ providerId: 'p', verificationExpiresAt: ts('2099-01-01T00:00:00Z') }),
      );
      const target = { providerId: 'p', operationId: 'op-test', version: 'v1' };
      await w.ttl.configureTtl({ kind: 'ENDPOINT', ttlSeconds: 1000 });
      await w.ttl.recordVerification({
        target,
        kind: 'ENDPOINT',
        source: 'OFFICIAL_DOC',
        outcome: 'PASSED',
        evidenceRefs: ['e1'],
      });
      await w.ttl.recordVerification({
        target,
        kind: 'ENDPOINT',
        source: 'LIVE_CONTRACT',
        outcome: 'PASSED',
        evidenceRefs: ['e2'],
      });
      expect((await w.ttl.evaluateKind(target, 'ENDPOINT')).pairFresh).toBe(true);
      now += 1001_000; // past the TTL window
      expect((await w.ttl.evaluateKind(target, 'ENDPOINT')).pairFresh).toBe(false);
    } finally {
      await db.close();
    }
  });

  it('dedupes replayed verification ingestion to the SAME record', async () => {
    await seedActive('op-dedupe');
    const target = { ...TARGET, operationId: 'op-dedupe' };
    await wired.ttl.configureTtl({ kind: 'DOCUMENTATION', ttlSeconds: 3600 });
    const input = {
      target,
      kind: 'DOCUMENTATION' as const,
      source: 'OFFICIAL_DOC' as const,
      outcome: 'PASSED' as const,
      verifiedAt: ts('2026-08-26T12:00:00Z'),
      evidenceRefs: ['doc://d'],
    };
    const first = await wired.ttl.recordVerification(input);
    const retry = await wired.ttl.recordVerification(input);
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.verificationId).toBe(first.verificationId);
  });

  it('sweeps expired ACTIVE operations to the mapped §15.4 health outcomes, idempotently', async () => {
    await seedActive('op-sweep');
    const target = { ...TARGET, operationId: 'op-sweep' };
    await wired.ttl.configureTtl({ kind: 'PRICING_PLAN', ttlSeconds: 60 });
    // Both sources PASSED at T0, expiring ~T0+60s — both stale vs the fixed
    // clock (2026-08-26T12:00:00Z).
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await wired.ttl.recordVerification({
        target,
        kind: 'PRICING_PLAN',
        source,
        outcome: 'PASSED',
        verifiedAt: ts('2026-01-01T00:00:00Z'),
        evidenceRefs: [`plan-${source}`],
      });
    }
    const report = await wired.ttl.sweepExpired();
    expect(report.examinedOperations).toBeGreaterThanOrEqual(1);
    const planExit = report.transitions.find(
      (t) => t.reasonClass === 'VERIFICATION_EXPIRED:PRICING_PLAN',
    );
    expect(planExit).toBeDefined();

    const op = await wired.registry.getOperation(target);
    expect(op.currentState).toBe('DEGRADED');
    expect(op.healthStatus).toBe('PLAN_UNVERIFIED');
    // Effective instant = the lapsed record's expiry, not the sweep time.
    const history = await wired.machine.history(target);
    const exitEvent = history.find((h) => h.reasonClass === 'VERIFICATION_EXPIRED:PRICING_PLAN');
    expect(exitEvent?.effectiveAt.startsWith('2026-01-01T00:01:')).toBe(true);

    // Idempotency: reactivate WITHOUT refreshing and sweep again → dedupe.
    await wired.machine.transition({
      target,
      toState: 'ACTIVE',
      reasonClass: 'REACTIVATED',
      actor: 't',
    });
    const second = await wired.ttl.sweepExpired();
    expect(second.transitions[0]?.deduped).toBe(true);
    const historyAfter = await wired.machine.history(target);
    expect(
      historyAfter.filter((h) => h.reasonClass === 'VERIFICATION_EXPIRED:PRICING_PLAN'),
    ).toHaveLength(1);
  });

  it('maps expired kinds to the §15.4 health outcomes exactly', () => {
    expect(expiryHealthFor('PRICING_PLAN')).toBe('PLAN_UNVERIFIED');
    expect(expiryHealthFor('QUOTA')).toBe('PLAN_UNVERIFIED');
    expect(expiryHealthFor('RIGHTS')).toBe('RIGHTS_UNVERIFIED');
    expect(expiryHealthFor('DOCUMENTATION')).toBe('DEGRADED');
    expect(expiryHealthFor('SCHEMA')).toBe('DEGRADED');
    expect(expiryHealthFor('ENDPOINT')).toBe('DEGRADED');
    expect(expiryHealthFor('AUTHENTICATION')).toBe('DEGRADED');
    expect(expiryHealthFor('DEPRECATION')).toBe('DEGRADED');
    expect(expiryHealthFor('LIVE_PROBE')).toBe('DEGRADED');
  });

  it('advances last-documentation/probe projection instants on PASSED records', async () => {
    await seedActive('op-proj');
    const target = { ...TARGET, operationId: 'op-proj' };
    await wired.ttl.configureTtl({ kind: 'DOCUMENTATION', ttlSeconds: 3600 });
    await wired.ttl.configureTtl({ kind: 'LIVE_PROBE', ttlSeconds: 3600 });
    await wired.ttl.recordVerification({
      target,
      kind: 'DOCUMENTATION',
      source: 'OFFICIAL_DOC',
      outcome: 'PASSED',
      evidenceRefs: ['d'],
    });
    await wired.ttl.recordVerification({
      target,
      kind: 'LIVE_PROBE',
      source: 'LIVE_CONTRACT',
      outcome: 'PASSED',
      evidenceRefs: ['p'],
    });
    const rows = await wired.engine.query<{
      last_documentation_verification_at: string | null;
      last_live_probe_at: string | null;
    }>(
      `SELECT last_documentation_verification_at::text AS last_documentation_verification_at,
              last_live_probe_at::text AS last_live_probe_at
       FROM prov.prov_operations WHERE provider_id=$1 AND operation_id=$2 AND version=$3`,
      [target.providerId, target.operationId, target.version],
    );
    expect(rows.rows[0]?.last_documentation_verification_at).toContain('2026-08-26');
    expect(rows.rows[0]?.last_live_probe_at).toContain('2026-08-26');
  });
});
