// Shared bootstrap for the provider-lifecycle acceptance tier (AC-270…273):
// a fresh in-process PGlite with the full G0 migration set plus the complete
// wired prov stack, and fixture readers for tests/fixtures/prov/.
import { readFileSync } from 'node:fs';
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
} from '../../packages/provider-lifecycle/src/index.ts';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

export const PROV_FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/prov',
);

/** Read one sanitized fixture from tests/fixtures/prov/. */
export function readProvFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(PROV_FIXTURES_DIR, relativePath), 'utf8'));
}

export const T0 = '2026-08-01T00:00:00Z' as UtcTimestamp;

export interface ProvAcceptanceStack {
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

export async function makeProvAcceptanceStack(): Promise<ProvAcceptanceStack> {
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
  const readiness = new ReadinessEvaluator({ registry, machine, verifications, rights, exceptions });
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

export async function closeProvAcceptanceStack(stack: ProvAcceptanceStack): Promise<void> {
  await stack.db.close();
}

const REF_BASE = {
  providerId: 'prov-ac',
  operationId: 'get-token-price',
  version: '1.0.0',
} as const;

export function acOperationInput(
  overrides: Omit<Partial<ProviderOperationDefinitionInput>, 'ref'> & {
    ref?: Partial<{ providerId: string; operationId: string; version: string }>;
  } = {},
): ProviderOperationDefinitionInput {
  return {
    ref: { ...REF_BASE, ...overrides.ref },
    displayName: 'AC reference operation',
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_QUOTA',
    supportedChains: ['solana'],
    inputSchemaId: 'schema://ac/input/token-price@1',
    rawOutputSchemaId: 'schema://ac/raw/token-price@1',
    normalizedOutputSchemaId: 'schema://ac/normalized/token-price@1',
    quotaModelId: 'quota://requests-per-minute',
    cachePolicyId: 'cache://short-ttl',
    timeoutMs: 10_000,
    retryPolicyId: 'retry://standard',
    declaredIndependenceGroup: 'price-feed-group-a',
    upstreamLineage: [],
    licensePolicyId: 'license://ac-terms-2026-08',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'quota-reset://monthly',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: '2026-09-30T00:00:00Z' as UtcTimestamp,
    forbiddenOutputFields: [],
    ...((): Omit<Partial<ProviderOperationDefinitionInput>, 'ref'> => {
      const { ref: _ref, ...rest } = overrides;
      void _ref;
      return rest as Omit<Partial<ProviderOperationDefinitionInput>, 'ref'>;
    })(),
  };
}

export async function seedAcOperation(
  stack: ProvAcceptanceStack,
  overrides: Omit<Partial<ProviderOperationDefinitionInput>, 'ref'> & {
    ref?: Partial<{ providerId: string; operationId: string; version: string }>;
  } = {},
) {
  const input = acOperationInput(overrides);
  await stack.registry.registerProvider({
    providerId: input.ref.providerId,
    displayName: 'AC reference provider',
    providerGroup: 'acceptance-group',
  });
  return stack.registry.registerOperation(input);
}

/** The eight decision-critical verification kinds (LIVE_PROBE excluded). */
export const DECISION_CRITICAL_KINDS = [
  'DOCUMENTATION',
  'PRICING_PLAN',
  'QUOTA',
  'RIGHTS',
  'SCHEMA',
  'ENDPOINT',
  'AUTHENTICATION',
  'DEPRECATION',
] as const;

export function atOffset(minutes: number): UtcTimestamp {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString() as UtcTimestamp;
}

export function configureAllCriticalTtls(
  stack: ProvAcceptanceStack,
  ttlSeconds: number,
): Promise<unknown> {
  return Promise.all(
    DECISION_CRITICAL_KINDS.map((kind) =>
      stack.verifications.configureTtl({
        configId: `ac-ttl-${kind}`,
        providerId: '*',
        kind,
        ttlSeconds,
      }),
    ),
  );
}

/** Record a full OFFICIAL_DOC + LIVE_CONTRACT PASS pair per critical kind. */
export async function recordFullPairs(
  stack: ProvAcceptanceStack,
  ref: { readonly providerId: string; readonly operationId: string; readonly version: string },
  verifiedAt: UtcTimestamp,
): Promise<void> {
  for (const kind of DECISION_CRITICAL_KINDS) {
    for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
      await stack.verifications.recordVerification({
        ref,
        kind,
        source,
        outcome: 'PASS',
        verifiedAt,
        evidenceRefs: [`${source.toLowerCase()}:${kind}`],
        recordedBy: 'acceptance',
        idempotencyKey: `ac:${ref.operationId}:${kind}:${source}:${verifiedAt}`,
      });
    }
  }
}
