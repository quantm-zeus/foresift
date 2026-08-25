/**
 * Lifecycle-machine unit suite (FR-PROV-001; §12.11/§15.4): guarded
 * transitions over the append-only ledger — graph legality, mandatory reason
 * classes, idempotency-key dedupe, projection consistency, reconstructable
 * history, and critical-transition bridging into the security AuditChain.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { fixedClock, utcTimestamp, type ClockPort } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditChain } from '@foresift/security';
import {
  LifecycleMachine,
  OperationRegistry,
  ProvErrorCode,
  ProviderAuditBridge,
  type OperationDefinition,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

/** Scripted timeline: each read stamps the next second (deterministic order). */
function steppedClock(startEpochMs: number): ClockPort {
  let current = startEpochMs;
  return {
    now: () => {
      const at = new Date(current).toISOString().replace('.000Z', 'Z');
      current += 1_000;
      return at as ReturnType<ClockPort['now']>;
    },
    nowEpochMs: () => current,
  };
}

let db: PGlite;
let engine: DatabaseEngine;
let registry: OperationRegistry;
let machine: LifecycleMachine;

async function seedOperation(
  providerId: string,
  operationId: string,
  version: string,
): Promise<void> {
  const definition: OperationDefinition = {
    providerId,
    operationId,
    version,
    capabilityClass: 'READ_ACCOUNT_STATE',
    supportedChains: ['solana-mainnet'],
    inputSchemaId: 'schema/in-1',
    rawOutputSchemaId: 'schema/raw-1',
    normalizedOutputSchemaId: 'schema/norm-1',
    quotaModelId: 'quota/basic',
    cachePolicyId: 'cache/short',
    timeoutMs: 5000,
    retryPolicyId: 'retry/twice',
    declaredIndependenceGroup: 'indep/g1',
    upstreamLineage: [],
    licensePolicyId: 'license/default',
    healthStatus: 'HEALTHY',
    costClass: 'FREE_QUOTA',
    estimatedQuotaUnits: 10,
    quotaResetPolicyId: 'reset/daily',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: '2026-07-01T00:00:00Z',
    forbiddenOutputFields: [],
    negativeCapabilities: ['no-trading'],
  };
  await registry.registerProvider({ providerId, providerGroup: 'g', displayName: providerId });
  await registry.registerOperation(definition);
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  registry = new OperationRegistry({ engine, clock: fixedClock(utcTimestamp('2026-06-01T12:00:00Z')) });
  machine = new LifecycleMachine({ engine, clock: fixedClock(utcTimestamp('2026-06-01T12:00:00Z')) });
});

afterAll(async () => {
  await db.close();
});

describe('guarded transitions (§12.11 graph)', () => {
  it('walks DISCOVERED→VERIFIED→ACTIVE⇄DEGRADED→…→terminal legally', async () => {
    await seedOperation('prov-walk', 'op', '1.0.0');
    const walk = [
      ['VERIFIED', 'VERIFICATION_PROMOTED'],
      ['ACTIVE', 'ACTIVATION_APPROVED'],
      ['DEGRADED', 'QUOTA_VERIFICATION_EXPIRED'],
      ['ACTIVE', 'RECOVERY_VERIFIED'],
      ['DEPRECATED', 'DEPRECATION_MARKED'],
    ] as const;
    for (const [toState, reason] of walk) {
      const result = await machine.transition({
        providerId: 'prov-walk',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState,
        reasonClass: reason,
        actor: 'test',
        idempotencyKey: `walk-${toState}-${reason}`,
      });
      expect(result.event.toState).toBe(toState);
      expect(result.idempotentReplay).toBe(false);
    }
    expect(await machine.projection('prov-walk', 'op', '1.0.0')).toEqual({
      currentState: 'DEPRECATED',
      healthStatus: 'HEALTHY',
    });
  });

  it('reconstructs the projection by folding history (INV-004)', async () => {
    const events = await machine.history('prov-walk', 'op', '1.0.0');
    expect(events.map((e) => e.toState)).toEqual([
      'DISCOVERED',
      'VERIFIED',
      'ACTIVE',
      'DEGRADED',
      'ACTIVE',
      'DEPRECATED',
    ]);
    // Genesis starts from NULL; every later event chains from the prior state.
    expect(events[0]?.fromState).toBeNull();
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]?.fromState).toBe(events[i - 1]?.toState);
    }

    // Terminal states have zero outgoing edges: further transitions refuse.
    await expect(
      machine.transition({
        providerId: 'prov-walk',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'ACTIVE',
        reasonClass: 'RECOVERY_VERIFIED',
        actor: 'test',
        idempotencyKey: 'zombie-reactivation',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_TRANSITION_ILLEGAL });
  });

  it('refuses edges outside the legal graph and unknown operations', async () => {
    await seedOperation('prov-guard', 'op', '1.0.0');
    await expect(
      machine.transition({
        providerId: 'prov-guard',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'ACTIVE',
        reasonClass: 'ACTIVATION_APPROVED',
        actor: 'test',
        idempotencyKey: 'skip-verified',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_TRANSITION_ILLEGAL });

    await expect(
      machine.transition({
        providerId: 'ghost',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'VERIFIED',
        reasonClass: 'VERIFICATION_PROMOTED',
        actor: 'test',
        idempotencyKey: 'ghost-op',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_OPERATION_UNKNOWN });
  });

  it('refuses unknown states and unknown/absent reason vocabulary', async () => {
    await seedOperation('prov-vocab', 'op', '1.0.0');
    await expect(
      machine.transition({
        providerId: 'prov-vocab',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'ARCHIVED' as never,
        reasonClass: 'VERIFICATION_PROMOTED',
        actor: 'test',
        idempotencyKey: 'bad-state',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_STATE_UNKNOWN });

    await expect(
      machine.transition({
        providerId: 'prov-vocab',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'VERIFIED',
        reasonClass: 'MADE_UP_REASON' as never,
        actor: 'test',
        idempotencyKey: 'bad-reason',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_TRANSITION_REASON_REQUIRED });
  });

  it('pins reason classes to coherent edges (expiry/recovery/genesis rules)', async () => {
    await seedOperation('prov-coherence', 'op', '1.0.0');
    // Expiry classes only ever exit ACTIVE.
    await expect(
      machine.transition({
        providerId: 'prov-coherence',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'VERIFIED',
        reasonClass: 'DOCUMENTATION_EXPIRED',
        actor: 'test',
        idempotencyKey: 'expiry-off-active',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_TRANSITION_ILLEGAL });
    // Recovery lands only in ACTIVE.
    await expect(
      machine.transition({
        providerId: 'prov-coherence',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'VERIFIED',
        reasonClass: 'RECOVERY_VERIFIED',
        actor: 'test',
        idempotencyKey: 'recovery-not-into-active',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_TRANSITION_ILLEGAL });
    // Genesis is registry-reserved.
    await expect(
      machine.transition({
        providerId: 'prov-coherence',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'VERIFIED',
        reasonClass: 'REGISTERED_DISCOVERED',
        actor: 'test',
        idempotencyKey: 'fake-genesis',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_TRANSITION_ILLEGAL });
  });
});

describe('idempotent fenced retries (INV-009, material decision 4)', () => {
  it('replays a retried key without double-appending', async () => {
    await seedOperation('prov-idem', 'op', '1.0.0');
    const input = {
      providerId: 'prov-idem',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'VERIFIED' as const,
      reasonClass: 'VERIFICATION_PROMOTED' as const,
      actor: 'test',
      idempotencyKey: 'retry-me-once',
    };
    const first = await machine.transition(input);
    const retry = await machine.transition(input);
    expect(first.idempotentReplay).toBe(false);
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.event.seq).toBe(first.event.seq);

    const rows = await engine.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM prov.prov_lifecycle_events WHERE idempotency_key = 'retry-me-once'",
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it('refuses a replayed key carrying different intent', async () => {
    await expect(
      machine.transition({
        providerId: 'prov-idem',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: 'ACTIVE',
        reasonClass: 'ACTIVATION_APPROVED',
        actor: 'test',
        idempotencyKey: 'retry-me-once',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_IDEMPOTENCY_KEY_CONFLICT });
  });
});

describe('projection + expiry semantics', () => {
  it('updates health status alongside state when provided', async () => {
    await seedOperation('prov-health', 'op', '1.0.0');
    await machine.transition({
      providerId: 'prov-health',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'VERIFIED',
      reasonClass: 'VERIFICATION_PROMOTED',
      actor: 'test',
      idempotencyKey: 'health-1',
    });
    await machine.transition({
      providerId: 'prov-health',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'ACTIVE',
      reasonClass: 'ACTIVATION_APPROVED',
      actor: 'test',
      idempotencyKey: 'health-2',
    });
    await machine.transition({
      providerId: 'prov-health',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'DEGRADED',
      reasonClass: 'QUOTA_VERIFICATION_EXPIRED',
      actor: 'verification-ttl-sweep',
      nextHealthStatus: 'PLAN_UNVERIFIED',
      idempotencyKey: 'health-3',
    });
    expect(await machine.projection('prov-health', 'op', '1.0.0')).toEqual({
      currentState: 'DEGRADED',
      healthStatus: 'PLAN_UNVERIFIED',
    });
  });

  it('expiry-driven exits append evidence without mutating history', async () => {
    await seedOperation('prov-expiry', 'op', '1.0.0');
    await machine.transition({
      providerId: 'prov-expiry',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'VERIFIED',
      reasonClass: 'VERIFICATION_PROMOTED',
      actor: 'test',
      idempotencyKey: 'exp-1',
    });
    const before = await machine.history('prov-expiry', 'op', '1.0.0');

    // BLOCKED is only reachable from ACTIVE — route through activation first.
    await machine.transition({
      providerId: 'prov-expiry',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'ACTIVE',
      reasonClass: 'ACTIVATION_APPROVED',
      actor: 'test',
      idempotencyKey: 'exp-1b',
    });
    await machine.transition({
      providerId: 'prov-expiry',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'BLOCKED',
      reasonClass: 'OPERATOR_BLOCK',
      actor: 'operator',
      evidenceRefs: ['incident/inc-42'],
      idempotencyKey: 'exp-2',
    });
    const after = await machine.history('prov-expiry', 'op', '1.0.0');

    // Prior events are byte-identical; each exit is a NEW compensating event.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBe(before.length + 2);
  });
});

describe('critical transitions bridge into the security AuditChain (AC-259 surface)', () => {
  it('emits PROVIDER_COLLECTOR_ACCESS on activation, BLOCKED_OPERATION on block, silence otherwise', async () => {
    const chain = new AuditChain({ engine });
    const auditedMachine = new LifecycleMachine({
      engine,
      clock: steppedClock(Date.parse('2026-06-03T09:00:00Z')),
      audit: new ProviderAuditBridge({ chain }),
    });
    await seedOperation('prov-audit', 'op', '1.0.0');

    await auditedMachine.transition({
      providerId: 'prov-audit',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'VERIFIED',
      reasonClass: 'VERIFICATION_PROMOTED',
      actor: 'test',
      idempotencyKey: 'aud-1',
    });
    await auditedMachine.transition({
      providerId: 'prov-audit',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'ACTIVE',
      reasonClass: 'ACTIVATION_APPROVED',
      actor: 'test',
      idempotencyKey: 'aud-2',
    });
    await auditedMachine.transition({
      providerId: 'prov-audit',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'DEGRADED',
      reasonClass: 'HEALTH_INCIDENT',
      actor: 'monitor',
      idempotencyKey: 'aud-3',
    });
    // BLOCKED is only reachable from ACTIVE — recover first.
    await auditedMachine.transition({
      providerId: 'prov-audit',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'ACTIVE',
      reasonClass: 'RECOVERY_VERIFIED',
      actor: 'monitor',
      idempotencyKey: 'aud-3b',
    });
    await auditedMachine.transition({
      providerId: 'prov-audit',
      operationId: 'op',
      operationVersion: '1.0.0',
      toState: 'BLOCKED',
      reasonClass: 'CAPABILITY_VIOLATION_BLOCK',
      actor: 'enforcer',
      idempotencyKey: 'aud-4',
    });

    const entries = await engine.query<{ action_class: string; subject: string }>(
      "SELECT action_class, subject FROM sec.sec_audit_events WHERE subject LIKE 'provider:prov-audit/%'",
    );
    // Activation AND recovery-into-ACTIVE are collector-access facts;
    // DEGRADED (health incident) stays ledger-only.
    expect(entries.rows.map((r) => r.action_class)).toEqual([
      'PROVIDER_COLLECTOR_ACCESS',
      'PROVIDER_COLLECTOR_ACCESS',
      'BLOCKED_OPERATION',
    ]);

    // The chain stays verifiable end-to-end after the bridges.
    const verify = await chain.verifyRange();
    expect(verify.run.verdict).toBe('OK');
  });
});
