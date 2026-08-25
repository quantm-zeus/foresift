/**
 * Deprecation-rules + migration-exceptions suite (FR-PROV-003; §15.4 rules
 * 1/2/6): new-use blocking on deprecatedAt, escape-hatch exceptions that
 * lapse fail-closed at use time, sole-critical-source refusal, sunset
 * incidents through the security API, and STRICT_FREE plan gating.
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
import { Incidents } from '@foresift/security';
import {
  DeprecationRules,
  LifecycleMachine,
  MigrationExceptions,
  OperationRegistry,
  ProvErrorCode,
  VerificationTtlService,
  type OperationDefinition,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

function manualClock(startEpochMs: number): { clock: ClockPort; moveTo: (ms: number) => void } {
  let current = startEpochMs;
  return {
    clock: {
      now: () => new Date(current).toISOString().replace('.000Z', 'Z') as ReturnType<ClockPort['now']>,
      nowEpochMs: () => current,
    },
    moveTo: (ms) => {
      current = ms;
    },
  };
}

let db: PGlite;
let engine: DatabaseEngine;

const T0 = Date.parse('2026-06-01T00:00:00Z');

async function seedOperation(
  providerId: string,
  operationId: string,
  overrides?: Partial<OperationDefinition>,
): Promise<void> {
  const registry = new OperationRegistry({ engine });
  const definition: OperationDefinition = {
    providerId,
    operationId,
    version: '1.0.0',
    capabilityClass: 'READ_ACCOUNT_STATE',
    supportedChains: ['solana-mainnet'],
    inputSchemaId: 'schema/in',
    rawOutputSchemaId: 'schema/raw',
    normalizedOutputSchemaId: 'schema/norm',
    quotaModelId: 'quota/basic',
    cachePolicyId: 'cache/short',
    timeoutMs: 5000,
    retryPolicyId: 'retry/twice',
    declaredIndependenceGroup: 'indep/g',
    upstreamLineage: [],
    licensePolicyId: 'license/default',
    healthStatus: 'HEALTHY',
    costClass: 'FREE_QUOTA',
    estimatedQuotaUnits: 10,
    quotaResetPolicyId: 'reset/daily',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: '2027-01-01T00:00:00Z',
    forbiddenOutputFields: [],
    negativeCapabilities: ['no-trading'],
    ...overrides,
  };
  await registry.registerProvider({ providerId, providerGroup: 'g', displayName: providerId });
  await registry.registerOperation(definition);
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('migration exceptions (FR-PROV-003)', () => {
  it('grants bounded exceptions, validates use-time, revokes immediately', async () => {
    const { clock, moveTo } = manualClock(T0);
    const exceptions = new MigrationExceptions({ engine, clock });
    await seedOperation('prov-exc', 'op');

    // Backdated expiry refuses.
    await expect(
      exceptions.grant({
        providerId: 'prov-exc',
        operationId: 'op',
        approver: 'operator-a',
        replacementPlanRef: 'plan/migrate-op-v2',
        exceptionExpiresAt: '2025-12-31T00:00:00Z',
        evidenceRefs: ['ticket/123'],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_EXCEPTION_WINDOW_INVALID });

    // Evidence-free grant refuses.
    await expect(
      exceptions.grant({
        providerId: 'prov-exc',
        operationId: 'op',
        approver: 'operator-a',
        replacementPlanRef: 'plan/migrate-op-v2',
        exceptionExpiresAt: '2026-07-01T00:00:00Z',
        evidenceRefs: [],
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_EXCEPTION_WINDOW_INVALID });

    const granted = await exceptions.grant({
      providerId: 'prov-exc',
      operationId: 'op',
      approver: 'operator-a',
      replacementPlanRef: 'plan/migrate-op-v2',
      replacementOperationId: 'op-v2',
      exceptionExpiresAt: '2026-07-01T00:00:00Z',
      evidenceRefs: ['ticket/123', 'approval/link'],
    });
    expect(granted.exceptionId).toMatch(/^exc-/);

    // Valid inside the window…
    expect((await exceptions.findValid('prov-exc', 'op'))?.exceptionId).toBe(granted.exceptionId);

    // …the INSTANT it lapses it authorizes nothing again (no grace window).
    moveTo(Date.parse('2026-07-01T00:00:01Z'));
    expect(await exceptions.findValid('prov-exc', 'op')).toBeUndefined();

    // Revocation is immediate and independent of the window.
    const second = await exceptions.grant({
      providerId: 'prov-exc',
      operationId: 'op',
      approver: 'operator-b',
      replacementPlanRef: 'plan/migrate-op-v2-b',
      exceptionExpiresAt: '2027-01-01T00:00:00Z',
      evidenceRefs: ['ticket/124'],
    });
    const revoked = await exceptions.revoke(second.exceptionId);
    expect(revoked.revokedAt).toBeDefined();
    expect(await exceptions.findValid('prov-exc', 'op')).toBeUndefined();

    // Unknown exception ids refuse.
    await expect(exceptions.revoke('exc-missing')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_EXCEPTION_UNKNOWN,
    });
  });
});

describe('new-use blocking + sole critical source (§15.4 rule 1/6)', () => {
  it('blocks NEW dependency registrations on deprecated operations without a valid exception', async () => {
    const { clock, moveTo } = manualClock(T0);
    const exceptions = new MigrationExceptions({ engine, clock });
    const rules = new DeprecationRules({ engine, clock, exceptions });
    await seedOperation('prov-block', 'op');

    // Not deprecated → registration passes.
    await rules.assertNewUseAllowed('prov-block', 'op');
    const registry = new OperationRegistry({ engine });
    await registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'feature/before-deprecation',
      providerId: 'prov-block',
      operationId: 'op',
    });

    // Mark deprecated via SQL truth column (deprecation marking itself is
    // exercised through the lifecycle machine elsewhere).
    await engine.query(
      "UPDATE prov.prov_operations SET deprecated_at = '2026-06-01T00:00:00Z' WHERE provider_id = 'prov-block'",
    );

    // No exception → blocked.
    await expect(rules.assertNewUseAllowed('prov-block', 'op')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
    });

    // Valid exception → allowed again.
    await exceptions.grant({
      providerId: 'prov-block',
      operationId: 'op',
      approver: 'operator-a',
      replacementPlanRef: 'plan/migrate',
      exceptionExpiresAt: '2026-08-01T00:00:00Z',
      evidenceRefs: ['ticket/125'],
    });
    moveTo(T0); // back inside the window
    await rules.assertNewUseAllowed('prov-block', 'op');
    await registry.registerDependency({
      consumerKind: 'TOOL',
      consumerKey: 'tool/under-exception',
      providerId: 'prov-block',
      operationId: 'op',
    });

    // Lapse re-blocks automatically at use time.
    moveTo(Date.parse('2026-08-01T00:00:01Z'));
    await expect(rules.assertNewUseAllowed('prov-block', 'op')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEPRECATED_NEW_USE_BLOCKED,
    });
  });

  it('refuses deprecating the sole active source of a critical field', async () => {
    const rules = new DeprecationRules({ engine, clock: fixedClock(utcTimestamp('2026-06-01T00:00:00Z')) });
    const registry = new OperationRegistry({ engine });

    await seedOperation('prov-sole', 'primary-source');
    await seedOperation('prov-other', 'secondary-provider');
    await registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'feature/critical-view',
      providerId: 'prov-sole',
      operationId: 'primary-source',
      criticalField: 'wallet-balances',
    });
    // A second source exists for a DIFFERENT field only.
    await registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'feature/critical-view',
      providerId: 'prov-other',
      operationId: 'secondary-provider',
      criticalField: 'token-prices',
    });

    expect(await rules.soleCriticalFields('prov-sole', 'primary-source')).toEqual([
      'wallet-balances',
    ]);
    await expect(rules.assertNotSoleCriticalSource('prov-sole', 'primary-source')).rejects.toMatchObject({
      code: ProvErrorCode.PROV_SOLE_CRITICAL_SOURCE_REFUSED,
    });

    // Once a second active source registers for the field, deprecation passes.
    await seedOperation('prov-wallet', 'wallet-source');
    await registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'feature/critical-view',
      providerId: 'prov-wallet',
      operationId: 'wallet-source',
      criticalField: 'wallet-balances',
    });
    expect(await rules.soleCriticalFields('prov-sole', 'primary-source')).toEqual([]);
    await rules.assertNotSoleCriticalSource('prov-sole', 'primary-source');
  });
});

describe('sunset incidents + STRICT_FREE gating (§15.4 rule 2 / FR-PROV-007)', () => {
  it('raises ONE idempotent incident per sunset-passed operation with the deadline as evidence', async () => {
    const { clock } = manualClock(T0);
    const incidents = new Incidents(engine);
    const rules = new DeprecationRules({ engine, clock, incidents });
    await seedOperation('prov-sunset', 'op', {
      sunsetAt: '2026-05-31T00:00:00Z', // already past T0
      deprecatedAt: '2026-05-01T00:00:00Z',
    });
    // The sunset duty covers operations IN SERVICE (ACTIVE/DEGRADED), so the
    // seeded registration is walked through promotion and activation first.
    const machine = new LifecycleMachine({ engine, clock });
    for (const step of [
      { toState: 'VERIFIED', reasonClass: 'VERIFICATION_PROMOTED', key: 'promote' },
      { toState: 'ACTIVE', reasonClass: 'ACTIVATION_APPROVED', key: 'activate' },
    ] as const) {
      await machine.transition({
        providerId: 'prov-sunset',
        operationId: 'op',
        operationVersion: '1.0.0',
        toState: step.toState,
        reasonClass: step.reasonClass,
        actor: 'test',
        idempotencyKey: `sunset-${step.key}`,
      });
    }

    const raised = await rules.raiseSunsetIncidents();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ providerId: 'prov-sunset', operationId: 'op' });
    expect(raised[0]?.incidentId).toBe('prov-sunset:prov-sunset:op:1.0.0');

    // Re-run: deterministic id → no duplicate incidents, still reported.
    const rerun = await rules.raiseSunsetIncidents();
    expect(rerun).toHaveLength(1);
    const rows = await engine.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM sec.security_incidents WHERE incident_id LIKE 'prov-sunset:%'",
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);

    // Future sunsets do NOT fire yet.
    await seedOperation('prov-sunset-future', 'op', {
      sunsetAt: '2027-05-31T00:00:00Z',
    });
    expect(
      (await rules.raiseSunsetIncidents()).filter((r) => r.providerId === 'prov-sunset-future'),
    ).toEqual([]);
  });

  it('gates STRICT_FREE availability on CURRENT proven plan verification', async () => {
    const { clock, moveTo } = manualClock(T0);
    const verification = new VerificationTtlService({ engine, clock });
    const rules = new DeprecationRules({ engine, clock, verification });
    await seedOperation('prov-free', 'op');

    const base = {
      providerId: 'prov-free',
      operationId: 'op',
      version: '1.0.0',
    };

    // Not eligible by operator flag.
    await seedOperation('prov-free-flagged', 'op', { allowedInStrictFree: false });
    expect(
      await rules.strictFreeAvailability({
        ...base,
        providerId: 'prov-free-flagged',
        allowedInStrictFree: false,
        costClass: 'FREE_QUOTA',
        paidFallbackAllowed: false,
      }),
    ).toMatchObject({ allowed: false, reason: 'NOT_ELIGIBLE' });

    // Eligible flag but NO plan proof → disabled metadata (fail-closed).
    const unproven = await rules.strictFreeAvailability({
      ...base,
      allowedInStrictFree: true,
      costClass: 'FREE_QUOTA',
      paidFallbackAllowed: false,
    });
    expect(unproven).toMatchObject({ allowed: false, reason: 'PLAN_UNPROVEN' });

    // Prove the plan fresh → available; lapse → disabled again.
    await verification.configureTtl('prov-free', 'PRICING_PLAN', 3600);
    await verification.record({
      ...base,
      operationVersion: base.version,
      kind: 'PRICING_PLAN',
      source: 'OFFICIAL_DOC',
      outcome: 'SUCCEEDED',
      evidenceRefs: ['pricing/free-tier'],
    });
    expect(
      await rules.strictFreeAvailability({
        ...base,
        allowedInStrictFree: true,
        costClass: 'FREE_QUOTA',
        paidFallbackAllowed: false,
      }),
    ).toMatchObject({ allowed: true, reason: 'PLAN_VERIFIED' });

    moveTo(T0 + 3601_000);
    expect(
      await rules.strictFreeAvailability({
        ...base,
        allowedInStrictFree: true,
        costClass: 'FREE_QUOTA',
        paidFallbackAllowed: false,
      }),
    ).toMatchObject({ allowed: false, reason: 'PLAN_UNPROVEN' });
  });
});
