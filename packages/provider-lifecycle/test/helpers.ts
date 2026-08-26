/**
 * Shared bootstrap for @foresift/provider-lifecycle tests: a fresh in-process
 * PGlite database with the full G0 migration set applied (the deterministic
 * TEST engine per ADR-0014) plus a fully wired provider-lifecycle stack.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { fixedClock, type ClockPort, type UtcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { AuditChain, Incidents } from '@foresift/security';
import {
  ArtifactRegistry,
  DeprecationRules,
  LifecycleAuditBridge,
  LifecycleMachine,
  MigrationExceptions,
  OperationRegistry,
  ReadinessEvaluator,
  ResponseQuarantine,
  RightsMatrix,
  SourceFingerprints,
  VerificationTtlEngine,
  type ProviderOperationDefinitionInput,
} from '../src/index.ts';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

export const T0 = '2026-08-01T00:00:00Z' as UtcTimestamp;

export interface ProvTestStack {
  readonly db: PGlite;
  readonly engine: DatabaseEngine;
  readonly clock: ClockPort;
  readonly bridge: LifecycleAuditBridge;
  readonly registry: OperationRegistry;
  readonly machine: LifecycleMachine;
  readonly verifications: VerificationTtlEngine;
  readonly exceptions: MigrationExceptions;
  readonly deprecation: DeprecationRules;
  readonly quarantine: ResponseQuarantine;
  readonly rights: RightsMatrix;
  readonly artifacts: ArtifactRegistry;
  readonly fingerprints: SourceFingerprints;
  readonly readiness: ReadinessEvaluator;
}

/** Fresh database with every g0_* migration applied, plus the wired stack. */
export async function makeProvStack(): Promise<ProvTestStack> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });

  const chain = new AuditChain({ engine });
  const bridge = new LifecycleAuditBridge(chain);
  const incidents = new Incidents(engine);
  const registry = new OperationRegistry(engine);
  const machine = new LifecycleMachine(engine, bridge);
  const verifications = new VerificationTtlEngine(engine, machine);
  const exceptions = new MigrationExceptions(engine);
  const deprecation = new DeprecationRules(registry, exceptions, incidents);
  const artifacts = new ArtifactRegistry(engine);
  const rights = new RightsMatrix(engine, artifacts, bridge);
  const quarantine = new ResponseQuarantine(engine, bridge);
  const fingerprints = new SourceFingerprints(engine);
  const readiness = new ReadinessEvaluator({
    registry,
    machine,
    verifications,
    rights,
    exceptions,
  });
  return {
    db,
    engine,
    clock: fixedClock(T0),
    bridge,
    registry,
    machine,
    verifications,
    exceptions,
    deprecation,
    quarantine,
    rights,
    artifacts,
    fingerprints,
    readiness,
  };
}

export async function closeProvStack(stack: ProvTestStack): Promise<void> {
  await stack.db.close();
}

const REF_BASE = {
  providerId: 'prov-test',
  operationId: 'get-token-price',
  version: '1.0.0',
} as const;

/** A complete, valid §15.3 definition input; callers override fields. */
export function defaultOperationInput(
  overrides: Omit<Partial<ProviderOperationDefinitionInput>, 'ref'> & {
    ref?: Partial<{ providerId: string; operationId: string; version: string }>;
  } = {},
): ProviderOperationDefinitionInput {
  return {
    ref: { ...REF_BASE, ...overrides.ref },
    displayName: 'Get token price',
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_QUOTA',
    supportedChains: ['solana'],
    inputSchemaId: 'schema://input/token-price@1',
    rawOutputSchemaId: 'schema://raw/token-price@1',
    normalizedOutputSchemaId: 'schema://normalized/token-price@1',
    quotaModelId: 'quota://requests-per-minute',
    cachePolicyId: 'cache://short-ttl',
    timeoutMs: 10_000,
    retryPolicyId: 'retry://standard',
    declaredIndependenceGroup: 'price-feed-group-a',
    upstreamLineage: ['upstream:coinmarketcap'],
    licensePolicyId: 'license://terms-2026-01',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'quota-reset://monthly',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: '2026-08-02T00:00:00Z' as UtcTimestamp,
    forbiddenOutputFields: [],
    ...overridesWithoutRef(overrides),
  };
}

function overridesWithoutRef(
  overrides: Record<string, unknown>,
): Omit<Partial<ProviderOperationDefinitionInput>, 'ref'> {
  const { ref: _ref, ...rest } = overrides;
  void _ref;
  return rest as Omit<Partial<ProviderOperationDefinitionInput>, 'ref'>;
}

/** Register the default provider + one operation. */
export async function seedOperation(
  stack: ProvTestStack,
  overrides: Omit<Partial<ProviderOperationDefinitionInput>, 'ref'> & {
    ref?: Partial<{ providerId: string; operationId: string; version: string }>;
  } = {},
) {
  const input = defaultOperationInput(overrides);
  await stack.registry.registerProvider({
    providerId: input.ref.providerId,
    displayName: 'Test provider',
    providerGroup: 'test-group',
  });
  return stack.registry.registerOperation(input);
}
