/**
 * Scope-exact, append-only module-state registry (T014, FR-PROD-001/002,
 * AC-152; PRD §69.2/§69.3/§69.5; plan D1/D2).
 *
 * `PROD.module_states` is the SQL truth for the §69.2 governed lifecycle: one
 * row per (module, EXACT §69.5 scope) reassessment, never an in-place rewrite.
 * A change supersedes via a NEW row plus the one-time `superseded_by` pointer;
 * the only legal UPDATE in the whole table is that pointer, and the migration
 * trigger refuses every other mutation. `PROD.state_transitions` is the
 * append-only reason log; no UPDATE/DELETE path exists at all.
 *
 * `statesFor(module, scope)` reports `implemented`, `available`, and `proven`
 * as three INDEPENDENT dimensions (FR-PROD-001). Each is established by the
 * distinct lifecycle positions the exact scope has ever occupied:
 *   - `implemented` — any governed row exists for the scope;
 *   - `available`   — the scope ever reached `AVAILABLE`/`SHADOW`/`PROVEN`/
 *                     `ACTIVE` (the containment states `DEGRADED`/`PAUSED`/
 *                     `DISABLED`/`RETIRED` never establish it by themselves);
 *   - `proven`      — the scope ever reached `PROVEN` (the only position that
 *                     attests registered proof).
 * A module can therefore be deployed (`IMPLEMENTED`) while unavailable, and
 * available while unproven.
 *
 * `advanceState` refuses a transition that crosses the activation gate
 * (entering `ACTIVE`) without a passing total gate result for the SAME exact
 * scope, and — inside the writing transaction — without a COMPLETE, unexpired,
 * all-PASS set of PERSISTED `prod.activation_gate_evaluations` rows for that
 * scope and activation event whose deterministic evidence reference matches the
 * caller's `evaluationSetRef`. A hand-built PASS object can never name evidence
 * that was never persisted. It also refuses an unknown/mismatched scope, an
 * illegal lifecycle edge, and any attempt to reuse an existing row id (in-place
 * mutation). Strictly read-only governance: nothing here trades, custodies,
 * signs, or submits.
 */
import { ErrorCode, ForesiftError } from '@foresift/domain';
import {
  ChangeClassification,
  DistributionReadiness,
  ModuleLifecycleState,
  OperationalReadiness,
  assertLegalLifecycleTransition,
  parseChangeClassification,
  parseDistributionReadiness,
  parseModuleLifecycleState,
  parseOperationalReadiness,
  requiredStatesForActivation,
  type ActivationScope,
  type ActivationGateKind,
  type ModuleLifecyclePosition,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  requirePersistedActivationEvidence,
  type ActivationGateResult,
} from './activation-gate.ts';

// Re-export the domain values under the registry's local naming so callers can
// construct an `ActivationScope` without importing the domain package twice.
export type RegistryActivationScope = ActivationScope;

// --- scope -----------------------------------------------------------------

/**
 * The persisted §69.5 scope shape (snake_case is SQL truth; the pure domain law
 * speaks camelCase). Every field is required: a scope with a missing dimension
 * is not the same scope and must not be silently coerced.
 */
export interface ModuleStateScope {
  readonly profile_version: string;
  readonly policy_version: string;
  readonly regime_scope: string;
  readonly execution_scenario: string;
  readonly delay_policy: string;
  readonly population_claim: string;
  readonly requires_proven: boolean;
}

const SCOPE_FIELDS = [
  'profile_version',
  'policy_version',
  'regime_scope',
  'execution_scenario',
  'delay_policy',
  'population_claim',
] as const;

/**
 * Total fail-closed scope parser. Unknown/missing/non-string dimensions and
 * unknown extra keys refuse with `PROD_ACTIVATION_SCOPE_INVALID`: an inexact
 * scope must never hash-match a governed row.
 */
export function parseModuleStateScope(value: unknown): ModuleStateScope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'activation scope must be an object with exactly the §69.5 dimensions',
      { value: typeof value === 'string' ? value : null },
    );
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set<string>([...SCOPE_FIELDS, 'requires_proven']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
        `unknown activation scope dimension '${key}'`,
        { key },
      );
    }
  }
  const parsed: Record<string, string | boolean> = {};
  for (const field of SCOPE_FIELDS) {
    const dimension = record[field];
    if (typeof dimension !== 'string' || dimension.length === 0) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
        `activation scope dimension '${field}' must be a non-empty string`,
        { field, value: typeof dimension === 'string' ? dimension : null },
      );
    }
    parsed[field] = dimension;
  }
  if (typeof record.requires_proven !== 'boolean') {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'activation scope dimension requires_proven must be a boolean',
      { field: 'requires_proven' },
    );
  }
  parsed.requires_proven = record.requires_proven;
  return parsed as unknown as ModuleStateScope;
}

/** The exact-scope identity: `sha256:<hex>` over the canonical §69.5 scope. */
export function activationScopeHash(scope: unknown): string {
  return sha256Text(canonicalJson(parseModuleStateScope(scope)));
}

/** Persisted snake_case scope → the pure camelCase domain `ActivationScope`. */
export function toDomainActivationScope(scope: ModuleStateScope): ActivationScope {
  return {
    profileVersion: scope.profile_version,
    policyVersion: scope.policy_version,
    regimeScope: scope.regime_scope,
    executionScenario: scope.execution_scenario,
    delayPolicy: scope.delay_policy,
    populationClaim: scope.population_claim,
    requiresProven: scope.requires_proven,
  };
}

/** The pure camelCase domain `ActivationScope` → the persisted snake_case row. */
export function fromDomainActivationScope(scope: ActivationScope): ModuleStateScope {
  return parseModuleStateScope({
    profile_version: scope.profileVersion,
    policy_version: scope.policyVersion,
    regime_scope: scope.regimeScope,
    execution_scenario: scope.executionScenario,
    delay_policy: scope.delayPolicy,
    population_claim: scope.populationClaim,
    requires_proven: scope.requiresProven,
  });
}

/**
 * §69.5 ordered prerequisites for the exact scope and the scheduled gate set.
 * Delegates to the authoritative domain law (conditional `PROVEN`, ordered
 * `IMPLEMENTED` → `AVAILABLE`), so the registry never restates the sequence.
 */
export function activationPrerequisites(
  scope: ModuleStateScope,
  gates: readonly ActivationGateKind[],
): readonly ModuleLifecycleState[] {
  return requiredStatesForActivation(toDomainActivationScope(scope), gates);
}

// --- row shapes -------------------------------------------------------------

/** One persisted `prod.module_states` row. */
export interface ModuleStateRow {
  readonly stateRowId: string;
  readonly moduleId: string;
  readonly artifactSetHash: string;
  readonly scope: ModuleStateScope;
  readonly lifecycleState: ModuleLifecyclePosition;
  readonly operationalReadiness: OperationalReadiness;
  readonly distributionReadiness: DistributionReadiness;
  readonly activationEventRef: string | null;
  readonly supersededBy: string | null;
  readonly createdAt: string;
}

/** One persisted `prod.state_transitions` row. */
export interface StateTransitionRow {
  readonly transitionId: string;
  readonly stateRowId: string;
  readonly fromState: ModuleLifecyclePosition;
  readonly toState: ModuleLifecycleState;
  readonly changeClassification: ChangeClassification;
  readonly gateEvaluationRef: string | null;
  readonly reason: string;
  readonly actorRef: string;
  readonly createdAt: string;
}

/** The three independent FR-PROD-001 dimensions for one exact scope. */
export interface ModuleStateDimensions {
  readonly moduleId: string;
  readonly scope: ModuleStateScope;
  readonly scopeHash: string;
  /** The position the scope currently occupies; `NOT_IMPLEMENTED` when absent. */
  readonly lifecycleState: ModuleLifecyclePosition;
  readonly implemented: boolean;
  readonly available: boolean;
  readonly proven: boolean;
  readonly currentStateRowId: string | null;
  readonly artifactSetHash: string | null;
  readonly activationEventRef: string | null;
}

/** The positions that establish each dimension (independent, never ranked). */
const ESTABLISHES_AVAILABLE: readonly ModuleLifecyclePosition[] = [
  ModuleLifecycleState.AVAILABLE,
  ModuleLifecycleState.SHADOW,
  ModuleLifecycleState.PROVEN,
  ModuleLifecycleState.ACTIVE,
];
const ESTABLISHES_PROVEN: readonly ModuleLifecyclePosition[] = [ModuleLifecycleState.PROVEN];

const EMPTY_DIMENSIONS = {
  implemented: false,
  available: false,
  proven: false,
} as const;

// --- row mapping ------------------------------------------------------------

interface RawModuleStateRow {
  state_row_id: string;
  module_id: string;
  artifact_set_hash: string;
  scope: unknown;
  lifecycle_state: string;
  operational_readiness: string;
  distribution_readiness: string;
  activation_event_ref: string | null;
  superseded_by: string | null;
  created_at: unknown;
}

interface RawTransitionRow {
  transition_id: string;
  state_row_id: string;
  from_state: string;
  to_state: string;
  change_classification: string;
  gate_evaluation_ref: string | null;
  reason: string;
  actor_ref: string;
  created_at: unknown;
}

/** Normalize a driver timestamp (Date or ISO string) to an ISO UTC string. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function decodeScope(value: unknown): ModuleStateScope {
  return parseModuleStateScope(typeof value === 'string' ? JSON.parse(value) : value);
}

function decodeModuleStateRow(row: RawModuleStateRow): ModuleStateRow {
  return {
    stateRowId: row.state_row_id,
    moduleId: row.module_id,
    artifactSetHash: row.artifact_set_hash,
    scope: decodeScope(row.scope),
    lifecycleState: row.lifecycle_state as ModuleLifecyclePosition,
    operationalReadiness: row.operational_readiness as OperationalReadiness,
    distributionReadiness: row.distribution_readiness as DistributionReadiness,
    activationEventRef: row.activation_event_ref,
    supersededBy: row.superseded_by,
    createdAt: toIso(row.created_at),
  };
}

function decodeTransitionRow(row: RawTransitionRow): StateTransitionRow {
  return {
    transitionId: row.transition_id,
    stateRowId: row.state_row_id,
    fromState: row.from_state as ModuleLifecyclePosition,
    toState: row.to_state as ModuleLifecycleState,
    changeClassification: row.change_classification as ChangeClassification,
    gateEvaluationRef: row.gate_evaluation_ref,
    reason: row.reason,
    actorRef: row.actor_ref,
    createdAt: toIso(row.created_at),
  };
}

// --- reads ------------------------------------------------------------------

/** Every governed row for the exact module + scope, insertion order. */
export async function stateRowsFor(
  engine: DatabaseEngine,
  input: { readonly moduleId: string; readonly scope: ModuleStateScope },
): Promise<readonly ModuleStateRow[]> {
  const scope = parseModuleStateScope(input.scope);
  const result = await engine.query<RawModuleStateRow>(
    `SELECT state_row_id, module_id, artifact_set_hash, scope, lifecycle_state,
            operational_readiness, distribution_readiness, activation_event_ref,
            superseded_by, created_at
       FROM prod.module_states
      WHERE module_id = $1 AND scope = $2::jsonb
      ORDER BY created_at ASC, state_row_id ASC`,
    [input.moduleId, canonicalJson(scope)],
  );
  return result.rows.map(decodeModuleStateRow);
}

/** The current (non-superseded) row for the exact module + scope, if any. */
export async function currentStateRow(
  engine: DatabaseEngine,
  input: { readonly moduleId: string; readonly scope: ModuleStateScope },
): Promise<ModuleStateRow | undefined> {
  const rows = await stateRowsFor(engine, input);
  const heads = rows.filter((row) => row.supersededBy === null);
  if (heads.length === 0) return undefined;
  return heads[heads.length - 1];
}

/** The append-only transition log for one state row, insertion order. */
export async function transitionsForStateRow(
  engine: DatabaseEngine,
  stateRowId: string,
): Promise<readonly StateTransitionRow[]> {
  const result = await engine.query<RawTransitionRow>(
    `SELECT transition_id, state_row_id, from_state, to_state, change_classification,
            gate_evaluation_ref, reason, actor_ref, created_at
       FROM prod.state_transitions
      WHERE state_row_id = $1
      ORDER BY created_at ASC, transition_id ASC`,
    [stateRowId],
  );
  return result.rows.map(decodeTransitionRow);
}

/**
 * AC-152: report the three dimensions INDEPENDENTLY for the exact scope. A
 * scope with no governed row is `NOT_IMPLEMENTED` with all three false.
 */
export async function statesFor(
  engine: DatabaseEngine,
  input: { readonly moduleId: string; readonly scope: ModuleStateScope },
): Promise<ModuleStateDimensions> {
  const scope = parseModuleStateScope(input.scope);
  const rows = await stateRowsFor(engine, { moduleId: input.moduleId, scope });
  const scopeHash = activationScopeHash(scope);
  if (rows.length === 0) {
    return {
      moduleId: input.moduleId,
      scope,
      scopeHash,
      lifecycleState: 'NOT_IMPLEMENTED',
      ...EMPTY_DIMENSIONS,
      currentStateRowId: null,
      artifactSetHash: null,
      activationEventRef: null,
    };
  }
  const heads = rows.filter((row) => row.supersededBy === null);
  const head = heads.length === 0 ? rows[rows.length - 1] : heads[heads.length - 1];
  if (head === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
      'module state chain has no resolvable head',
      { moduleId: input.moduleId, scopeHash },
    );
  }
  return {
    moduleId: input.moduleId,
    scope,
    scopeHash,
    lifecycleState: head.lifecycleState,
    implemented: rows.length > 0,
    available: rows.some((row) => ESTABLISHES_AVAILABLE.includes(row.lifecycleState)),
    proven: rows.some((row) => ESTABLISHES_PROVEN.includes(row.lifecycleState)),
    currentStateRowId: head.stateRowId,
    artifactSetHash: head.artifactSetHash,
    activationEventRef: head.activationEventRef,
  };
}

// --- writes -----------------------------------------------------------------

/** Refusal reasons for append-only registry writes (closed vocabulary). */
export const ModuleStateRefusalReason = {
  IN_PLACE_MUTATION_REFUSED: 'IN_PLACE_MUTATION_REFUSED',
  SCOPE_MISMATCH_REFUSED: 'SCOPE_MISMATCH_REFUSED',
  ACTIVATION_GATE_RESULT_REQUIRED: 'ACTIVATION_GATE_RESULT_REQUIRED',
  ACTIVATION_GATE_REFUSED: 'ACTIVATION_GATE_REFUSED',
  CONCURRENT_SUPERSEDE_RACE: 'CONCURRENT_SUPERSEDE_RACE',
} as const;
export type ModuleStateRefusalReason =
  (typeof ModuleStateRefusalReason)[keyof typeof ModuleStateRefusalReason];

/** Input for one append-only state advance. */
export interface AdvanceStateInput {
  readonly moduleId: string;
  readonly scope: ModuleStateScope;
  readonly artifactSetHash: string;
  readonly toState: ModuleLifecycleState;
  readonly operationalReadiness: OperationalReadiness;
  readonly distributionReadiness: DistributionReadiness;
  readonly changeClassification: ChangeClassification;
  readonly reason: string;
  readonly actorRef: string;
  readonly at: string;
  /**
   * The exact current row this advance supersedes. When supplied it is
   * verified to belong to the SAME exact scope; a mismatch refuses rather than
   * silently forking a new chain.
   */
  readonly currentStateRowId?: string;
  /** Total activation-gate result; REQUIRED exactly when crossing into ACTIVE. */
  readonly gateResult?: ActivationGateResult | null;
  /**
   * Explicit activation-event reference for a non-gate-crossing append (for
   * example a rollback's NEW activation event). Defaults to the current row's.
   */
  readonly activationEventRef?: string | null;
  /** Optional explicit ids; derived deterministically from the input otherwise. */
  readonly stateRowId?: string;
  readonly transitionId?: string;
}

/** True when a lifecycle edge crosses the §69.4/§69.5 activation gate. */
export function crossesActivationGate(
  _from: ModuleLifecyclePosition,
  to: ModuleLifecycleState,
): boolean {
  return to === ModuleLifecycleState.ACTIVE;
}

function requireText(value: unknown, field: string, code: ErrorCode): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ForesiftError(code, `${field} must be a non-empty string`, { field });
  }
  return value;
}

function deriveId(prefix: string, payload: unknown): string {
  return `${prefix}-${sha256Text(canonicalJson(payload)).slice('sha256:'.length, 32 + 'sha256:'.length)}`;
}

/**
 * Append one governed state advance. The previous row is superseded (one-time
 * pointer) and a NEW row plus transition row are inserted in ONE transaction;
 * the old row's identity, scope, state, readiness, activation ref, and
 * timestamp are never rewritten.
 */
export async function advanceState(
  engine: DatabaseEngine,
  input: AdvanceStateInput,
): Promise<{ readonly state: ModuleStateRow; readonly transition: StateTransitionRow }> {
  const scope = parseModuleStateScope(input.scope);
  const scopeHash = activationScopeHash(scope);
  const moduleId = requireText(input.moduleId, 'moduleId', ErrorCode.PROD_ACTIVATION_SCOPE_INVALID);
  const artifactSetHash = requireText(
    input.artifactSetHash,
    'artifactSetHash',
    ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
  );
  const reason = requireText(input.reason, 'reason', ErrorCode.PROD_ACTIVATION_SCOPE_INVALID);
  const actorRef = requireText(input.actorRef, 'actorRef', ErrorCode.PROD_ACTIVATION_SCOPE_INVALID);
  if (!/^sha256:[0-9a-f]{64}$/.test(artifactSetHash)) {
    throw new ForesiftError(
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
      'artifactSetHash must be a sha256 content address',
      { artifactSetHash },
    );
  }
  const toState = parseModuleLifecycleState(input.toState);
  const operationalReadiness = parseOperationalReadiness(input.operationalReadiness);
  const distributionReadiness = parseDistributionReadiness(input.distributionReadiness);
  const changeClassification = parseChangeClassification(input.changeClassification);

  const current = await currentStateRow(engine, { moduleId, scope });
  if (input.currentStateRowId !== undefined) {
    if (current === undefined || current.stateRowId !== input.currentStateRowId) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
        'the supplied current state row does not match the exact module scope',
        {
          reason: ModuleStateRefusalReason.SCOPE_MISMATCH_REFUSED,
          moduleId,
          scopeHash,
          currentStateRowId: input.currentStateRowId,
        },
      );
    }
  }
  const fromState: ModuleLifecyclePosition = current?.lifecycleState ?? 'NOT_IMPLEMENTED';
  if (current === undefined && fromState !== 'NOT_IMPLEMENTED') {
    throw new ForesiftError(
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
      'unknown scope: no governed state exists for the exact module scope',
      { moduleId, scopeHash, from: fromState, to: toState },
    );
  }
  // A mismatched supplied gate result (different scope) refuses before any write.
  if (input.gateResult != null && input.gateResult.scopeHash !== scopeHash) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'the activation gate result was evaluated for a different exact scope',
      {
        reason: ModuleStateRefusalReason.SCOPE_MISMATCH_REFUSED,
        expectedScopeHash: scopeHash,
        suppliedScopeHash: input.gateResult.scopeHash,
      },
    );
  }
  const crossing = crossesActivationGate(fromState, toState);
  if (crossing) {
    const gateResult = input.gateResult;
    if (gateResult == null) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        'entering ACTIVE requires a passing total activation-gate result',
        {
          reason: ModuleStateRefusalReason.ACTIVATION_GATE_RESULT_REQUIRED,
          failingGate: null,
          scopeHash,
        },
      );
    }
    if (gateResult.verdict !== 'PASS') {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        `entering ACTIVE refused by gate ${gateResult.failingGate}`,
        {
          reason: ModuleStateRefusalReason.ACTIVATION_GATE_REFUSED,
          failingGate: gateResult.failingGate,
          scopeHash,
        },
      );
    }
  }
  assertLegalLifecycleTransition(fromState, toState);

  const stateRowId =
    input.stateRowId ??
    deriveId('state', {
      moduleId,
      scopeHash,
      artifactSetHash,
      toState,
      at: input.at,
      actorRef,
      reason,
    });
  const transitionId =
    input.transitionId ??
    deriveId('transition', {
      stateRowId,
      fromState,
      toState,
      classification: changeClassification,
      at: input.at,
      actorRef,
    });
  const activationEventRef = crossing
    ? input.gateResult?.verdict === 'PASS'
      ? input.gateResult.activationEventRef
      : null
    : input.activationEventRef !== undefined
      ? input.activationEventRef
      : (current?.activationEventRef ?? null);

  return engine.transaction(async (tx) => {
    const existing = await tx.query<{ state_row_id: string }>(
      `SELECT state_row_id FROM prod.module_states WHERE state_row_id = $1`,
      [stateRowId],
    );
    if (existing.rows.length > 0) {
      throw new ForesiftError(
        ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
        'module states are append-only: an existing row can never be overwritten',
        {
          reason: ModuleStateRefusalReason.IN_PLACE_MUTATION_REFUSED,
          stateRowId,
        },
      );
    }
    // ACTIVE is not a declaration: inside the SAME transaction that writes the
    // row, re-derive the evidence from `prod.activation_gate_evaluations`. A
    // caller-constructed PASS object (even a well-formed one) cannot name rows
    // that were never persisted, so it can never cross into ACTIVE.
    if (crossing && input.gateResult?.verdict === 'PASS') {
      await requirePersistedActivationEvidence(tx, {
        scope,
        scopeHash,
        activationKind: input.gateResult.activationKind,
        activationEventRef: input.gateResult.activationEventRef,
        evaluationSetRef: input.gateResult.evaluationSetRef,
        at: input.at,
      });
    }
    // Insert the NEW row FIRST: `superseded_by` is a foreign key into this very
    // table, so the pointer can only be set once the successor row exists.
    await tx.query(
      `INSERT INTO prod.module_states
         (state_row_id, module_id, artifact_set_hash, scope, scope_hash, lifecycle_state,
          operational_readiness, distribution_readiness, activation_event_ref, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::timestamptz)`,
      [
        stateRowId,
        moduleId,
        artifactSetHash,
        canonicalJson(scope),
        scopeHash,
        toState,
        operationalReadiness,
        distributionReadiness,
        activationEventRef,
        input.at,
      ],
    );
    if (current !== undefined) {
      const superseded = await tx.query<{ state_row_id: string }>(
        `UPDATE prod.module_states
            SET superseded_by = $1
          WHERE state_row_id = $2 AND superseded_by IS NULL
          RETURNING state_row_id`,
        [stateRowId, current.stateRowId],
      );
      if (superseded.rows.length !== 1) {
        throw new ForesiftError(
          ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
          'concurrent supersede raced: the current state row was already superseded',
          {
            reason: ModuleStateRefusalReason.CONCURRENT_SUPERSEDE_RACE,
            stateRowId: current.stateRowId,
          },
        );
      }
    }
    await tx.query(
      `INSERT INTO prod.state_transitions
         (transition_id, state_row_id, from_state, to_state, change_classification,
          gate_evaluation_ref, reason, actor_ref, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
      [
        transitionId,
        stateRowId,
        fromState,
        toState,
        changeClassification,
        crossing
          ? input.gateResult?.verdict === 'PASS'
            ? input.gateResult.activationEventRef
            : null
          : null,
        reason,
        actorRef,
        input.at,
      ],
    );
    const inserted = await tx.query<RawModuleStateRow>(
      `SELECT state_row_id, module_id, artifact_set_hash, scope, lifecycle_state,
              operational_readiness, distribution_readiness, activation_event_ref,
              superseded_by, created_at
         FROM prod.module_states WHERE state_row_id = $1`,
      [stateRowId],
    );
    const transition = await tx.query<RawTransitionRow>(
      `SELECT transition_id, state_row_id, from_state, to_state, change_classification,
              gate_evaluation_ref, reason, actor_ref, created_at
         FROM prod.state_transitions WHERE transition_id = $1`,
      [transitionId],
    );
    const stateRow = inserted.rows[0];
    const transitionRow = transition.rows[0];
    if (stateRow === undefined || transitionRow === undefined) {
      throw new ForesiftError(
        ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
        'state advance did not persist the requested row',
        { stateRowId, transitionId },
      );
    }
    return {
      state: decodeModuleStateRow(stateRow),
      transition: decodeTransitionRow(transitionRow),
    };
  });
}
