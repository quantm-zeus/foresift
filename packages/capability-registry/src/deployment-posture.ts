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
  parseDeploymentPosture,
  parseDeploymentRelaxableDimension,
  parseProtectedDimension,
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
export const ALL_CRITICAL_DEPENDENCY_KINDS: readonly CriticalDependencyKind[] =
  Object.values(CriticalDependencyKind);

function parseCriticalDependencyKind(value: unknown): CriticalDependencyKind {
  if (
    typeof value === 'string' &&
    (ALL_CRITICAL_DEPENDENCY_KINDS as readonly string[]).includes(value)
  ) {
    return value as CriticalDependencyKind;
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
  input: { readonly now: string },
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
  const covered = new Set<string>();
  const missingSlaRefs: string[] = [];
  for (const dependency of dependencies.rows) {
    const applicable = slas.rows.filter(
      (sla) => sla.dependency_id === dependency.dependency_id && sla.applicable === true,
    );
    const unexpired = applicable.filter((sla) => {
      const verifiedMs = Date.parse(String(sla.verified_at));
      if (!Number.isFinite(verifiedMs) || verifiedMs > nowMs) return false;
      if (sla.expires_at === null) return true;
      const expiresMs = Date.parse(String(sla.expires_at));
      return Number.isFinite(expiresMs) && expiresMs > nowMs;
    });
    if (unexpired.length === 0) {
      missingSlaRefs.push(dependency.dependency_id);
    } else {
      covered.add(dependency.dependency_id);
    }
  }
  const criticalDependencyIds = dependencies.rows.map((row) => row.dependency_id);
  const protectedDimensions = [...ALL_PROTECTED_DIMENSIONS];
  if (missingSlaRefs.length === 0) {
    return {
      posture: DeploymentPosture.SLA_BACKED,
      criticalDependencyIds,
      missingSlaRefs: [],
      degradedScope: {},
      reason: 'every critical external dependency carries an applicable unexpired SLA',
      protectedDimensions,
      relaxedDimensions: [],
    };
  }
  return {
    posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
    criticalDependencyIds,
    missingSlaRefs,
    degradedScope: {
      degraded: 'FREE_TIER_EXTERNAL_DEPENDENCIES',
      missing_sla_count: missingSlaRefs.length,
      missing_sla_dependencies: missingSlaRefs,
    },
    reason: `best-effort free-tier posture: ${missingSlaRefs.length} critical dependency(ies) lack an applicable unexpired SLA`,
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
  const weakened = [...new Set(declaration.weakenedDimensions)];
  for (const dimension of weakened) {
    if ((ALL_PROTECTED_DIMENSIONS as readonly string[]).includes(dimension)) {
      throw new ForesiftError(
        ErrorCode.PROD_BEST_EFFORT_PROTECTED_DIMENSION,
        `a best-effort declaration may never weaken protected dimension '${dimension}' (§69.6)`,
        { posture, dimension },
      );
    }
    parseDeploymentRelaxableDimension(dimension);
  }
  const declaredProtected = declaration.protectedDimensions.map((dimension) =>
    parseProtectedDimension(dimension),
  );
  const missingProtected = ALL_PROTECTED_DIMENSIONS.filter(
    (dimension) => !declaredProtected.includes(dimension),
  );
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
      [...new Set(input.weakenedDimensions)],
      [...ALL_PROTECTED_DIMENSIONS],
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
    protectedDimensions: [...ALL_PROTECTED_DIMENSIONS],
  });
  return {
    step,
    relaxedDimensions: relaxed,
    posture: DeploymentPosture.FREE_TIER_BEST_EFFORT,
    protectedDimensions: [...ALL_PROTECTED_DIMENSIONS],
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
    protectedDimensions: [...ALL_PROTECTED_DIMENSIONS],
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
