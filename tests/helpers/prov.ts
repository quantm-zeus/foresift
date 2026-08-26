/**
 * Shared prov-specific test helpers for the T126–T129 acceptance/negative
 * suites (AC-270…AC-273): mutable injected clocks, the wired lifecycle
 * engine graph over a fully-migrated PGlite database, the §15.3 definition
 * builder, verification-pair recorders, rights builders, and typed loaders
 * for the inert fixture corpus under `tests/fixtures/prov/`.
 *
 * Kept beside the already-declared tests/acceptance/, tests/negative/, and
 * tests/fixtures/prov/ surfaces so every suite shares ONE injected-clock
 * engine and ONE fixture-loading path (recorded provider scope exception,
 * automation #64).
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { utcTimestamp, type ClockPort } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  DeprecationRules,
  LifecycleMachine,
  MigrationExceptions,
  OperationRegistry,
  REQUIRED_NEGATIVE_CAPABILITIES,
  VerificationTtlEngine,
} from '@foresift/provider-lifecycle';
import type {
  OperationDefinition,
  OperationTarget,
  ProviderVerificationKind,
  RightsDeclaration,
} from '@foresift/provider-lifecycle';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

export const PROV_FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/prov',
);

/** Load one JSON document from the inert prov fixture corpus. */
export function loadProvFixture<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(path.join(PROV_FIXTURES_DIR, ...segments), 'utf8')) as T;
}

/**
 * One inert forbidden-corpus sample (malicious-response class fixture).
 * Declarative data only — every hazard value is a FAKE marker by
 * construction; see tests/fixtures/prov/README.md.
 */
export interface ForbiddenFixture {
  fixtureClass: string;
  detectedClass: string;
  comment?: string;
  body: Record<string, unknown>;
}

/**
 * Load the whole forbidden corpus (`tests/fixtures/prov/forbidden/`) sorted
 * by filename, each sample serialized exactly as an adapter response body.
 */
export function loadForbiddenFixtureCorpus(): {
  file: string;
  fixture: ForbiddenFixture;
  bodyText: string;
}[] {
  const dir = path.join(PROV_FIXTURES_DIR, 'forbidden');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as ForbiddenFixture;
      return { file, fixture, bodyText: JSON.stringify(fixture.body) };
    });
}

// --- Injected clocks ---------------------------------------------------

/**
 * A clock the suite can MOVE between assertions (`setNow`) — expiry, lapse,
 * and grace-window behavior are proven against real window arithmetic, never
 * by mocking the engines' comparison logic.
 */
export interface MutableClock {
  readonly clock: ClockPort;
  setNow(iso: string): void;
}

export function makeMutableClock(initialIso: string): MutableClock {
  const state = { iso: initialIso };
  return {
    clock: {
      now: () => utcTimestamp(state.iso),
      nowEpochMs: () => Date.parse(state.iso),
    },
    setNow(iso: string): void {
      state.iso = iso;
    },
  };
}

export function makeFixedClock(iso: string): ClockPort {
  return {
    now: () => utcTimestamp(iso),
    nowEpochMs: () => Date.parse(iso),
  };
}

// --- Database + engine graph -------------------------------------------

export interface ProvTestDatabase {
  readonly db: PGlite;
  readonly engine: DatabaseEngine;
}

/** Fresh database with ALL G0 migration families applied (data/dr/sec/prov). */
export async function makeProvTestDatabase(): Promise<ProvTestDatabase> {
  const db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  const engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  return { db, engine };
}

export async function closeProvTestDatabase(tdb: ProvTestDatabase): Promise<void> {
  await tdb.db.close();
}

export interface WiredProvLifecycle {
  readonly registry: OperationRegistry;
  readonly machine: LifecycleMachine;
  readonly ttl: VerificationTtlEngine;
  readonly exceptions: MigrationExceptions;
  readonly rules: DeprecationRules;
}

/**
 * Wire the full lifecycle engine graph over `engine` at `clock`. The rule-1
 * gate is late-bound exactly like the package-level suites: DeprecationRules
 * needs the registry and the registry's dependency fence needs the rules.
 */
export function wireProvLifecycle(engine: DatabaseEngine, clock: ClockPort): WiredProvLifecycle {
  // Late-bound through a holder: DeprecationRules needs the registry and the
  // registry's dependency fence needs the rules, so the gate resolves only
  // after construction closes the cycle.
  const lateGate: { current?: (target: OperationTarget) => Promise<void> } = {};
  const registry = new OperationRegistry(engine, clock, {
    dependencyGate: async (target) => {
      const gate = lateGate.current;
      if (gate !== undefined) await gate(target);
    },
  });
  const machine = new LifecycleMachine({ engine, clock });
  const ttl = new VerificationTtlEngine({ engine, clock, machine });
  const exceptions = new MigrationExceptions(engine, clock);
  const rules = new DeprecationRules({
    engine,
    clock,
    machine,
    registry,
    exceptions,
    ttl,
  });
  lateGate.current = (target) => rules.assertDependencyRegistrationAllowed(target);
  return { registry, machine, ttl, exceptions, rules };
}

// --- Builders -----------------------------------------------------------

/**
 * A valid §15.3 operation definition; overrides merge shallowly. Honest by
 * default: the registration carries an already-elapsed verification window
 * and the full required negative-capability metadata.
 */
export function provOperationDefinition(
  target: OperationTarget,
  overrides: Partial<OperationDefinition> = {},
): OperationDefinition {
  return {
    providerId: target.providerId,
    operationId: target.operationId,
    version: target.version,
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_UNMETERED',
    supportedChains: ['solana'],
    supportedPrograms: [],
    inputSchemaId: 'in@1',
    rawOutputSchemaId: 'raw@1',
    normalizedOutputSchemaId: 'norm@1',
    quotaModelId: 'qm@1',
    cachePolicyId: 'cp@1',
    timeoutMs: 1000,
    retryPolicyId: 'rp@1',
    declaredIndependenceGroup: `group-${target.operationId}`,
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
    verificationExpiresAt: utcTimestamp('2020-01-01T00:00:00Z'),
    forbiddenOutputFields: [],
    negativeCapabilities: [...REQUIRED_NEGATIVE_CAPABILITIES],
    ...overrides,
  };
}

/** A maximally-open sixteen-field rights declaration; overrides merge shallowly. */
export function openRightsDeclaration(
  overrides: Partial<RightsDeclaration> = {},
): RightsDeclaration {
  return {
    commercialUseAllowed: true,
    personalResearchAllowed: true,
    cacheAllowed: true,
    maximumCacheDurationSeconds: 86_400,
    rawRetentionAllowed: true,
    derivedFeaturesAllowed: true,
    modelTrainingAllowed: true,
    redistributionAllowed: true,
    publicAlertDerivativeAllowed: true,
    attributionRequired: false,
    userByokRequired: false,
    rawExportAllowed: true,
    jurisdictionRestrictions: [],
    termsVersion: 'terms@prov-test-v1',
    verifiedAt: utcTimestamp('2026-08-01T00:00:00Z'),
    verificationExpiresAt: utcTimestamp('2027-08-01T00:00:00Z'),
    ...overrides,
  };
}

// --- Verification recording ---------------------------------------------

export interface VerificationWindow {
  /** Defaults to the clock's current instant. */
  verifiedAt?: string;
  /** Defaults to `verifiedAt + ttlSeconds` — strictly future at ANY instant. */
  expiresAt?: string;
}

const DEFAULT_PAIR_WINDOW_SECONDS = 3_600;

/** Record ONE verification source outcome (negative suites split pairs apart). */
export async function recordVerification(
  ttl: VerificationTtlEngine,
  args: {
    target: OperationTarget;
    kind: ProviderVerificationKind;
    source: 'OFFICIAL_DOC' | 'LIVE_CONTRACT';
    outcome?: 'PASSED';
    clock: ClockPort;
    /** Window length when `window.expiresAt` is not pinned. */
    ttlSeconds?: number;
    window?: VerificationWindow;
  },
): Promise<void> {
  const ttlSeconds = args.ttlSeconds ?? DEFAULT_PAIR_WINDOW_SECONDS;
  const verifiedAt = utcTimestamp(args.window?.verifiedAt ?? isoOf(args.clock));
  const expiresAt = utcTimestamp(
    args.window?.expiresAt ?? new Date(args.clock.nowEpochMs() + ttlSeconds * 1000).toISOString(),
  );
  await ttl.recordVerification({
    target: args.target,
    kind: args.kind,
    source: args.source,
    outcome: args.outcome ?? 'PASSED',
    verifiedAt,
    expiresAt,
    evidenceRefs: [`evidence:${args.kind}:${args.source}`],
  });
}

/**
 * Record the AC-270 refresh pair: BOTH an OFFICIAL_DOC and a LIVE_CONTRACT
 * verification of `kind`. Active decision use resumes only after the pair.
 */
export async function recordVerificationPair(
  ttl: VerificationTtlEngine,
  args: {
    target: OperationTarget;
    kind: ProviderVerificationKind;
    clock: ClockPort;
    ttlSeconds?: number;
    window?: VerificationWindow;
  },
): Promise<void> {
  for (const source of ['OFFICIAL_DOC', 'LIVE_CONTRACT'] as const) {
    await recordVerification(ttl, { ...args, source });
  }
}

function isoOf(clock: ClockPort): string {
  return new Date(clock.nowEpochMs()).toISOString();
}
