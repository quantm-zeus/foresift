/**
 * Governed production-readiness vocabularies and pure laws
 * (FR-PROD-001…006, PRD §32, §33.7, §40, §69.2–§69.12).
 *
 * The PRD literal lists — §69.2 module/artifact lifecycle, operational
 * readiness, and distribution readiness; §69.6 free-tier statement; §69.7 MCP
 * compatibility; §69.11 automatic containment; §69.12 change classification —
 * are the vocabulary authority. The const objects below transcribe them
 * verbatim; the SQL CHECK lists in `migrations/g2_prod_*.sql` copy the same
 * members. No writer may invent, rename, or omit members.
 *
 * `IMPLEMENTED`, `AVAILABLE`, and `PROVEN` are independent state dimensions
 * (FR-PROD-001/§69.2): the complete codebase may be deployed while insufficient
 * modules remain `DISABLED`/partial/`SHADOW`-only (FR-PROD-002). The module
 * lifecycle is seeded from the §69.2 `NOT_IMPLEMENTED` position, which is a seed
 * and never a governed nine-state member.
 *
 * Every parser refuses fail-closed with a stable `ErrorCode` so callers branch
 * on `code`, never on prose. Every law below is total and deterministic: it
 * either returns a pure value or throws a typed `ForesiftError`.
 *
 * Strictly read-only: nothing here can trade, hold custody, sign, handle
 * private keys, or submit a transaction.
 */
import { ErrorCode, ForesiftError } from './errors.ts';
import { compareTimestamps, toEpochMs, utcTimestamp } from './timestamps.ts';

// --- §69.2 module/artifact lifecycle ---------------------------------------

/** PRD §69.2 governed module/artifact lifecycle, verbatim and in order. */
export const ModuleLifecycleState = {
  IMPLEMENTED: 'IMPLEMENTED',
  AVAILABLE: 'AVAILABLE',
  SHADOW: 'SHADOW',
  PROVEN: 'PROVEN',
  ACTIVE: 'ACTIVE',
  DEGRADED: 'DEGRADED',
  PAUSED: 'PAUSED',
  RETIRED: 'RETIRED',
  DISABLED: 'DISABLED',
} as const;
export type ModuleLifecycleState = (typeof ModuleLifecycleState)[keyof typeof ModuleLifecycleState];
export const ALL_MODULE_LIFECYCLE_STATES: readonly ModuleLifecycleState[] =
  Object.values(ModuleLifecycleState);

/**
 * The §69.2 seed position. A module that has no governed state row yet is
 * `NOT_IMPLEMENTED`; it is NOT one of the nine governed states and no state
 * row may persist it.
 */
export const MODULE_LIFECYCLE_SEED = 'NOT_IMPLEMENTED' as const;
export type ModuleLifecycleSeed = typeof MODULE_LIFECYCLE_SEED;
export type ModuleLifecyclePosition = ModuleLifecycleState | ModuleLifecycleSeed;
export const ALL_MODULE_LIFECYCLE_POSITIONS: readonly ModuleLifecyclePosition[] = [
  MODULE_LIFECYCLE_SEED,
  ...ALL_MODULE_LIFECYCLE_STATES,
];

// --- §69.2 operational readiness -------------------------------------------

/** PRD §69.2 operational readiness, verbatim and in order. */
export const OperationalReadiness = {
  NOT_READY: 'NOT_READY',
  READY_FOR_COLLECTION: 'READY_FOR_COLLECTION',
  READY_FOR_SHADOW_RESEARCH: 'READY_FOR_SHADOW_RESEARCH',
  READY_FOR_SHADOW_ALERTS: 'READY_FOR_SHADOW_ALERTS',
  READY_FOR_ACTIVE_PROFILE: 'READY_FOR_ACTIVE_PROFILE',
} as const;
export type OperationalReadiness = (typeof OperationalReadiness)[keyof typeof OperationalReadiness];
export const ALL_OPERATIONAL_READINESS: readonly OperationalReadiness[] =
  Object.values(OperationalReadiness);

// --- §69.2 distribution readiness -------------------------------------------

/** PRD §69.2 distribution readiness, verbatim and in order. */
export const DistributionReadiness = {
  PRIVATE_ONLY: 'PRIVATE_ONLY',
  WORKSPACE_TECHNICALLY_READY: 'WORKSPACE_TECHNICALLY_READY',
  WORKSPACE_AUTHORIZED: 'WORKSPACE_AUTHORIZED',
  PUBLIC_TECHNICALLY_READY: 'PUBLIC_TECHNICALLY_READY',
  PUBLIC_AUTHORIZED: 'PUBLIC_AUTHORIZED',
} as const;
export type DistributionReadiness =
  (typeof DistributionReadiness)[keyof typeof DistributionReadiness];
export const ALL_DISTRIBUTION_READINESS: readonly DistributionReadiness[] =
  Object.values(DistributionReadiness);

// --- §69.6 deployment posture ------------------------------------------------

/** PRD §69.6 deployment posture, verbatim and in order. */
export const DeploymentPosture = {
  SLA_BACKED: 'SLA_BACKED',
  FREE_TIER_BEST_EFFORT: 'FREE_TIER_BEST_EFFORT',
} as const;
export type DeploymentPosture = (typeof DeploymentPosture)[keyof typeof DeploymentPosture];
export const ALL_DEPLOYMENT_POSTURES: readonly DeploymentPosture[] =
  Object.values(DeploymentPosture);

// --- §69.4/§69.5/§69.9 ordered activation gates ------------------------------

/**
 * The closed activation-gate vocabulary, in the ordered evaluation sequence of
 * §69.4 (operational activation), §69.5 (opportunity activation), and §69.9
 * (public/workspace activation). A gate is one named precondition; the gate
 * function in `packages/capability-registry` consumes foreign results and never
 * recomputes the underlying statistics, capacity, security, or rights logic.
 */
export const ActivationGateKind = {
  IMPLEMENTED_PRESENT: 'IMPLEMENTED_PRESENT',
  AVAILABLE_EVIDENCE: 'AVAILABLE_EVIDENCE',
  PROVEN_PRESENT: 'PROVEN_PRESENT',
  STATISTICAL_EVIDENCE_SCOPE: 'STATISTICAL_EVIDENCE_SCOPE',
  NEGATIVE_CONTROLS: 'NEGATIVE_CONTROLS',
  CLUSTERED_INTERVALS: 'CLUSTERED_INTERVALS',
  CALIBRATION_MATURITY: 'CALIBRATION_MATURITY',
  VERIFIED_GATE_EVIDENCE: 'VERIFIED_GATE_EVIDENCE',
  CAPACITY_CONTRACT: 'CAPACITY_CONTRACT',
  DISTRIBUTION_EVIDENCE: 'DISTRIBUTION_EVIDENCE',
  NO_OPEN_CONTAINMENT: 'NO_OPEN_CONTAINMENT',
} as const;
export type ActivationGateKind = (typeof ActivationGateKind)[keyof typeof ActivationGateKind];
/** The ordered evaluation sequence; missing inputs fail closed at their slot. */
export const ACTIVATION_GATE_ORDER: readonly ActivationGateKind[] = [
  ActivationGateKind.IMPLEMENTED_PRESENT,
  ActivationGateKind.AVAILABLE_EVIDENCE,
  ActivationGateKind.PROVEN_PRESENT,
  ActivationGateKind.STATISTICAL_EVIDENCE_SCOPE,
  ActivationGateKind.NEGATIVE_CONTROLS,
  ActivationGateKind.CLUSTERED_INTERVALS,
  ActivationGateKind.CALIBRATION_MATURITY,
  ActivationGateKind.VERIFIED_GATE_EVIDENCE,
  ActivationGateKind.CAPACITY_CONTRACT,
  ActivationGateKind.DISTRIBUTION_EVIDENCE,
  ActivationGateKind.NO_OPEN_CONTAINMENT,
];
export const ALL_ACTIVATION_GATE_KINDS: readonly ActivationGateKind[] =
  Object.values(ActivationGateKind);

/** A gate evaluation verdict. `REFUSE` always names the failing gate. */
export const ActivationGateVerdict = {
  PASS: 'PASS',
  REFUSE: 'REFUSE',
} as const;
export type ActivationGateVerdict =
  (typeof ActivationGateVerdict)[keyof typeof ActivationGateVerdict];
export const ALL_ACTIVATION_GATE_VERDICTS: readonly ActivationGateVerdict[] =
  Object.values(ActivationGateVerdict);

// --- §69.12 change classification -------------------------------------------

/** PRD §69.12 change classification, verbatim and in order. */
export const ChangeClassification = {
  NON_MATERIAL_COMPATIBLE: 'NON_MATERIAL_COMPATIBLE',
  MATERIAL_OPERATIONAL: 'MATERIAL_OPERATIONAL',
  MATERIAL_EVALUATION: 'MATERIAL_EVALUATION',
  MATERIAL_SECURITY_OR_RIGHTS: 'MATERIAL_SECURITY_OR_RIGHTS',
} as const;
export type ChangeClassification = (typeof ChangeClassification)[keyof typeof ChangeClassification];
export const ALL_CHANGE_CLASSIFICATIONS: readonly ChangeClassification[] =
  Object.values(ChangeClassification);

// --- §69.11 automatic containment -------------------------------------------

/** PRD §69.11 containment actions, in escalation order. */
export const ContainmentAction = {
  DEGRADED: 'DEGRADED',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
} as const;
export type ContainmentAction = (typeof ContainmentAction)[keyof typeof ContainmentAction];
export const ALL_CONTAINMENT_ACTIONS: readonly ContainmentAction[] =
  Object.values(ContainmentAction);

// --- §69.7 MCP revision channel ---------------------------------------------

/** PRD §69.7 revision channel. Stable is the default; draft/RC is opt-in. */
export const McpRevisionChannel = {
  STABLE: 'STABLE',
  DRAFT: 'DRAFT',
} as const;
export type McpRevisionChannel = (typeof McpRevisionChannel)[keyof typeof McpRevisionChannel];
export const ALL_MCP_REVISION_CHANNELS: readonly McpRevisionChannel[] =
  Object.values(McpRevisionChannel);

/** §69.7 conformance result for a revision×client cell. */
export const McpConformanceResult = {
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;
export type McpConformanceResult = (typeof McpConformanceResult)[keyof typeof McpConformanceResult];
export const ALL_MCP_CONFORMANCE_RESULTS: readonly McpConformanceResult[] =
  Object.values(McpConformanceResult);

/** The §69.7 baseline mutually tested stable revision. */
export const MCP_BASELINE_STABLE_REVISION = '2025-11-25' as const;

/** A revision×client cell's live test may be at most this old to stay usable. */
export const MCP_LIVE_TEST_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

// --- §69.6 protected and relaxable dimensions --------------------------------

/**
 * The §69.6/§34.3 protected dimensions. A best-effort declaration may NEVER
 * weaken one of these: identity, point-in-time, audit, duplicate prevention,
 * security, execution semantics, capacity enforcement, critical risk
 * monitoring, claim boundaries.
 */
export const ProtectedDimension = {
  IDENTITY: 'identity',
  POINT_IN_TIME: 'point_in_time',
  AUDIT: 'audit',
  DUPLICATE_PREVENTION: 'duplicate_prevention',
  SECURITY: 'security',
  EXECUTION_SEMANTICS: 'execution_semantics',
  CAPACITY: 'capacity',
  CRITICAL_RISK_MONITORING: 'critical_risk_monitoring',
  CLAIM_BOUNDARIES: 'claim_boundaries',
} as const;
export type ProtectedDimension = (typeof ProtectedDimension)[keyof typeof ProtectedDimension];
export const ALL_PROTECTED_DIMENSIONS: readonly ProtectedDimension[] =
  Object.values(ProtectedDimension);

/**
 * The ONLY dimensions a `FREE_TIER_BEST_EFFORT` posture may relax: freshness,
 * breadth, depth, and opportunity alert availability (§69.6). Capacity or quota
 * pressure cannot authorize paid fallback or stale overclaim.
 */
export const DeploymentRelaxableDimension = {
  FRESHNESS: 'freshness',
  BREADTH: 'breadth',
  DEPTH: 'depth',
  ALERT_AVAILABILITY: 'alert_availability',
} as const;
export type DeploymentRelaxableDimension =
  (typeof DeploymentRelaxableDimension)[keyof typeof DeploymentRelaxableDimension];
export const ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS: readonly DeploymentRelaxableDimension[] =
  Object.values(DeploymentRelaxableDimension);

// --- §10.3/§35.14 import-boundary assertions ---------------------------------

/** The §10.3/§33.7/§35.14 live-path boundary assertions. */
export const ArtifactBoundaryAssertionKind = {
  NO_HEAVY_JOB: 'NO_HEAVY_JOB',
  NO_IMPORT: 'NO_IMPORT',
  NO_PROVIDER_CALL: 'NO_PROVIDER_CALL',
  IMPORT_SHADOW_ONLY: 'IMPORT_SHADOW_ONLY',
} as const;
export type ArtifactBoundaryAssertionKind =
  (typeof ArtifactBoundaryAssertionKind)[keyof typeof ArtifactBoundaryAssertionKind];
export const ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS: readonly ArtifactBoundaryAssertionKind[] =
  Object.values(ArtifactBoundaryAssertionKind);

// --- §40 dependency-group ordering -------------------------------------------

/** The §40 implementation dependency groups, in required order G0…G7. */
export const DEPENDENCY_GROUP_ORDER = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const;
export type DependencyGroupId = (typeof DEPENDENCY_GROUP_ORDER)[number];
export const ALL_DEPENDENCY_GROUP_IDS: readonly DependencyGroupId[] = [...DEPENDENCY_GROUP_ORDER];

// --- fail-closed parsers -----------------------------------------------------

function parseClosed<T extends string>(
  values: readonly T[],
  value: unknown,
  code: ErrorCode,
  label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new ForesiftError(code, `unknown ${label}`, {
    value: typeof value === 'string' ? value : null,
  });
}

export const parseModuleLifecycleState = (value: unknown): ModuleLifecycleState =>
  parseClosed(
    ALL_MODULE_LIFECYCLE_STATES,
    value,
    ErrorCode.PROD_MODULE_STATE_UNKNOWN,
    'module lifecycle state',
  );
export const parseModuleLifecyclePosition = (value: unknown): ModuleLifecyclePosition =>
  parseClosed(
    ALL_MODULE_LIFECYCLE_POSITIONS,
    value,
    ErrorCode.PROD_MODULE_STATE_UNKNOWN,
    'module lifecycle position',
  );
export const parseOperationalReadiness = (value: unknown): OperationalReadiness =>
  parseClosed(
    ALL_OPERATIONAL_READINESS,
    value,
    ErrorCode.PROD_OPERATIONAL_READINESS_UNKNOWN,
    'operational readiness',
  );
export const parseDistributionReadiness = (value: unknown): DistributionReadiness =>
  parseClosed(
    ALL_DISTRIBUTION_READINESS,
    value,
    ErrorCode.PROD_DISTRIBUTION_READINESS_UNKNOWN,
    'distribution readiness',
  );
export const parseDeploymentPosture = (value: unknown): DeploymentPosture =>
  parseClosed(
    ALL_DEPLOYMENT_POSTURES,
    value,
    ErrorCode.PROD_DEPLOYMENT_POSTURE_UNKNOWN,
    'deployment posture',
  );
export const parseActivationGateKind = (value: unknown): ActivationGateKind =>
  parseClosed(
    ALL_ACTIVATION_GATE_KINDS,
    value,
    ErrorCode.PROD_ACTIVATION_GATE_KIND_UNKNOWN,
    'activation gate kind',
  );
export const parseActivationGateVerdict = (value: unknown): ActivationGateVerdict =>
  parseClosed(
    ALL_ACTIVATION_GATE_VERDICTS,
    value,
    ErrorCode.PROD_ACTIVATION_VERDICT_UNKNOWN,
    'activation gate verdict',
  );
export const parseChangeClassification = (value: unknown): ChangeClassification =>
  parseClosed(
    ALL_CHANGE_CLASSIFICATIONS,
    value,
    ErrorCode.PROD_CHANGE_CLASSIFICATION_UNKNOWN,
    'change classification',
  );
export const parseContainmentAction = (value: unknown): ContainmentAction =>
  parseClosed(
    ALL_CONTAINMENT_ACTIONS,
    value,
    ErrorCode.PROD_CONTAINMENT_ACTION_UNKNOWN,
    'containment action',
  );
export const parseMcpRevisionChannel = (value: unknown): McpRevisionChannel =>
  parseClosed(
    ALL_MCP_REVISION_CHANNELS,
    value,
    ErrorCode.PROD_MCP_REVISION_CHANNEL_UNKNOWN,
    'MCP revision channel',
  );
export const parseMcpConformanceResult = (value: unknown): McpConformanceResult =>
  parseClosed(
    ALL_MCP_CONFORMANCE_RESULTS,
    value,
    ErrorCode.PROD_MCP_CONFORMANCE_RESULT_UNKNOWN,
    'MCP conformance result',
  );
export const parseProtectedDimension = (value: unknown): ProtectedDimension =>
  parseClosed(
    ALL_PROTECTED_DIMENSIONS,
    value,
    ErrorCode.PROD_PROTECTED_DIMENSION_UNKNOWN,
    'protected dimension',
  );
export const parseDeploymentRelaxableDimension = (value: unknown): DeploymentRelaxableDimension =>
  parseClosed(
    ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS,
    value,
    ErrorCode.PROD_RELAXABLE_DIMENSION_UNKNOWN,
    'relaxable deployment dimension',
  );
export const parseArtifactBoundaryAssertionKind = (value: unknown): ArtifactBoundaryAssertionKind =>
  parseClosed(
    ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
    value,
    ErrorCode.PROD_ARTIFACT_BOUNDARY_KIND_UNKNOWN,
    'artifact boundary assertion kind',
  );
export const parseDependencyGroupId = (value: unknown): DependencyGroupId =>
  parseClosed(
    ALL_DEPENDENCY_GROUP_IDS,
    value,
    ErrorCode.PROD_DEPENDENCY_GROUP_UNKNOWN,
    'dependency group',
  );

/** Lowercase aliases mirroring the `wf.ts`/`alert.ts` convention. */
export const moduleLifecycleState = parseModuleLifecycleState;
export const moduleLifecyclePosition = parseModuleLifecyclePosition;
export const operationalReadiness = parseOperationalReadiness;
export const distributionReadiness = parseDistributionReadiness;
export const deploymentPosture = parseDeploymentPosture;
export const activationGateKind = parseActivationGateKind;
export const activationGateVerdict = parseActivationGateVerdict;
export const changeClassification = parseChangeClassification;
export const containmentAction = parseContainmentAction;
export const mcpRevisionChannel = parseMcpRevisionChannel;
export const mcpConformanceResult = parseMcpConformanceResult;
export const protectedDimension = parseProtectedDimension;
export const deploymentRelaxableDimension = parseDeploymentRelaxableDimension;
export const artifactBoundaryAssertionKind = parseArtifactBoundaryAssertionKind;
export const dependencyGroupId = parseDependencyGroupId;

// --- FR-PROD-001: independent state dimensions ------------------------------

/**
 * The three lifecycle states that are mutually INDEPENDENT state dimensions
 * (FR-PROD-001). A module may be `IMPLEMENTED` without being `AVAILABLE`, and
 * `AVAILABLE` without being `PROVEN`; each is persisted separately.
 */
export const INDEPENDENT_LIFECYCLE_STATES: readonly ModuleLifecycleState[] = [
  ModuleLifecycleState.IMPLEMENTED,
  ModuleLifecycleState.AVAILABLE,
  ModuleLifecycleState.PROVEN,
];

/** True iff `state` is one of the three independent lifecycle dimensions. */
export function isIndependentLifecycleState(state: unknown): boolean {
  return INDEPENDENT_LIFECYCLE_STATES.includes(parseModuleLifecycleState(state));
}

// --- §69.2/§69.3 legal lifecycle transitions --------------------------------

/**
 * The governed transition graph. `NOT_IMPLEMENTED` is the seed; every governed
 * state can be contained (`DISABLED`), and a contained module may only return to
 * a pre-`ACTIVE` position — re-activation always re-runs the gate.
 */
const LEGAL_LIFECYCLE_TRANSITIONS: Readonly<
  Record<ModuleLifecyclePosition, readonly ModuleLifecyclePosition[]>
> = {
  NOT_IMPLEMENTED: [ModuleLifecycleState.IMPLEMENTED],
  IMPLEMENTED: [
    ModuleLifecycleState.AVAILABLE,
    ModuleLifecycleState.SHADOW,
    ModuleLifecycleState.DISABLED,
    ModuleLifecycleState.RETIRED,
  ],
  AVAILABLE: [
    ModuleLifecycleState.SHADOW,
    ModuleLifecycleState.DEGRADED,
    ModuleLifecycleState.PAUSED,
    ModuleLifecycleState.DISABLED,
    ModuleLifecycleState.RETIRED,
  ],
  SHADOW: [
    ModuleLifecycleState.PROVEN,
    ModuleLifecycleState.AVAILABLE,
    ModuleLifecycleState.PAUSED,
    ModuleLifecycleState.DISABLED,
    ModuleLifecycleState.RETIRED,
  ],
  PROVEN: [
    ModuleLifecycleState.ACTIVE,
    ModuleLifecycleState.PAUSED,
    ModuleLifecycleState.DISABLED,
    ModuleLifecycleState.RETIRED,
  ],
  ACTIVE: [
    ModuleLifecycleState.DEGRADED,
    ModuleLifecycleState.PAUSED,
    ModuleLifecycleState.DISABLED,
    ModuleLifecycleState.RETIRED,
  ],
  DEGRADED: [
    ModuleLifecycleState.ACTIVE,
    ModuleLifecycleState.PAUSED,
    ModuleLifecycleState.DISABLED,
    ModuleLifecycleState.RETIRED,
  ],
  PAUSED: [
    ModuleLifecycleState.DEGRADED,
    ModuleLifecycleState.ACTIVE,
    ModuleLifecycleState.DISABLED,
    ModuleLifecycleState.RETIRED,
  ],
  RETIRED: [ModuleLifecycleState.DISABLED],
  DISABLED: [
    ModuleLifecycleState.IMPLEMENTED,
    ModuleLifecycleState.AVAILABLE,
    ModuleLifecycleState.SHADOW,
    ModuleLifecycleState.PROVEN,
    ModuleLifecycleState.DEGRADED,
    ModuleLifecycleState.PAUSED,
  ],
};

/** Total law: is `from -> to` a legal governed lifecycle edge? Same-state is not. */
export function legalLifecycleTransition(from: unknown, to: unknown): boolean {
  const parsedFrom = parseModuleLifecyclePosition(from);
  const parsedTo = parseModuleLifecyclePosition(to);
  if (parsedFrom === parsedTo) return false;
  return LEGAL_LIFECYCLE_TRANSITIONS[parsedFrom].includes(parsedTo);
}

/** Refuses an illegal transition with `PROD_LIFECYCLE_TRANSITION_ILLEGAL`. */
export function assertLegalLifecycleTransition(from: unknown, to: unknown): void {
  if (!legalLifecycleTransition(from, to)) {
    throw new ForesiftError(
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
      'illegal module lifecycle transition',
      {
        from: typeof from === 'string' ? from : null,
        to: typeof to === 'string' ? to : null,
      },
    );
  }
}

// --- §69.5 activation scope and ordered prerequisites ------------------------

/**
 * The exact §69.5 activation scope: a profile version, policy/ranking version,
 * regime scope, execution scenario and delay policy, and a population claim,
 * plus whether the scope specifies the `PROVEN` precondition (AC-152).
 */
export interface ActivationScope {
  readonly profileVersion: string;
  readonly policyVersion: string;
  readonly regimeScope: string;
  readonly executionScenario: string;
  readonly delayPolicy: string;
  readonly populationClaim: string;
  /** True when this scope additionally requires PROVEN before ACTIVE. */
  readonly requiresProven: boolean;
}

const ACTIVATION_SCOPE_TEXT_FIELDS = [
  'profileVersion',
  'policyVersion',
  'regimeScope',
  'executionScenario',
  'delayPolicy',
  'populationClaim',
] as const;

function requireScopeText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      `${field} must be a non-empty string`,
      { field, value: typeof value === 'string' ? value : null },
    );
  }
  return value;
}

/**
 * Total, ordered §69.5 law. Returns the prerequisites for activation in
 * evaluation order: `IMPLEMENTED`, then `AVAILABLE`, then `PROVEN` ONLY when the
 * scope specifies it. A scope whose `requiresProven` flag and scheduled
 * `PROVEN_PRESENT` gate contradict each other fails closed.
 */
export function requiredStatesForActivation(
  scope: ActivationScope,
  gates: readonly ActivationGateKind[],
): readonly ModuleLifecycleState[] {
  for (const field of ACTIVATION_SCOPE_TEXT_FIELDS) {
    requireScopeText(scope[field], field);
  }
  if (typeof scope.requiresProven !== 'boolean') {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'requiresProven must be a boolean',
      { field: 'requiresProven', value: null },
    );
  }
  const parsedGates = gates.map(parseActivationGateKind);
  const schedulesProven = parsedGates.includes(ActivationGateKind.PROVEN_PRESENT);
  if (schedulesProven !== scope.requiresProven) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'PROVEN is required exactly when the scope specifies it (§69.5)',
      { requiresProven: scope.requiresProven, schedulesProvenGate: schedulesProven },
    );
  }
  const required: ModuleLifecycleState[] = [
    ModuleLifecycleState.IMPLEMENTED,
    ModuleLifecycleState.AVAILABLE,
  ];
  if (scope.requiresProven) required.push(ModuleLifecycleState.PROVEN);
  return required;
}

// --- §69.4/§69.5 ordered fail-closed activation predicate -------------------

/** One immutable activation-gate evaluation row. */
export interface ActivationGateEvaluation {
  readonly gateKind: unknown;
  readonly verdict: unknown;
  /** Non-null exactly when `verdict` is `REFUSE`. */
  readonly failingGate: unknown;
}

/**
 * Total ordered gate predicate. Walks `requiredGates` in order and returns the
 * first gate that is missing, duplicated, refused, or internally inconsistent
 * (`PASS` carrying a failing gate, or `REFUSE` without one). `null` means every
 * required gate passed exactly once.
 */
export function activationGateRefusal(
  evaluations: readonly ActivationGateEvaluation[],
  requiredGates: readonly ActivationGateKind[] = ACTIVATION_GATE_ORDER,
): ActivationGateKind | null {
  const required = requiredGates.map(parseActivationGateKind);
  const byGate = new Map<ActivationGateKind, ActivationGateEvaluation[]>();
  for (const evaluation of evaluations) {
    const gate = parseActivationGateKind(evaluation.gateKind);
    const bucket = byGate.get(gate);
    if (bucket === undefined) byGate.set(gate, [evaluation]);
    else bucket.push(evaluation);
  }
  for (const gate of required) {
    const bucket = byGate.get(gate);
    if (bucket === undefined || bucket.length !== 1) return gate;
    const [evaluation] = bucket;
    if (evaluation === undefined) return gate;
    const verdict = parseActivationGateVerdict(evaluation.verdict);
    const failing =
      evaluation.failingGate === null ? null : parseActivationGateKind(evaluation.failingGate);
    if (verdict === ActivationGateVerdict.REFUSE) return failing ?? gate;
    if (failing !== null) return gate;
  }
  return null;
}

/** True iff every required gate passed exactly once. */
export function activationGateSatisfied(
  evaluations: readonly ActivationGateEvaluation[],
  requiredGates: readonly ActivationGateKind[] = ACTIVATION_GATE_ORDER,
): boolean {
  return activationGateRefusal(evaluations, requiredGates) === null;
}

/** Refuses an incomplete or refused gate set with `PROD_ACTIVATION_GATE_REFUSED`. */
export function assertActivationGateSatisfied(
  evaluations: readonly ActivationGateEvaluation[],
  requiredGates: readonly ActivationGateKind[] = ACTIVATION_GATE_ORDER,
): void {
  const failing = activationGateRefusal(evaluations, requiredGates);
  if (failing !== null) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'the activation gate set is incomplete or refused',
      { failingGate: failing },
    );
  }
}

// --- §40 dependency-group ordering ------------------------------------------

/** Total: the zero-based §40 position of a dependency group, or a typed refusal. */
export function dependencyGroupIndex(groupId: unknown): number {
  return DEPENDENCY_GROUP_ORDER.indexOf(parseDependencyGroupId(groupId));
}

/** True iff `prerequisite` sorts strictly before `dependent` in G0…G7. */
export function dependencyGroupOrderAllowed(prerequisite: unknown, dependent: unknown): boolean {
  return dependencyGroupIndex(prerequisite) < dependencyGroupIndex(dependent);
}

/** Refuses an out-of-order dependency edge with `PROD_DEPENDENCY_ORDER_VIOLATED`. */
export function assertDependencyGroupOrder(prerequisite: unknown, dependent: unknown): void {
  if (!dependencyGroupOrderAllowed(prerequisite, dependent)) {
    throw new ForesiftError(
      ErrorCode.PROD_DEPENDENCY_ORDER_VIOLATED,
      'a dependency group may depend only on an earlier group',
      {
        prerequisite: typeof prerequisite === 'string' ? prerequisite : null,
        dependent: typeof dependent === 'string' ? dependent : null,
      },
    );
  }
}

/**
 * §40 law: group completion means production-ready code (migrations, tests,
 * observability, diagnostics, runbooks, conformance, recovery) and NEVER
 * automatic opportunity activation. The registry persists this as `false`.
 */
export function dependencyGroupCompletionActivatesOpportunities(): boolean {
  return false;
}

// --- §69.6 best-effort posture law -------------------------------------------

/** One best-effort posture declaration input. */
export interface BestEffortDeclarationInput {
  readonly posture: unknown;
  readonly weakenedDimensions: readonly string[];
  readonly protectedDimensions: readonly string[];
}

/**
 * §69.6/AC-153 law. A declaration may relax ONLY the relaxable dimensions and
 * may never weaken a protected dimension; `SLA_BACKED` declares no weakening.
 * An unrecognised weakened dimension refuses fail-closed.
 */
export function bestEffortWeakensOnlyAllowedDimensions(
  declaration: BestEffortDeclarationInput,
): boolean {
  const posture = parseDeploymentPosture(declaration.posture);
  const weakened = [...new Set(declaration.weakenedDimensions)];
  for (const dimension of weakened) {
    if ((ALL_PROTECTED_DIMENSIONS as readonly string[]).includes(dimension)) return false;
    if (!(ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS as readonly string[]).includes(dimension)) {
      throw new ForesiftError(
        ErrorCode.PROD_RELAXABLE_DIMENSION_UNKNOWN,
        'unknown relaxable deployment dimension',
        { value: dimension },
      );
    }
  }
  for (const dimension of declaration.protectedDimensions) {
    parseProtectedDimension(dimension);
  }
  if (posture === DeploymentPosture.SLA_BACKED && weakened.length > 0) return false;
  return true;
}

/** Refuses a weakening declaration with `PROD_BEST_EFFORT_PROTECTED_DIMENSION`. */
export function assertBestEffortPreservesProtectedDimensions(
  declaration: BestEffortDeclarationInput,
): void {
  if (!bestEffortWeakensOnlyAllowedDimensions(declaration)) {
    throw new ForesiftError(
      ErrorCode.PROD_BEST_EFFORT_PROTECTED_DIMENSION,
      'a best-effort declaration must never weaken a protected dimension (§69.6)',
      { posture: typeof declaration.posture === 'string' ? declaration.posture : null },
    );
  }
}

// --- §69.12 change classification law ---------------------------------------

/**
 * §69.5/§69.12: a material operational or evaluation change creates a new
 * challenger/shadow version; a non-material compatible change does not, and a
 * material security/rights change blocks activation until reviewed instead.
 */
export function changeClassificationRequiresShadow(classification: unknown): boolean {
  const parsed = parseChangeClassification(classification);
  return (
    parsed === ChangeClassification.MATERIAL_OPERATIONAL ||
    parsed === ChangeClassification.MATERIAL_EVALUATION
  );
}

/** §69.12: material security/rights changes block activation until reviewed. */
export function changeClassificationBlocksActivation(classification: unknown): boolean {
  return (
    parseChangeClassification(classification) === ChangeClassification.MATERIAL_SECURITY_OR_RIGHTS
  );
}

// --- §69.7 MCP compatibility law ---------------------------------------------

/** One persisted MCP protocol revision. */
export interface McpRevisionDescriptor {
  readonly revision: string;
  readonly channel: unknown;
  readonly isDefault: boolean;
}

/** §69.7: only a stable revision may be the compatibility default. */
export function mcpRevisionMayBeDefault(descriptor: McpRevisionDescriptor): boolean {
  const channel = parseMcpRevisionChannel(descriptor.channel);
  if (descriptor.isDefault && channel !== McpRevisionChannel.STABLE) return false;
  return channel === McpRevisionChannel.STABLE;
}

/** Refuses a draft revision marked default with `PROD_MCP_DRAFT_DEFAULT`. */
export function assertNoDraftDefault(revisions: readonly McpRevisionDescriptor[]): void {
  for (const descriptor of revisions) {
    const channel = parseMcpRevisionChannel(descriptor.channel);
    if (descriptor.isDefault && channel !== McpRevisionChannel.STABLE) {
      throw new ForesiftError(
        ErrorCode.PROD_MCP_DRAFT_DEFAULT,
        'a draft/RC MCP revision can never be the compatibility default (§69.7)',
        { revision: descriptor.revision, channel },
      );
    }
  }
}

/** One revision×client compatibility-matrix cell. */
export interface McpCompatibilityCell {
  readonly revision: string;
  readonly clientId: string;
  readonly result: unknown;
  readonly liveTestDate: string;
}

/**
 * §69.7/AC-144: a cell is usable only with a passing conformance result and a
 * live test no older than `maxAgeSeconds`. A stale or failing cell is unusable.
 */
export function mcpCompatibilityCellUsable(
  cell: McpCompatibilityCell,
  now: string,
  maxAgeSeconds: number = MCP_LIVE_TEST_MAX_AGE_SECONDS,
): boolean {
  const result = parseMcpConformanceResult(cell.result);
  if (result !== McpConformanceResult.PASS) return false;
  const at = utcTimestamp(now);
  const testedAt = utcTimestamp(cell.liveTestDate);
  if (compareTimestamps(testedAt, at) > 0) return false;
  const ageSeconds = (toEpochMs(at) - toEpochMs(testedAt)) / 1000;
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'maxAgeSeconds must be a finite positive number',
      { maxAgeSeconds: Number.isFinite(maxAgeSeconds) ? maxAgeSeconds : null },
    );
  }
  return ageSeconds <= maxAgeSeconds;
}

// --- §33.7 bounded precomputed alpha -----------------------------------------

/** A declared bounded precomputed-alpha envelope. */
export interface PrecomputedAlphaBound {
  readonly artifactSetHash: string;
  readonly maxCandidates: number;
  readonly maxRows: number;
  readonly maxEdges: number;
  readonly maxLatencyMs: number;
  readonly maxCostUsd: number;
  readonly expiresAt: string;
}

/** One live-path read request against a precomputed bound. */
export interface PrecomputedAlphaRequest {
  readonly candidates: number;
  readonly rows: number;
  readonly edges: number;
  readonly latencyMs: number;
  readonly costUsd: number;
}

function requirePositiveBound(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ForesiftError(
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
      `precomputed bound ${field} must be finite and strictly positive`,
      { field, value: Number.isFinite(value) ? value : null },
    );
  }
  return value;
}

function requireNonNegativeRequest(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ForesiftError(
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
      `precomputed request ${field} must be finite and non-negative`,
      { field, value: Number.isFinite(value) ? value : null },
    );
  }
  return value;
}

/**
 * §33.7/AC-279 law. A bound MUST declare every ceiling (positive) and an
 * unambiguous `sha256:<hex>` artifact set; a request is served only when it is
 * unexpired and within every ceiling. Missing/unbounded input refuses fail-closed
 * rather than truncating the request into a different claim.
 */
export function precomputedAlphaBoundRespected(
  bound: PrecomputedAlphaBound,
  request: PrecomputedAlphaRequest,
  now: string,
): boolean {
  if (!/^sha256:[0-9a-f]{64}$/.test(bound.artifactSetHash)) {
    throw new ForesiftError(
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
      'precomputed bound artifactSetHash must be a sha256 content address',
      { artifactSetHash: bound.artifactSetHash },
    );
  }
  const maxCandidates = requirePositiveBound(bound.maxCandidates, 'maxCandidates');
  const maxRows = requirePositiveBound(bound.maxRows, 'maxRows');
  const maxEdges = requirePositiveBound(bound.maxEdges, 'maxEdges');
  const maxLatencyMs = requirePositiveBound(bound.maxLatencyMs, 'maxLatencyMs');
  const maxCostUsd = requirePositiveBound(bound.maxCostUsd, 'maxCostUsd');
  const expiresAt = utcTimestamp(bound.expiresAt);
  const at = utcTimestamp(now);
  if (compareTimestamps(at, expiresAt) >= 0) return false;
  if (requireNonNegativeRequest(request.candidates, 'candidates') > maxCandidates) return false;
  if (requireNonNegativeRequest(request.rows, 'rows') > maxRows) return false;
  if (requireNonNegativeRequest(request.edges, 'edges') > maxEdges) return false;
  if (requireNonNegativeRequest(request.latencyMs, 'latencyMs') > maxLatencyMs) return false;
  if (requireNonNegativeRequest(request.costUsd, 'costUsd') > maxCostUsd) return false;
  return true;
}

/** Refuses an unbounded, expired, or exceeded precomputed read. */
export function assertPrecomputedAlphaRequestWithinBound(
  bound: PrecomputedAlphaBound,
  request: PrecomputedAlphaRequest,
  now: string,
): void {
  if (!precomputedAlphaBoundRespected(bound, request, now)) {
    throw new ForesiftError(
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
      'the live-path precomputed lookup is expired or exceeds its declared ceilings',
      { artifactSetHash: bound.artifactSetHash },
    );
  }
}

// --- §10.3/§35.14 trust-boundary verdict -------------------------------------

/** One live-path artifact-boundary assertion. */
export interface ArtifactBoundaryAssertion {
  readonly assertionKind: unknown;
  readonly verdict: unknown;
  /** Non-null exactly for `IMPORT_SHADOW_ONLY` (references `sec.import_artifacts`). */
  readonly importArtifactRef: string | null;
}

/**
 * Total trust-boundary verdict. Every boundary assertion kind must appear
 * exactly once and pass; an `IMPORT_SHADOW_ONLY` assertion must reference the
 * quarantined import artifact, and every other kind must not. A heavy job,
 * import, or provider call on a live path therefore refuses.
 */
export function trustBoundaryVerdict(
  assertions: readonly ArtifactBoundaryAssertion[],
): ActivationGateVerdict {
  const counts = new Map<ArtifactBoundaryAssertionKind, number>();
  for (const assertion of assertions) {
    const kind = parseArtifactBoundaryAssertionKind(assertion.assertionKind);
    const verdict = parseActivationGateVerdict(assertion.verdict);
    const hasRef =
      typeof assertion.importArtifactRef === 'string' && assertion.importArtifactRef.length > 0;
    const refRequired = kind === ArtifactBoundaryAssertionKind.IMPORT_SHADOW_ONLY;
    if (verdict !== ActivationGateVerdict.PASS) return ActivationGateVerdict.REFUSE;
    if (refRequired !== hasRef) return ActivationGateVerdict.REFUSE;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  for (const kind of ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS) {
    if (counts.get(kind) !== 1) return ActivationGateVerdict.REFUSE;
  }
  return ActivationGateVerdict.PASS;
}

/** True iff `trustBoundaryVerdict` passes for the exact closed assertion set. */
export function artifactBoundaryHolds(assertions: readonly ArtifactBoundaryAssertion[]): boolean {
  return trustBoundaryVerdict(assertions) === ActivationGateVerdict.PASS;
}

/** Refuses a live path that reaches a heavy job, import, or provider call. */
export function assertArtifactBoundaryHolds(
  assertions: readonly ArtifactBoundaryAssertion[],
): void {
  if (!artifactBoundaryHolds(assertions)) {
    throw new ForesiftError(
      ErrorCode.PROD_TRUST_BOUNDARY_VIOLATION,
      'a live path must not reach a heavy job, artifact import, or provider call (§10.3/§35.14)',
      { assertions: assertions.length },
    );
  }
}
