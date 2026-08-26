/**
 * Shared fixtures for the provider-lifecycle suites: a fully-migrated PGlite
 * engine (all data/dr/sec/prov families — one migration truth) plus the wired
 * engine graph (registry → machine → TTL/deprecation/exceptions) over an
 * injected fixed clock.
 */
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { fixedClock, type ClockPort, type UtcTimestamp } from '@foresift/domain';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OperationDefinition } from '../src/operation-registry.ts';
import { OperationRegistry } from '../src/operation-registry.ts';
import type { OperationTarget } from '../src/lifecycle-machine.ts';
import { LifecycleMachine } from '../src/lifecycle-machine.ts';
import { VerificationTtlEngine } from '../src/verification-ttl.ts';
import { MigrationExceptions } from '../src/migration-exceptions.ts';
import { DeprecationRules } from '../src/deprecation-rules.ts';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

export async function makeProvEngine(): Promise<{ db: PGlite; engine: DatabaseEngine }> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine };
}

/** Brand a plain ISO string for the ClockPort surface in tests. */
export function ts(value: string): UtcTimestamp {
  return value as UtcTimestamp;
}

export const DEFAULT_NOW = '2026-08-26T12:00:00Z';

/** A valid §15.3 definition; overrides merge shallowly. */
export function testDefinition(
  overrides: Partial<OperationDefinition> = {},
): OperationDefinition {
  return {
    providerId: 'prov-test',
    operationId: 'op-test',
    version: 'v1',
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_UNMETERED',
    supportedChains: ['solana'],
    supportedPrograms: [],
    inputSchemaId: 'in-schema@1',
    rawOutputSchemaId: 'raw-schema@1',
    normalizedOutputSchemaId: 'norm-schema@1',
    quotaModelId: 'qm@1',
    cachePolicyId: 'cp@1',
    timeoutMs: 1000,
    retryPolicyId: 'rp@1',
    declaredIndependenceGroup: 'group-1',
    upstreamLineage: [],
    licensePolicyId: 'lic@1',
    estimatedQuotaUnits: 0,
    quotaResetPolicyId: 'qrp@1',
    batchCapability: null,
    minimumCandidateStage: null,
    protectedReserveEligible: false,
    allowedInStrictFree: false,
    paidFallbackAllowed: false,
    deprecatedAt: null,
    sunsetAt: null,
    replacementOperationId: null,
    // Honest-by-default: unverified registrations carry an elapsed window.
    verificationExpiresAt: '2020-01-01T00:00:00Z' as UtcTimestamp,
    forbiddenOutputFields: [],
    negativeCapabilities: [],
    ...overrides,
  };
}

export interface Wired {
  readonly engine: DatabaseEngine;
  readonly clock: ClockPort;
  readonly registry: OperationRegistry;
  readonly machine: LifecycleMachine;
  readonly ttl: VerificationTtlEngine;
  readonly exceptions: MigrationExceptions;
  readonly rules: DeprecationRules;
}

export function wireEngine(engine: DatabaseEngine, clock?: ClockPort): Wired {
  const resolvedClock = clock ?? fixedClock(ts(DEFAULT_NOW));
  // The rule-1 gate is late-bound: DeprecationRules needs the registry, and
  // the registry's dependency fence needs the rules — the delegate below
  // resolves after construction closes the cycle.
  let dependencyGate: ((target: OperationTarget) => Promise<void>) | undefined;
  const registry = new OperationRegistry(engine, resolvedClock, {
    dependencyGate: async (target) => {
      const gate = dependencyGate;
      if (gate !== undefined) await gate(target);
    },
  });
  const machine = new LifecycleMachine({ engine, clock: resolvedClock });
  const ttl = new VerificationTtlEngine({ engine, clock: resolvedClock, machine });
  const exceptions = new MigrationExceptions(engine, resolvedClock);
  const rules = new DeprecationRules({
    engine,
    clock: resolvedClock,
    machine,
    registry,
    exceptions,
    ttl,
  });
  dependencyGate = (target) => rules.assertDependencyRegistrationAllowed(target);
  return {
    engine,
    clock: resolvedClock,
    registry,
    machine,
    ttl,
    exceptions,
    rules,
  };
}
