/**
 * Runtime schemas for production-readiness governance
 * (FR-PROD-001…006, PRD §32, §33.7, §40, §69.2–§69.12).
 *
 * Every closed vocabulary is imported from `@foresift/domain` and compiled into
 * a Zod enum — the member lists are never restated here, so SQL, domain, and
 * schema can only drift by editing the domain authority. Every object is
 * `.strict()`: unknown keys are refused, never ignored.
 *
 * Immutability by construction: module-state rows, transitions, activation-gate
 * evaluations, containment/rollback events, dependency/SLA/posture rows, MCP
 * matrix rows, precomputed bounds/reads, and boundary assertions have an INSERT
 * schema only. No update schema is exported anywhere in this module
 * (ADR-0019 immutability duty); a change is a NEW row that supersedes the old.
 *
 * Numeric policy (`packages/shared-schemas/src/data.ts`): monetary amounts cross
 * boundaries as exact decimal digit strings (never JS numbers); timestamps as
 * ISO-8601 UTC strings ending in `Z`; content hashes as `sha256:<hex>`.
 *
 * The persisted §69.5 `scope` JSON object uses snake_case field names
 * (`profile_version`, `policy_version`, `regime_scope`, `execution_scenario`,
 * `delay_policy`, `population_claim`, `requires_proven`) and is the SQL-truth
 * shape; the pure domain law `requiredStatesForActivation` speaks camelCase.
 */
import { z } from 'zod';
import {
  ALL_ACTIVATION_GATE_KINDS,
  ALL_ACTIVATION_GATE_VERDICTS,
  ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
  ALL_CHANGE_CLASSIFICATIONS,
  ALL_CONTAINMENT_ACTIONS,
  ALL_DEPENDENCY_GROUP_IDS,
  ALL_DEPLOYMENT_POSTURES,
  ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS,
  ALL_DISTRIBUTION_READINESS,
  ALL_MCP_CONFORMANCE_RESULTS,
  ALL_MCP_REVISION_CHANNELS,
  ALL_MODULE_LIFECYCLE_POSITIONS,
  ALL_MODULE_LIFECYCLE_STATES,
  ALL_OPERATIONAL_READINESS,
  ALL_PROTECTED_DIMENSIONS,
} from '@foresift/domain';
import { DecimalStringSchema, UtcTimestampSchema } from './data.ts';

export const PROD_SCHEMA_REGISTRY_VERSION = 1 as const;

const id = z.string().min(1);
const contentAddress = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().positive();
const jsonRecord = z.record(z.unknown());
const domainEnum = <T extends string>(values: readonly [T, ...T[]] | readonly T[]) =>
  z.enum([...values] as [T, ...T[]]);

// --- closed vocabularies (mirrors of packages/domain/src/prod.ts) ------------

export const ModuleLifecycleStateSchema = domainEnum(ALL_MODULE_LIFECYCLE_STATES);
export const ModuleLifecyclePositionSchema = domainEnum(ALL_MODULE_LIFECYCLE_POSITIONS);
export const OperationalReadinessSchema = domainEnum(ALL_OPERATIONAL_READINESS);
export const DistributionReadinessSchema = domainEnum(ALL_DISTRIBUTION_READINESS);
export const DeploymentPostureSchema = domainEnum(ALL_DEPLOYMENT_POSTURES);
export const ActivationGateKindSchema = domainEnum(ALL_ACTIVATION_GATE_KINDS);
export const ActivationGateVerdictSchema = domainEnum(ALL_ACTIVATION_GATE_VERDICTS);
export const ChangeClassificationSchema = domainEnum(ALL_CHANGE_CLASSIFICATIONS);
export const ContainmentActionSchema = domainEnum(ALL_CONTAINMENT_ACTIONS);
export const McpRevisionChannelSchema = domainEnum(ALL_MCP_REVISION_CHANNELS);
export const McpConformanceResultSchema = domainEnum(ALL_MCP_CONFORMANCE_RESULTS);
export const ProtectedDimensionSchema = domainEnum(ALL_PROTECTED_DIMENSIONS);
export const DeploymentRelaxableDimensionSchema = domainEnum(ALL_DEPLOYMENT_RELAXABLE_DIMENSIONS);
export const ArtifactBoundaryAssertionKindSchema = domainEnum(
  ALL_ARTIFACT_BOUNDARY_ASSERTION_KINDS,
);
export const DependencyGroupIdSchema = domainEnum(ALL_DEPENDENCY_GROUP_IDS);

/** §40 dependency-group status (build/test ordering, never activation). */
export const DependencyGroupStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED']);

/** §69.6 critical-external-dependency kinds (plan data model). */
export const CriticalDependencyKindSchema = z.enum([
  'PROVIDER',
  'SCHEDULER',
  'OBJECT_STORE',
  'DATABASE',
  'MCP_CLIENT',
  'OTHER',
]);

// --- §69.5 activation scope --------------------------------------------------

/**
 * The exact §69.5 activation scope. `requires_proven` is the scope's explicit
 * statement of whether `PROVEN` is a precondition (AC-152); the activation gate
 * reads it and never infers proof from deployment.
 */
export const ActivationScopeSchema = z
  .object({
    profile_version: id,
    policy_version: id,
    regime_scope: id,
    execution_scenario: id,
    delay_policy: id,
    population_claim: id,
    requires_proven: z.boolean(),
  })
  .strict();

// --- §69.2 governed module state rows ---------------------------------------

/**
 * Append-only, scope-exact module-state row (`prod.module_states`). Rows are
 * never rewritten: a scope/state change inserts a NEW row and sets the old
 * row's `supersededBy` once. `ACTIVE` requires an activation event reference
 * (AC-152), so a deployed module cannot be marked active by declaration.
 */
export const ModuleStateRowSchema = z
  .object({
    stateRowId: id,
    moduleId: id,
    artifactSetHash: contentAddress,
    scope: ActivationScopeSchema,
    lifecycleState: ModuleLifecycleStateSchema,
    operationalReadiness: OperationalReadinessSchema,
    distributionReadiness: DistributionReadinessSchema,
    activationEventRef: id.nullable(),
    supersededBy: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => row.lifecycleState !== 'ACTIVE' || row.activationEventRef !== null, {
    message: 'an ACTIVE module state requires an activation event reference',
  })
  .refine((row) => row.supersededBy === null || row.supersededBy !== row.stateRowId, {
    message: 'a module state row can never supersede itself',
  });

/** Insert-only mirror of the module-state row; no update schema by design. */
export const ModuleStateInsertSchema = ModuleStateRowSchema;

/**
 * Append-only governed transition (`prod.state_transitions`). `fromState` may be
 * the §69.2 seed `NOT_IMPLEMENTED`; a self-transition is refused.
 */
export const StateTransitionRowSchema = z
  .object({
    transitionId: id,
    stateRowId: id,
    fromState: ModuleLifecyclePositionSchema,
    toState: ModuleLifecyclePositionSchema,
    changeClassification: ChangeClassificationSchema,
    gateEvaluationRef: id.nullable(),
    reason: id,
    actorRef: id,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => row.fromState !== row.toState, {
    message: 'a state transition must change state',
  });

/** Insert-only mirror of the transition row; no update schema by design. */
export const StateTransitionInsertSchema = StateTransitionRowSchema;

/**
 * Immutable activation-gate evaluation (`prod.activation_gate_evaluations`).
 * A `PASS` carries no failing gate and a `REFUSE` always names one; the row
 * expires (`expiresAt` strictly after `evaluatedAt`).
 */
export const ActivationGateEvaluationRowSchema = z
  .object({
    evaluationId: id,
    scopeHash: contentAddress,
    gateKind: ActivationGateKindSchema,
    verdict: ActivationGateVerdictSchema,
    failingGate: ActivationGateKindSchema.nullable(),
    evidenceRefs: z.array(id),
    capacityContractRef: id.nullable(),
    evaluatedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => (row.verdict === 'PASS') === (row.failingGate === null), {
    message: 'a refused gate must name a failing gate and a passed gate must not',
  })
  .refine((row) => Date.parse(row.expiresAt) > Date.parse(row.evaluatedAt), {
    message: 'an activation-gate evaluation must expire after it is evaluated',
  });

/** Insert-only mirror of the gate evaluation; no update schema by design. */
export const ActivationGateEvaluationInsertSchema = ActivationGateEvaluationRowSchema;

// --- §69.11 containment and rollback events ---------------------------------

/**
 * Containment event (`prod.containment_events`). `autoReactivationAllowed` is
 * pinned literal `false`: only an explicit revalidation advances a contained
 * scope (AC-278).
 */
export const ContainmentEventRowSchema = z
  .object({
    containmentId: id,
    moduleId: id,
    scopeHash: contentAddress,
    action: ContainmentActionSchema,
    triggerGateKind: ActivationGateKindSchema,
    reason: id,
    autoReactivationAllowed: z.literal(false),
    clearedByEventRef: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();

/** Insert-only mirror of the containment event; no update schema by design. */
export const ContainmentEventInsertSchema = ContainmentEventRowSchema;

/**
 * Rollback event (`prod.rollback_events`). `historyPreserved` is pinned literal
 * `true` and the new activation event is distinct from the prior one (AC-279).
 */
export const RollbackEventRowSchema = z
  .object({
    rollbackId: id,
    moduleId: id,
    restoredArtifactSetHash: contentAddress,
    priorActivationEventRef: id,
    newActivationEventRef: id,
    historyPreserved: z.literal(true),
    candidateReevaluationRef: id,
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => row.newActivationEventRef !== row.priorActivationEventRef, {
    message: 'rollback creates a NEW activation event rather than reusing history',
  });

/** Insert-only mirror of the rollback event; no update schema by design. */
export const RollbackEventInsertSchema = RollbackEventRowSchema;

// --- §40 dependency groups and §69.6 posture declarations --------------------

/**
 * Dependency-group row (`prod.dependency_groups`). Completion is build/test
 * ordering and NEVER automatic opportunity activation, so
 * `activatesOpportunities` is pinned literal `false` (FR-PROD-003, §40).
 */
export const DependencyGroupRowSchema = z
  .object({
    groupId: DependencyGroupIdSchema,
    dependsOn: z.array(DependencyGroupIdSchema),
    status: DependencyGroupStatusSchema,
    manifestRequirementCount: nonNegativeInt,
    evidenceRefs: z.array(id),
    activatesOpportunities: z.literal(false),
    updatedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => !row.dependsOn.includes(row.groupId), {
    message: 'a dependency group can never depend on itself',
  });

/** Insert-only mirror of the dependency-group row; no update schema by design. */
export const DependencyGroupInsertSchema = DependencyGroupRowSchema;

/** Critical-external-dependency register row (`prod.critical_dependencies`). */
export const CriticalDependencyRowSchema = z
  .object({
    dependencyId: id,
    kind: CriticalDependencyKindSchema,
    owner: id,
    critical: z.boolean(),
  })
  .strict();

/** Insert-only mirror of the critical-dependency row; no update schema. */
export const CriticalDependencyInsertSchema = CriticalDependencyRowSchema;

/**
 * SLA register row (`prod.sla_register`). `applicable` and `slaRef` must agree:
 * only an applicable dependency carries an SLA reference.
 */
export const SlaRegisterRowSchema = z
  .object({
    slaId: id,
    dependencyId: id,
    applicable: z.boolean(),
    slaRef: id.nullable(),
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine((row) => row.applicable === (row.slaRef !== null), {
    message: 'an applicable SLA must name its SLA reference and a non-applicable one must not',
  })
  .refine(
    (row) => row.expiresAt === null || Date.parse(row.expiresAt) > Date.parse(row.verifiedAt),
    { message: 'an SLA must expire after it was verified' },
  );

/** Insert-only mirror of the SLA row; no update schema by design. */
export const SlaRegisterInsertSchema = SlaRegisterRowSchema;

/**
 * Best-effort declaration (`prod.best_effort_declarations`). The weakened set is
 * restricted to the relaxable §69.6 dimensions and can never name a protected
 * dimension (AC-153); `SLA_BACKED` declares no weakening.
 */
export const BestEffortDeclarationRowSchema = z
  .object({
    declarationId: id,
    posture: DeploymentPostureSchema,
    degradedScope: jsonRecord,
    missingSlaRefs: z.array(id),
    weakenedDimensions: z.array(DeploymentRelaxableDimensionSchema),
    protectedDimensions: z.array(ProtectedDimensionSchema),
    reason: id,
    declaredAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => !(row.posture === 'SLA_BACKED' && new Set(row.weakenedDimensions).size > 0), {
    message: 'an SLA_BACKED posture declares no weakening',
  });

/** Insert-only mirror of the best-effort declaration; no update schema. */
export const BestEffortDeclarationInsertSchema = BestEffortDeclarationRowSchema;

// --- §69.7 MCP compatibility matrix -----------------------------------------

/**
 * MCP protocol-revision row (`prod.mcp_revisions`). A draft/RC revision can
 * never be the default (§69.7, AC-144).
 */
export const McpRevisionRowSchema = z
  .object({
    revision: id,
    channel: McpRevisionChannelSchema,
    sdkVersion: id,
    transport: id,
    originPolicyRef: id,
    isDefault: z.boolean(),
    supersededBy: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => !row.isDefault || row.channel === 'STABLE', {
    message: 'a draft/RC MCP revision can never be the compatibility default',
  })
  .refine((row) => row.supersededBy === null || row.supersededBy !== row.revision, {
    message: 'an MCP revision can never supersede itself',
  });

/** Insert-only mirror of the MCP revision row; no update schema by design. */
export const McpRevisionInsertSchema = McpRevisionRowSchema;

/** Supported target MCP client (`prod.mcp_target_clients`). */
export const McpTargetClientRowSchema = z
  .object({
    clientId: id,
    clientName: id,
    version: id,
    capabilities: jsonRecord,
    authMode: id,
  })
  .strict();

/** Insert-only mirror of the target-client row; no update schema by design. */
export const McpTargetClientInsertSchema = McpTargetClientRowSchema;

/**
 * Compatibility-matrix cell (`prod.mcp_compatibility_matrix`). A cell carries
 * its conformance fixture, live-test date, and result; `(revision, clientId)`
 * is unique in SQL.
 */
export const McpCompatibilityMatrixRowSchema = z
  .object({
    cellId: id,
    revision: id,
    clientId: id,
    conformanceFixtureRef: id,
    liveTestDate: UtcTimestampSchema,
    result: McpConformanceResultSchema,
    notes: z.string().nullable(),
  })
  .strict();

/** Insert-only mirror of the matrix cell; no update schema by design. */
export const McpCompatibilityMatrixInsertSchema = McpCompatibilityMatrixRowSchema;

/** One recorded conformance run for a revision×client pair. */
export const McpConformanceRunRowSchema = z
  .object({
    runId: id,
    revision: id,
    clientId: id,
    fixtureRef: id,
    result: McpConformanceResultSchema,
    ranAt: UtcTimestampSchema,
  })
  .strict();

/** Insert-only mirror of the conformance run; no update schema by design. */
export const McpConformanceRunInsertSchema = McpConformanceRunRowSchema;

// --- §33.7 bounded precomputed alpha and §10.3/§35.14 boundary ---------------

/**
 * Bounded precomputed-alpha envelope (`prod.precomputed_alpha_bounds`). Every
 * ceiling is REQUIRED and strictly positive — a bound without ceilings is
 * refused, never treated as unbounded.
 */
export const PrecomputedAlphaBoundRowSchema = z
  .object({
    boundId: id,
    livePath: id,
    artifactRef: id,
    artifactSetHash: contentAddress,
    maxCandidates: positiveInt,
    maxRows: positiveInt,
    maxEdges: positiveInt,
    maxLatencyMs: positiveInt,
    maxCostUsd: DecimalStringSchema,
    datasetCutoff: UtcTimestampSchema,
    verifiedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => Date.parse(row.expiresAt) > Date.parse(row.verifiedAt), {
    message: 'a precomputed bound must expire after it was verified',
  });

/** Insert-only mirror of the precomputed bound; no update schema by design. */
export const PrecomputedAlphaBoundInsertSchema = PrecomputedAlphaBoundRowSchema;

/**
 * Live-path precomputed read (`prod.live_path_alpha_reads`). A refused read
 * always records a typed reason; a served read never does (§33.7).
 */
export const LivePathAlphaReadRowSchema = z
  .object({
    readId: id,
    livePath: id,
    boundId: id,
    requestHash: contentAddress,
    served: z.boolean(),
    refusalReason: id.nullable(),
    latencyMs: nonNegativeInt.nullable(),
    readAt: UtcTimestampSchema,
  })
  .strict()
  .refine((row) => row.served === (row.refusalReason === null), {
    message: 'a refused read must record a reason and a served read must not',
  });

/** Insert-only mirror of the live read; no update schema by design. */
export const LivePathAlphaReadInsertSchema = LivePathAlphaReadRowSchema;

/**
 * Live-path artifact-boundary assertion (`prod.artifact_boundary_assertions`).
 * Only `IMPORT_SHADOW_ONLY` references a `sec.import_artifacts` row (§35.14).
 */
export const ArtifactBoundaryAssertionRowSchema = z
  .object({
    assertionId: id,
    livePath: id,
    assertionKind: ArtifactBoundaryAssertionKindSchema,
    importArtifactRef: id.nullable(),
    verdict: ActivationGateVerdictSchema,
    assertedAt: UtcTimestampSchema,
  })
  .strict()
  .refine(
    (row) => (row.assertionKind === 'IMPORT_SHADOW_ONLY') === (row.importArtifactRef !== null),
    { message: 'only an IMPORT_SHADOW_ONLY assertion references an import artifact' },
  );

/** Insert-only mirror of the boundary assertion; no update schema by design. */
export const ArtifactBoundaryAssertionInsertSchema = ArtifactBoundaryAssertionRowSchema;

// --- registry ---------------------------------------------------------------

/**
 * Envelope registry (mirrors the `wf.ts`/`alert.ts` pattern). Names are stable
 * and map one-to-one to the telemetry catalog's data shapes.
 */
export const ProdSchemaRegistry = Object.freeze({
  ActivationScope: ActivationScopeSchema,
  ModuleStateRow: ModuleStateRowSchema,
  ModuleStateInsert: ModuleStateInsertSchema,
  StateTransitionRow: StateTransitionRowSchema,
  StateTransitionInsert: StateTransitionInsertSchema,
  ActivationGateEvaluationRow: ActivationGateEvaluationRowSchema,
  ActivationGateEvaluationInsert: ActivationGateEvaluationInsertSchema,
  ContainmentEventRow: ContainmentEventRowSchema,
  ContainmentEventInsert: ContainmentEventInsertSchema,
  RollbackEventRow: RollbackEventRowSchema,
  RollbackEventInsert: RollbackEventInsertSchema,
  DependencyGroupRow: DependencyGroupRowSchema,
  DependencyGroupInsert: DependencyGroupInsertSchema,
  CriticalDependencyRow: CriticalDependencyRowSchema,
  CriticalDependencyInsert: CriticalDependencyInsertSchema,
  SlaRegisterRow: SlaRegisterRowSchema,
  SlaRegisterInsert: SlaRegisterInsertSchema,
  BestEffortDeclarationRow: BestEffortDeclarationRowSchema,
  BestEffortDeclarationInsert: BestEffortDeclarationInsertSchema,
  McpRevisionRow: McpRevisionRowSchema,
  McpRevisionInsert: McpRevisionInsertSchema,
  McpTargetClientRow: McpTargetClientRowSchema,
  McpTargetClientInsert: McpTargetClientInsertSchema,
  McpCompatibilityMatrixRow: McpCompatibilityMatrixRowSchema,
  McpCompatibilityMatrixInsert: McpCompatibilityMatrixInsertSchema,
  McpConformanceRunRow: McpConformanceRunRowSchema,
  McpConformanceRunInsert: McpConformanceRunInsertSchema,
  PrecomputedAlphaBoundRow: PrecomputedAlphaBoundRowSchema,
  PrecomputedAlphaBoundInsert: PrecomputedAlphaBoundInsertSchema,
  LivePathAlphaReadRow: LivePathAlphaReadRowSchema,
  LivePathAlphaReadInsert: LivePathAlphaReadInsertSchema,
  ArtifactBoundaryAssertionRow: ArtifactBoundaryAssertionRowSchema,
  ArtifactBoundaryAssertionInsert: ArtifactBoundaryAssertionInsertSchema,
});

export type ProdSchemaName = keyof typeof ProdSchemaRegistry;

export function parseProdSchema<T extends ProdSchemaName>(
  name: T,
  input: unknown,
): z.infer<(typeof ProdSchemaRegistry)[T]> {
  return ProdSchemaRegistry[name].parse(input);
}

export type ActivationScope = z.infer<typeof ActivationScopeSchema>;
export type ModuleStateRow = z.infer<typeof ModuleStateRowSchema>;
export type StateTransitionRow = z.infer<typeof StateTransitionRowSchema>;
export type ActivationGateEvaluationRow = z.infer<typeof ActivationGateEvaluationRowSchema>;
export type ContainmentEventRow = z.infer<typeof ContainmentEventRowSchema>;
export type RollbackEventRow = z.infer<typeof RollbackEventRowSchema>;
export type DependencyGroupRow = z.infer<typeof DependencyGroupRowSchema>;
export type CriticalDependencyRow = z.infer<typeof CriticalDependencyRowSchema>;
export type SlaRegisterRow = z.infer<typeof SlaRegisterRowSchema>;
export type BestEffortDeclarationRow = z.infer<typeof BestEffortDeclarationRowSchema>;
export type McpRevisionRow = z.infer<typeof McpRevisionRowSchema>;
export type McpTargetClientRow = z.infer<typeof McpTargetClientRowSchema>;
export type McpCompatibilityMatrixRow = z.infer<typeof McpCompatibilityMatrixRowSchema>;
export type McpConformanceRunRow = z.infer<typeof McpConformanceRunRowSchema>;
export type PrecomputedAlphaBoundRow = z.infer<typeof PrecomputedAlphaBoundRowSchema>;
export type LivePathAlphaReadRow = z.infer<typeof LivePathAlphaReadRowSchema>;
export type ArtifactBoundaryAssertionRow = z.infer<typeof ArtifactBoundaryAssertionRowSchema>;
