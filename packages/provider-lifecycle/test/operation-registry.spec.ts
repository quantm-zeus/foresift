/**
 * Operation-registry unit suite (FR-PROV-001, FR-PROV-004; §15.3/§15.4):
 * versioned definition storage, registration-time refusal of prohibited
 * capability classes, dependency blast-radius registration, and the atomic
 * genesis event (NULL→DISCOVERED) under a deterministic retry fence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { fixedClock, utcTimestamp } from '@foresift/domain';
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
  OperationRegistry,
  ProviderAuditBridge,
  ProvErrorCode,
  isForesiftProviderError,
  type OperationDefinition,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const CLOCK = fixedClock(utcTimestamp('2026-06-01T12:00:00Z'));

function validDefinition(overrides?: Partial<OperationDefinition>): OperationDefinition {
  return {
    providerId: 'prov-a',
    operationId: 'get-account',
    version: '1.0.0',
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
    negativeCapabilities: ['no-trading', 'no-signing'],
    ...overrides,
  };
}

let db: PGlite;
let engine: DatabaseEngine;
let registry: OperationRegistry;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  registry = new OperationRegistry({ engine, clock: CLOCK });
});

afterAll(async () => {
  await db.close();
});

describe('operation registration (§15.3)', () => {
  it('registers a provider and operation with an atomic genesis event', async () => {
    await registry.registerProvider({
      providerId: 'prov-a',
      providerGroup: 'market-data',
      displayName: 'Provider A',
    });

    const { definition, genesisEvent } = await registry.registerOperation(validDefinition());
    expect(definition.capabilityClass).toBe('READ_ACCOUNT_STATE');
    expect(genesisEvent.fromState).toBeNull();
    expect(genesisEvent.toState).toBe('DISCOVERED');
    expect(genesisEvent.reasonClass).toBe('REGISTERED_DISCOVERED');
    expect(genesisEvent.idempotencyKey).toBe('prov-register:prov-a:get-account:1.0.0');

    const projection = await engine.query<{ current_state: string; health_status: string }>(
      'SELECT current_state, health_status FROM prov.prov_operations WHERE provider_id = $1',
      ['prov-a'],
    );
    expect(projection.rows[0]).toMatchObject({ current_state: 'DISCOVERED', health_status: 'HEALTHY' });
  });

  it('round-trips every §15.3 field through read-back', async () => {
    const readBack = await registry.getDefinition('prov-a', 'get-account', '1.0.0');
    expect(readBack).toEqual(validDefinition());
  });

  it('refuses PROHIBITED_* capability classes outright (§41.1)', async () => {
    for (const prohibited of [
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ]) {
      try {
        await registry.registerOperation(
          validDefinition({
            operationId: `bad-${prohibited}`,
            capabilityClass: prohibited as OperationDefinition['capabilityClass'],
          }),
        );
        throw new Error(`expected refusal for ${prohibited}`);
      } catch (error) {
        expect(isForesiftProviderError(error)).toBe(true);
        expect((error as { code: string }).code).toBe(ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED);
      }
    }
    // Nothing leaked to storage.
    const rows = await engine.query<Record<string, never>>(
      "SELECT * FROM prov.prov_operations WHERE capability_class LIKE 'PROHIBITED_%'",
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('refuses structurally invalid definitions before any row exists', async () => {
    const missing = validDefinition() as Record<string, unknown>;
    delete missing.quotaModelId;
    await expect(registry.registerOperation(missing)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEFINITION_INVALID,
    });
    const extra = { ...validDefinition(), surpriseField: true };
    await expect(registry.registerOperation(extra)).rejects.toMatchObject({
      code: ProvErrorCode.PROV_DEFINITION_INVALID,
    });
    const rows = await engine.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM prov.prov_operations',
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it('refuses operations whose provider was never registered', async () => {
    await expect(
      registry.registerOperation(validDefinition({ providerId: 'ghost' })),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_PROVIDER_UNKNOWN });
  });

  it('refuses re-registering a live version instead of overwriting it', async () => {
    await expect(registry.registerOperation(validDefinition())).rejects.toMatchObject({
      code: ProvErrorCode.PROV_OPERATION_VERSION_CONFLICT,
    });
  });
});

describe('dependency registration (§15.4 affected features)', () => {
  it('registers a critical-feature dependency and lists it back', async () => {
    const record = await registry.registerDependency({
      consumerKind: 'FEATURE',
      consumerKey: 'feature/portfolio-view',
      providerId: 'prov-a',
      operationId: 'get-account',
      criticalField: 'balances',
    });
    expect(record.active).toBe(true);
    expect(record.criticalField).toBe('balances');

    const listed = await registry.listDependencies('prov-a', 'get-account');
    expect(listed.map((d) => d.consumerKey)).toEqual(['feature/portfolio-view']);
  });

  it('refuses duplicate dependencies and unknown target operations', async () => {
    await expect(
      registry.registerDependency({
        consumerKind: 'FEATURE',
        consumerKey: 'feature/portfolio-view',
        providerId: 'prov-a',
        operationId: 'get-account',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_DEPENDENCY_REGISTRATION_INVALID });

    await expect(
      registry.registerDependency({
        consumerKind: 'TOOL',
        consumerKey: 'tool/scanner',
        providerId: 'prov-a',
        operationId: 'unregistered-op',
      }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_OPERATION_UNKNOWN });
  });
});

describe('cross-domain audit attestations (material decision 9)', () => {
  it('attests CAPABILITY_CHANGE when a new version shifts capability class', async () => {
    const chain = new AuditChain({ engine });
    const bridged = new OperationRegistry({
      engine,
      clock: fixedClock(utcTimestamp('2026-06-02T12:00:00Z')),
      audit: new ProviderAuditBridge({ chain }),
    });

    await bridged.registerOperation(
      validDefinition({ version: '2.0.0', capabilityClass: 'READ_MARKET' }),
    );

    const verify = await chain.verifyRange();
    expect(verify.run.verdict).toBe('OK');
    const entries = await engine.query<{ action_class: string; payload_canonical: string }>(
      "SELECT action_class, payload_canonical FROM sec.sec_audit_events WHERE action_class = 'CAPABILITY_CHANGE'",
    );
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0]?.payload_canonical).toContain('READ_ACCOUNT_STATE');
    expect(entries.rows[0]?.payload_canonical).toContain('READ_MARKET');
  });
});
