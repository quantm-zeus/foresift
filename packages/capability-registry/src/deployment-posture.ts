/**
 * Declared deployment posture: SLA-backed vs free-tier best-effort (T020,
 * FR-PROD-004, AC-153; PRD §69.6/§34.3; plan D4).
 *
 * The posture is SLA_BACKED only when EVERY critical external dependency in
 * `prod.critical_dependencies` carries an applicable, unexpired SLA in
 * `prod.sla_register`; otherwise the posture is FREE_TIER_BEST_EFFORT with an
 * explicit degraded scope and reason. There is no third, silently optimistic
 * posture.
 *
 * `assertBestEffortPreservesProtectedDimensions` refuses any declaration that
 * weakens identity, point-in-time, audit, duplicate prevention, security,
 * execution semantics, capacity enforcement, critical risk monitoring, or
 * claim boundaries — at the law level (the SQL CHECK is the second fence). A
 * capacity/quota failure may relax breadth, depth, freshness, and opportunity
 * availability ONLY: the degradation step itself is consumed from
 * `@foresift/capacity-planner`'s `broadScanDegradeStrategy`, never
 * re-implemented here, so capacity pressure can never authorize paid fallback
 * or stale overclaim.
 *
 * Strictly read-only: posture governs what read-only intelligence may promise;
 * it never trades, custodies, signs, or submits.
 */
import {
  ALL_PROTECTED_DIMENSIONS,
  DeploymentPosture,
  ErrorCode,
  ForesiftError,
  bestEffortWeakensOnlyAllowedDimensions,
  isContractActivatable,
  isOneOf,
  parseDeploymentPosture,
  parseDeploymentRelaxableDimension,
  parseProtectedDimension,
  validateSustainableCapacityContract,
  type DeploymentRelaxableDimension,
  type ProtectedDimension,
  type SustainableCapacityContract,
} from '@foresift/domain';
import {
  broadScanDegradeStrategy,
  type DegradeStep,
  type DegradeState,
} from '@foresift/capacity-planner';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import { numericCopy, numericUnique } from './shadow-safe.ts';

// --- critical-dependency register -------------------------------------------

/** §69.6 critical-external-dependency kinds (mirrors the SQL CHECK). */
export const CriticalDependencyKind = {
  PROVIDER: 'PROVIDER',
  SCHEDULER: 'SCHEDULER',
  OBJECT_STORE: 'OBJECT_STORE',
  DATABASE: 'DATABASE',
  MCP_CLIENT: 'MCP_CLIENT',
  OTHER: 'OTHER',
} as const;
export type CriticalDependencyKind =
  (typeof CriticalDependencyKind)[keyof typeof CriticalDependencyKind];
export const ALL_CRITICAL_DEPENDENCY_KINDS: readonly CriticalDependencyKind[] = Object.freeze(
  Object.values(CriticalDependencyKind),
);

function parseCriticalDependencyKind(value: unknown): CriticalDependencyKind {
  // `isOneOf` is a numeric-index walk, never a shadowable `.includes`.
  if (typeof value === 'string' && isOneOf(value, ALL_CRITICAL_DEPENDENCY_KINDS)) {
    return value;
  }
  throw new ForesiftError(
    ErrorCode.PROD_DEPLOYMENT_POSTURE_UNKNOWN,
    'unknown critical dependency kind',
    { value: typeof value === 'string' ? value : null },
  );
}

/** One persisted critical external dependency. */
export interface CriticalDependencyRow {
  readonly dependencyId: string;
  readonly kind: CriticalDependencyKind;
  readonly owner: string;
  readonly critical: boolean;
}

/** One persisted SLA register row. */
export interface SlaRegisterRow {
  readonly slaId: string;
  readonly dependencyId: string;
  readonly applicable: boolean;
  readonly slaRef: string | null;
  readonly verifiedAt: string;
  readonly expiresAt: string | null;
}

function requireText(value: unknown, field: string, code: ErrorCode): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ForesiftError(code, `${field} must be a non-empty string`, { field });
  }
  return value;
}

/** Register (or replace the metadata of) a critical external dependency. */
export async function registerCriticalDependency(
  engine: DatabaseEngine,
  input: {
    readonly dependencyId: string;
    readonly kind: unknown;
    readonly owner: string;
    readonly critical?: boolean;
  },
): Promise<CriticalDependencyRow> {
  const dependencyId = requireText(
    input.dependencyId,
    'dependencyId',
    ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
  );
  const kind = parseCriticalDependencyKind(input.kind);
  const owner = requireText(input.owner, 'owner', ErrorCode.PROD_ACTIVATION_SCOPE_INVALID);
  const critical = input.critical ?? true;
  await engine.query(
    `INSERT INTO prod.critical_dependencies (dependency_id, kind, owner, critical)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dependency_id) DO UPDATE
       SET kind = EXCLUDED.kind, owner = EXCLUDED.owner, critical = EXCLUDED.critical`,
    [dependencyId, kind, owner, critical],
  );
  return { dependencyId, kind, owner, critical };
}

/** Record an SLA row. `applicable` and `slaRef` must agree (SQL CHECK mirror). */
export async function recordSla(
  engine: DatabaseEngine,
  input: {
    readonly slaId: string;
    readonly dependencyId: string;
    readonly applicable: boolean;
    readonly slaRef: string | null;
    readonly verifiedAt: string;
    readonly expiresAt: string | null;
  },
): Promise<SlaRegisterRow> {
  const slaId = requireText(input.slaId, 'slaId', ErrorCode.PROD_ACTIVATION_SCOPE_INVALID);
  const dependencyId = requireText(
    input.dependencyId,
    'dependencyId',
    ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
  );
  if (typeof input.applicable !== 'boolean') {
    throw new ForesiftError(
      ErrorCode.PROD_DEPLOYMENT_POSTURE_UNKNOWN,
      'SLA applicability must be a boolean',
      { slaId },
    );
  }
  if (
    input.applicable !==
    (input.slaRef !== null && input.slaRef !== undefined && input.slaRef !== '')
  ) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPLOYMENT_POSTURE_UNKNOWN,
      'an applicable SLA must name its reference and a non-applicable one must not',
      { slaId, dependencyId },
    );
  }
  if (input.expiresAt !== null && Date.parse(input.expiresAt) <= Date.parse(input.verifiedAt)) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPLOYMENT_POSTURE_UNKNOWN,
      'an SLA must expire after it was verified',
      { slaId, verifiedAt: input.verifiedAt, expiresAt: input.expiresAt },
    );
  }
  await engine.query(
    `INSERT INTO prod.sla_register
       (sla_id, dependency_id, applicable, sla_ref, verified_at, expires_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
     ON CONFLICT (sla_id) DO NOTHING`,
    [slaId, dependencyId, input.applicable, input.slaRef, input.verifiedAt, input.expiresAt],
  );
  return {
    slaId,
    dependencyId,
    applicable: input.applicable,
    slaRef: input.slaRef,
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
  };
}

// --- posture evaluation -----------------------------------------------------

/** The declared posture evaluation for a deployment instant. */
export interface PostureEvaluation {
  readonly posture: DeploymentPosture;
  readonly criticalDependencyIds: readonly string[];
  readonly missingSlaRefs: readonly string[];
  readonly degradedScope: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly protectedDimensions: readonly ProtectedDimension[];
  readonly relaxedDimensions: readonly DeploymentRelaxableDimension[];
}

interface RawCriticalDependencyRow {
  dependency_id: string;
  kind: string;
  owner: string;
  critical: boolean;
}

interface RawSlaRow {
  sla_id: string;
  dependency_id: string;
  applicable: boolean;
  sla_ref: string | null;
  verified_at: unknown;
  expires_at: unknown;
}

/**
 * Evaluate the declared posture at `now`. SLA_BACKED requires an APPLICABLE,
 * verified, UNEXPIRED SLA for every critical dependency; anything else is
 * FREE_TIER_BEST_EFFORT with the missing SLA references named as the degraded
 * scope.
 */
export async function evaluateDeploymentPosture(
  engine: DatabaseEngine,
  input: {
    readonly now: string;
    /**
     * The sustainable-capacity contract the deployment rests on (audit H8). An
     * SLA_BACKED posture is REFUSED without one: an empty critical register is
     * not evidence of coverage, and an unbacked SLA claim is a false guarantee.
     */
    readonly capacityContract?: SustainableCapacityContract | null;
  },
): Promise<PostureEvaluation> {
  const nowMs = Date.parse(input.now);
  const dependencies = await engine.query<RawCriticalDependencyRow>(
    `SELECT dependency_id, kind, owner, critical
       FROM prod.critical_dependencies
      WHERE critical = true
      ORDER BY dependency_id ASC`,
  );
  const slas = await engine.query<RawSlaRow>(
    `SELECT sla_id, dependency_id, applicable, sla_ref, verified_at, expires_at
       FROM prod.sla_register
      ORDER BY dependency_id ASC, verified_at ASC, sla_id ASC`,
  );
  // Numeric-index coverage walk only (audit HIGH): the previous
  // `for (const dependency of dependencies.rows)` read `Symbol.iterator`, so a
  // shadowed iterator skipped EVERY dependency, left `missingSlaRefs` empty, and
  // then an empty register was the only thing blocking SLA_BACKED — a fail-OPEN
  // posture claim. `filter`/`map` shadows are avoided the same way.
  const missingSlaRefs: string[] = [];
  const criticalDependencyIds: string[] = [];
  for (let index = 0; index < dependencies.rows.length; index += 1) {
    const dependency = dependencies.rows[index];
    if (dependency === undefined) continue;
    criticalDependencyIds[criticalDependencyIds.length] = dependency.dependency_id;
    let unexpiredCount = 0;
    for (let slaIndex = 0; slaIndex < slas.rows.length; slaIndex += 1) {
      const sla = slas.rows[slaIndex];
      if (
        sla === undefined ||
        sla.dependency_id !== dependency.dependency_id ||
        sla.applicable !== true
      ) {
        continue;
      }
      const verifiedMs = Date.parse(String(sla.verified_at));
      if (!Number.isFinite(verifiedMs) || verifiedMs > nowMs) continue;
      if (sla.expires_at === null) {
        unexpiredCount += 1;
        continue;
      }
      const expiresMs = Date.parse(String(sla.expires_at));
      if (Number.isFinite(expiresMs) && expiresMs > nowMs) unexpiredCount += 1;
    }
    if (unexpiredCount === 0) missingSlaRefs[missingSlaRefs.length] = dependency.dependency_id;
  }
  const protectedDimensions = numericCopy(ALL_PROTECTED_DIMENSIONS);
  // An EMPTY critical register is vacuous coverage, not coverage (audit H8):
  // SLA_BACKED requires at least one declared critical dependency AND a passing
  // capacity contract, so the posture can never be claimed by declaring nothing.
  const emptyRegister = criticalDependencyIds.length === 0;
  // The capacity claim is validated with the AUTHORITATIVE capacity law, not a
  // bare `result === 'PASS'` string (audit H8 residual): a contract that
  // violates a capacity law, is not activatable, or has expired cannot back an
  // SLA_BACKED posture.
  let capacityBacked = false;
  if (input.capacityContract !== undefined && input.capacityContract !== null) {
    try {
      validateSustainableCapacityContract(input.capacityContract);
      capacityBacked =
        isContractActivatable(input.capacityContract) &&
        Date.parse(input.capacityContract.expiresAt) > nowMs;
    } catch {
      capacityBacked = false;
    }
  }
  if (missingSlaRefs.length === 0 && !emptyRegister && capacityBacked) {
    return {
      posture: DeploymentPosture.SLA_BACKED,
      criticalDependencyIds,
      missingSlaRefs: [],
      degradedScope: {},
      reason:
        'every critical external dependency carries an applicable unexpired SLA and a passing capacity contract backs the deployment',
      protectedDimensions,
      relaxedDimensions: [],
    };
  }
  const reasons: string[] = [];
  if (emptyRegister) reasons[reasons.length] = 'no critical external dependency is declared';
  if (!capacityBacked) {
    reasons[reasons.length] = 'no passing sustainable-capacity contract backs the deployment';
  }
  if (missingSlaRefs.length > 0) {
    reasons[reasons.length] =
      `${missingSlaRefs.length} critical dependency(ies) lack an applicable unexpired SLA`;
  }
  return {
    posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
    criticalDependencyIds,
    missingSlaRefs,
    degradedScope: {
      degraded: 'FREE_TIER_EXTERNAL_DEPENDENCIES',
      missing_sla_count: missingSlaRefs.length,
      missing_sla_dependencies: missingSlaRefs,
      declared_critical_dependencies: criticalDependencyIds.length,
      capacity_contract_backed: capacityBacked,
    },
    reason: `best-effort free-tier posture: ${reasons.join('; ')}`,
    protectedDimensions,
    relaxedDimensions: ['freshness', 'breadth', 'depth', 'alert_availability'],
  };
}

// --- best-effort law --------------------------------------------------------

/** One posture declaration to validate. */
export interface BestEffortDeclarationInput {
  readonly posture: unknown;
  readonly weakenedDimensions: readonly string[];
  readonly protectedDimensions: readonly string[];
  readonly reason?: string;
}

/**
 * AC-153 law. Refuse a declaration that weakens a protected dimension, names
 * an unknown relaxable dimension, omits a protected dimension from its
 * protected set, or claims SLA_BACKED while weakening anything. A capacity or
 * quota failure can therefore never be used to weaken safety.
 */
export function assertBestEffortPreservesProtectedDimensions(
  declaration: BestEffortDeclarationInput,
): void {
  const posture = parseDeploymentPosture(declaration.posture);
  // Numeric de-duplication only (audit HIGH): `[...new Set(array)]` reads
  // `Symbol.iterator`, so a shadowed iterator made the weakened set EMPTY and
  // the protected-dimension and SLA_BACKED checks below all no-op.
  const weakened = numericUnique(declaration.weakenedDimensions);
  for (let index = 0; index < weakened.length; index += 1) {
    const dimension = weakened[index] as string;
    if (isOneOf(dimension, ALL_PROTECTED_DIMENSIONS)) {
      throw new ForesiftError(
        ErrorCode.PROD_BEST_EFFORT_PROTECTED_DIMENSION,
        `a best-effort declaration may never weaken protected dimension '${dimension}' (§69.6)`,
        { posture, dimension },
      );
    }
    parseDeploymentRelaxableDimension(dimension);
  }
  // Numeric-index walks and `isOneOf` only: a shadowed
  // `Array.prototype.includes`/`filter` must not be able to hide a protected
  // dimension omitted from the declaration (audit NEW-M4).
  const declaredProtected: ProtectedDimension[] = [];
  for (
    let declaredIndex = 0;
    declaredIndex < declaration.protectedDimensions.length;
    declaredIndex += 1
  ) {
    declaredProtected[declaredProtected.length] = parseProtectedDimension(
      declaration.protectedDimensions[declaredIndex],
    );
  }
  const missingProtected: ProtectedDimension[] = [];
  for (
    let dimensionIndex = 0;
    dimensionIndex < ALL_PROTECTED_DIMENSIONS.length;
    dimensionIndex += 1
  ) {
    const dimension = ALL_PROTECTED_DIMENSIONS[dimensionIndex] as ProtectedDimension;
    if (!isOneOf(dimension, declaredProtected))
      missingProtected[missingProtected.length] = dimension;
  }
  if (missingProtected.length > 0) {
    throw new ForesiftError(
      ErrorCode.PROD_BEST_EFFORT_PROTECTED_DIMENSION,
      `a best-effort declaration must assert every protected dimension; missing ${missingProtected.join(', ')}`,
      { posture, missingProtected: missingProtected.join(', ') },
    );
  }
  if (posture === DeploymentPosture.SLA_BACKED && weakened.length > 0) {
    throw new ForesiftError(
      ErrorCode.PROD_BEST_EFFORT_PROTECTED_DIMENSION,
      'an SLA_BACKED posture declares no weakening',
      { posture },
    );
  }
  // Delegate the pure domain law as well so the two fences cannot drift.
  if (!bestEffortWeakensOnlyAllowedDimensions(declaration)) {
    throw new ForesiftError(
      ErrorCode.PROD_BEST_EFFORT_PROTECTED_DIMENSION,
      'the best-effort declaration violates the §69.6 protected-dimension law',
      { posture },
    );
  }
}

/** Persist one validated best-effort declaration (immutable; a new row per change). */
export async function declareBestEffortPosture(
  engine: DatabaseEngine,
  input: BestEffortDeclarationInput & {
    readonly declarationId: string;
    readonly degradedScope: Readonly<Record<string, unknown>>;
    readonly missingSlaRefs: readonly string[];
    readonly at: string;
  },
): Promise<void> {
  assertBestEffortPreservesProtectedDimensions(input);
  await engine.query(
    `INSERT INTO prod.best_effort_declarations
       (declaration_id, posture, degraded_scope, missing_sla_refs, weakened_dimensions,
        protected_dimensions, reason, declared_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::text[], $6::text[], $7, $8::timestamptz)`,
    [
      requireText(input.declarationId, 'declarationId', ErrorCode.PROD_ACTIVATION_SCOPE_INVALID),
      parseDeploymentPosture(input.posture),
      canonicalJson(input.degradedScope),
      canonicalJson(input.missingSlaRefs),
      numericUnique(input.weakenedDimensions),
      numericCopy(ALL_PROTECTED_DIMENSIONS),
      requireText(
        input.reason ?? 'declared posture',
        'reason',
        ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      ),
      input.at,
    ],
  );
}

// --- capacity/quota degradation ---------------------------------------------

/** The §69.6 relaxable dimension each §62.8 reduction step maps onto. */
export const CAPACITY_DEGRADE_RELAXES: Readonly<Record<DegradeStep, DeploymentRelaxableDimension>> =
  {
    REDUCE_BREADTH: 'breadth',
    REDUCE_DEPTH: 'depth',
    RETURN_CACHE: 'freshness',
    SKIP_LOW_PRIORITY: 'alert_availability',
    QUOTA_EXHAUSTED: 'alert_availability',
  };

/** One capacity-pressure relaxation decision. */
export interface CapacityPressureRelaxation {
  readonly step: DegradeStep;
  readonly relaxedDimensions: readonly DeploymentRelaxableDimension[];
  readonly posture: DeploymentPosture;
  readonly protectedDimensions: readonly ProtectedDimension[];
}

/**
 * Consume `@foresift/capacity-planner`'s deterministic degradation step and map
 * it onto the §69.6 relaxable dimensions only. The returned posture is
 * FREE_TIER_BEST_EFFORT and the protected dimension set is inherited whole, so
 * a quota failure can never authorize weakening identity, point-in-time,
 * audit, duplicate prevention, security, execution semantics, capacity
 * enforcement, critical risk monitoring, or claim boundaries.
 */
export function degradeForCapacityPressure(state: DegradeState): CapacityPressureRelaxation {
  const step = broadScanDegradeStrategy(state);
  const relaxed = [CAPACITY_DEGRADE_RELAXES[step]];
  assertBestEffortPreservesProtectedDimensions({
    posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
    weakenedDimensions: relaxed,
    protectedDimensions: numericCopy(ALL_PROTECTED_DIMENSIONS),
  });
  return {
    step,
    relaxedDimensions: relaxed,
    posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
    protectedDimensions: numericCopy(ALL_PROTECTED_DIMENSIONS),
  };
}

/** The protected-dimension assertions a capacity degradation must preserve. */
export const CAPACITY_DEGRADATION_PROTECTED_DIMENSIONS: readonly ProtectedDimension[] =
  ALL_PROTECTED_DIMENSIONS;

/**
 * Assert a capacity/quota failure preserves integrity, audit, duplicate
 * prevention, capacity enforcement, and critical risk monitoring while
 * degrading breadth/depth/opportunity availability only.
 */
export function assertCapacityDegradationPreservesProtectedDimensions(
  relaxedDimensions: readonly string[],
): void {
  assertBestEffortPreservesProtectedDimensions({
    posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
    weakenedDimensions: relaxedDimensions,
    protectedDimensions: numericCopy(ALL_PROTECTED_DIMENSIONS),
  });
}

/** A capacity contract that is not PASS can never back an SLA_BACKED claim. */
export function assertCapacityContractBacksPosture(
  contract: SustainableCapacityContract | null,
): void {
  if (contract === null || contract.result !== 'PASS') {
    throw new ForesiftError(
      ErrorCode.PROD_DEPLOYMENT_POSTURE_UNKNOWN,
      'an SLA_BACKED posture requires a passing sustainable-capacity contract',
      { contractId: contract?.contractId ?? null, result: contract?.result ?? null },
    );
  }
}
