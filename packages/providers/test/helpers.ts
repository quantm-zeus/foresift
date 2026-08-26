/**
 * Shared bootstrap for @foresift/providers tests: a fresh in-process PGlite
 * database with the full G0 migration set applied plus a lifecycle
 * OperationRegistry to register adapters against (deterministic TEST engine
 * per ADR-0014; no network anywhere — transports are stubs).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { UtcTimestamp } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { OperationRegistry } from '@foresift/provider-lifecycle';
import type {
  AdapterAllowlistEntry,
  OperationWireDescriptor,
  ProviderAdapterDescriptor,
} from '../src/index.ts';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

export const VERIFICATION_HORIZON = '2026-09-30T00:00:00Z' as UtcTimestamp;

export interface RegistryStack {
  readonly db: PGlite;
  readonly engine: DatabaseEngine;
  readonly registry: OperationRegistry;
}

export async function makeRegistryStack(): Promise<RegistryStack> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine, registry: new OperationRegistry(engine) };
}

export async function closeRegistryStack(stack: RegistryStack): Promise<void> {
  await stack.db.close();
}

const HOSTS: readonly AdapterAllowlistEntry[] = [{ host: 'provider.example', port: 443 }];

/** A minimal valid one-operation descriptor; tests override to provoke refusals. */
export function minimalDescriptor(
  overrides: Partial<ProviderAdapterDescriptor> & {
    operation?: Partial<OperationWireDescriptor>;
  } = {},
): ProviderAdapterDescriptor {
  const baseOperation: OperationWireDescriptor = {
    operationId: 'get-sample-price',
    version: '1.0.0',
    displayName: 'Get sample price',
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_QUOTA',
    pathTemplate: '/v1/price',
    declaredQueryParams: ['chain'],
    expectedContentTypes: ['application/json'],
    maxResponseBytes: 65_536,
    allowlistEntries: HOSTS,
    supportedChains: ['solana'],
    inputSchemaId: 'schema://sample/input@1',
    rawOutputSchemaId: 'schema://sample/raw@1',
    normalizedOutputSchemaId: 'schema://sample/normalized@1',
    quotaModelId: 'quota://requests-per-minute',
    cachePolicyId: 'cache://short-ttl',
    timeoutMs: 10_000,
    retryPolicyId: 'retry://standard',
    declaredIndependenceGroup: 'sample-group',
    upstreamLineage: [],
    licensePolicyId: 'license://sample-terms',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'quota-reset://monthly',
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    verificationExpiresAt: VERIFICATION_HORIZON,
    ...overrides.operation,
  };
  const { operation: _operation, ...descriptorOverrides } = overrides;
  void _operation;
  return {
    providerId: 'prov-sample',
    displayName: 'Sample provider',
    providerGroup: 'test-group',
    baseUrl: 'https://provider.example',
    operations: [baseOperation],
    ...descriptorOverrides,
  };
}
