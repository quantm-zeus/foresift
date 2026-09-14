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
 *   - `available`   — the scope ever reached `AVAILABLE`/`PROVEN`/`ACTIVE` (a
 *                     shadow-only scope runs without active side effects and is
 *                     still unavailable, and the containment states
 *                     `DEGRADED`/`PAUSED`/`DISABLED`/`RETIRED` never establish it
 *                     by themselves);
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
 * caller's `evaluationSetRef`. The evidence rows can only be written by a
 * recorder that requires the evaluator's module-private provenance brand, so a
 * hand-built PASS object is refused before it can persist anything and can never
 * name evidence that was never persisted. The same transaction additionally
 * refuses ACTIVE while a `prod.containment_events` row on the exact scope is
 * still open (§69.11: only `clearContainment` plus a fresh recorded evaluation
 * reactivates), and refuses replaying an activation event that already backed an
 * ACTIVE row for the scope. It also refuses an unknown/mismatched scope, an illegal
 * lifecycle edge, and any attempt to reuse an existing row id (in-place
 * mutation). Strictly read-only governance: nothing here trades, custodies,
 * signs, or submits.
 */
import { ErrorCode, ForesiftError, isOneOf } from '@foresift/domain';
import {
  ChangeClassification,
  DistributionReadiness,
  ModuleLifecycleState,
  OperationalReadiness,
  ActivationKind,
  ActivationGateKind,
  assertLegalLifecycleTransition,
  parseActivationKind,
  parseChangeClassification,
  parseDistributionReadiness,
  parseModuleLifecycleState,
  parseOperationalReadiness,
  requiredStatesForActivation,
  type ActivationScope,
  type ModuleLifecyclePosition,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  requireActivationResultBrand,
  requirePersistedActivationEvidence,
  type ActivationGateResult,
  type PersistedActivationEvidence,
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

const SCOPE_FIELDS = Object.freeze([
  'profile_version',
  'policy_version',
  'regime_scope',
  'execution_scenario',
  'delay_policy',
  'population_claim',
] as const);

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
  // Numeric-index validation only (audit HIGH): `new Set([...SCOPE_FIELDS, …])`
  // and `for (const key of Object.keys(record))` both read `Symbol.iterator`, so
  // a shadowed iterator would silently SKIP the unknown-key refusal.
  const keys = Object.keys(record);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex] as string;
    if (key !== 'requires_proven' && !isOneOf(key, SCOPE_FIELDS)) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
        `unknown activation scope dimension '${key}'`,
        { key },
      );
    }
  }
  const parsed: Record<string, string | boolean> = {};
  for (let fieldIndex = 0; fieldIndex < SCOPE_FIELDS.length; fieldIndex += 1) {
    const field = SCOPE_FIELDS[fieldIndex] as string;
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
  /** The activation kind that authorized an ACTIVE row (audit C1); null otherwise. */
  readonly activationKind: ActivationKind | null;
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
/**
 * `SHADOW` is deliberately NOT here (audit MEDIUM 6, AC-152): a shadow-only
 * module runs without active opportunity side effects and is still
 * "unavailable", so it must not read as establishing AVAILABLE.
 */
export const ESTABLISHES_AVAILABLE: readonly ModuleLifecyclePosition[] = Object.freeze([
  ModuleLifecycleState.AVAILABLE,
  ModuleLifecycleState.PROVEN,
  ModuleLifecycleState.ACTIVE,
]);
export const ESTABLISHES_PROVEN: readonly ModuleLifecyclePosition[] = Object.freeze([
  ModuleLifecycleState.PROVEN,
]);
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
  activation_kind: string | null;
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
    activationKind: row.activation_kind === null ? null : (row.activation_kind as ActivationKind),
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

/** Numeric-index decode of a driver result set; never `rows.map(...)`. */
function decodeModuleStateRows(rows: readonly RawModuleStateRow[]): ModuleStateRow[] {
  const decoded: ModuleStateRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row !== undefined) decoded[decoded.length] = decodeModuleStateRow(row);
  }
  return decoded;
}

/** Numeric-index decode of a transition result set; never `rows.map(...)`. */
function decodeTransitionRows(rows: readonly RawTransitionRow[]): StateTransitionRow[] {
  const decoded: StateTransitionRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row !== undefined) decoded[decoded.length] = decodeTransitionRow(row);
  }
  return decoded;
}

/**
 * The current (non-superseded) head of an insertion-ordered row list, chosen by
 * a numeric-index walk. `filter`/`find` are shadowable (audit HIGH).
 */
function nonSupersededHead(rows: readonly ModuleStateRow[]): ModuleStateRow | undefined {
  let head: ModuleStateRow | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row !== undefined && row.supersededBy === null) head = row;
  }
  return head;
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
            activation_kind, superseded_by, created_at
       FROM prod.module_states
      WHERE module_id = $1 AND scope = $2::jsonb
      ORDER BY created_at ASC, state_row_id ASC`,
    [input.moduleId, canonicalJson(scope)],
  );
  return decodeModuleStateRows(result.rows);
}

/** The current (non-superseded) row for the exact module + scope, if any. */
export async function currentStateRow(
  engine: DatabaseEngine,
  input: { readonly moduleId: string; readonly scope: ModuleStateScope },
): Promise<ModuleStateRow | undefined> {
  const rows = await stateRowsFor(engine, input);
  return nonSupersededHead(rows);
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
  return decodeTransitionRows(result.rows);
}

/**
 * AC-152: report the three dimensions INDEPENDENTLY for the exact scope. A
 * scope with no governed row is `NOT_IMPLEMENTED` with all three false.
 */
export async function statesFor(
  engine: DatabaseEngine,
  input: { readonly moduleId: string; readonly scope: ModuleStateScope },
): Promise<ModuleStateDimensions> {
  const moduleId = input.moduleId;
  const scope = parseModuleStateScope(input.scope);
  const rows = await stateRowsFor(engine, { moduleId, scope });
  const scopeHash = activationScopeHash(scope);
  if (rows.length === 0) {
    return {
      moduleId: moduleId,
      scope,
      scopeHash,
      lifecycleState: 'NOT_IMPLEMENTED',
      ...EMPTY_DIMENSIONS,
      currentStateRowId: null,
      artifactSetHash: null,
      activationEventRef: null,
    };
  }
  const head = nonSupersededHead(rows) ?? rows[rows.length - 1];
  if (head === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
      'module state chain has no resolvable head',
      { moduleId: moduleId, scopeHash },
    );
  }
  // Numeric-index dimension walks with `isOneOf` only (audit HIGH): the previous
  // `rows.some((row) => ESTABLISHES_AVAILABLE.includes(...))` was shadowable by
  // `some`/`includes`, and `Symbol.iterator` shadows skipped it entirely — so a
  // scope that never established AVAILABLE could read as available and reach
  // PROVEN/ACTIVE (the H5 dimension establishment).
  let available = false;
  let proven = false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    if (isOneOf(row.lifecycleState, ESTABLISHES_AVAILABLE)) available = true;
    if (isOneOf(row.lifecycleState, ESTABLISHES_PROVEN)) proven = true;
  }
  return {
    moduleId: moduleId,
    scope,
    scopeHash,
    lifecycleState: head.lifecycleState,
    implemented: rows.length > 0,
    available,
    proven,
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
  /** §69.11: an open containment forbids ACTIVE on the exact scope. */
  CONTAINMENT_OPEN: 'CONTAINMENT_OPEN',
  /** An activation event that already backed an ACTIVE row was replayed. */
  ACTIVATION_EVENT_ALREADY_CONSUMED: 'ACTIVATION_EVENT_ALREADY_CONSUMED',
  /** A non-empty activation event reference is required for a consumed-once record. */
  ACTIVATION_EVENT_REF_MISSING: 'ACTIVATION_EVENT_REF_MISSING',
  /** A gate PASS claims a dimension the persisted history never established (audit H5). */
  GATE_DIMENSION_MISMATCH: 'GATE_DIMENSION_MISMATCH',
  /** Promotion to PROVEN must name the registered mature-evaluation evidence (audit H5). */
  PROVEN_EVIDENCE_REQUIRED: 'PROVEN_EVIDENCE_REQUIRED',
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
   * The registered mature-evaluation evidence that establishes PROVEN
   * (§69.3; audit H5). REQUIRED exactly when `toState` is `PROVEN`: PROVEN is
   * not a declaration, so a promotion must name the evidence content address it
   * rests on.
   */
  readonly provenEvidenceRef?: string;
  /**
   * The activation event the `provenEvidenceRef` batch was recorded for.
   * REQUIRED exactly when `toState` is `PROVEN`.
   */
  readonly provenEvidenceEventRef?: string;
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
  rawInput: AdvanceStateInput,
): Promise<{ readonly state: ModuleStateRow; readonly transition: StateTransitionRow }> {
  // Single-read binding of every caller field (V7-A2 class). The gate result is
  // kept by reference so its identity brand survives; `scope` is parsed once so
  // a scope accessor cannot present one dimension set to a check and another to
  // the value that is persisted, and `at` cannot be one instant for the
  // staleness comparison and another for the row.
  const scope = parseModuleStateScope(rawInput.scope);
  const input: AdvanceStateInput = Object.freeze({
    moduleId: rawInput.moduleId,
    scope,
    artifactSetHash: rawInput.artifactSetHash,
    toState: rawInput.toState,
    operationalReadiness: rawInput.operationalReadiness,
    distributionReadiness: rawInput.distributionReadiness,
    changeClassification: rawInput.changeClassification,
    reason: rawInput.reason,
    actorRef: rawInput.actorRef,
    at: rawInput.at,
    ...(rawInput.currentStateRowId === undefined
      ? {}
      : { currentStateRowId: rawInput.currentStateRowId }),
    ...(rawInput.gateResult === undefined ? {} : { gateResult: rawInput.gateResult }),
    ...(rawInput.provenEvidenceRef === undefined
      ? {}
      : { provenEvidenceRef: rawInput.provenEvidenceRef }),
    ...(rawInput.provenEvidenceEventRef === undefined
      ? {}
      : { provenEvidenceEventRef: rawInput.provenEvidenceEventRef }),
    ...(rawInput.activationEventRef === undefined
      ? {}
      : { activationEventRef: rawInput.activationEventRef }),
    ...(rawInput.stateRowId === undefined ? {} : { stateRowId: rawInput.stateRowId }),
    ...(rawInput.transitionId === undefined ? {} : { transitionId: rawInput.transitionId }),
  });
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
  // §69.3: PROVEN is established by REGISTERED mature-evaluation evidence, not
  // by declaration (audit H5). The promotion must name the persisted OPPORTUNITY
  // evaluation batch for the exact scope — the batch whose required statistical
  // gates are the mature evaluation — and the activation event it was recorded
  // for. A bare content address is never enough.
  let provenEvidenceRef: string | null = null;
  let provenEvidenceEventRef: string | null = null;
  if (toState === ModuleLifecycleState.PROVEN) {
    const ref = input.provenEvidenceRef;
    const event = input.provenEvidenceEventRef;
    if (
      typeof ref !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(ref) ||
      typeof event !== 'string' ||
      event.trim().length === 0
    ) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        'promotion to PROVEN requires the persisted mature-evaluation evidence set reference and the activation event it was recorded for',
        { reason: ModuleStateRefusalReason.PROVEN_EVIDENCE_REQUIRED, scopeHash },
      );
    }
    provenEvidenceRef = ref;
    provenEvidenceEventRef = event;
  }
  let activationKind: ActivationKind | null = null;
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
    // IDENTITY provenance, not shape (audit C1/H5): the result must be the
    // frozen object the evaluator minted. A hand-built `{verdict:'PASS', …}`
    // therefore cannot cross into ACTIVE even with a derivable evidence ref.
    requireActivationResultBrand(gateResult);
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
    // The kind comes from the BRANDED evaluator object, never from a caller
    // field, and it is persisted on the state row so an OPERATIONAL evaluation
    // is permanently distinguishable from an OPPORTUNITY/WORKSPACE/PUBLIC one.
    activationKind = parseActivationKind(gateResult.activationKind);
    // A readiness claim is subsumed by the kind that was actually evaluated: an
    // OPERATIONAL pass can never authorize workspace/public distribution, and
    // the active-profile readiness requires confirmed-opportunity evidence.
    const distributionAuthorizingKinds: Readonly<Record<string, ActivationKind>> = {
      WORKSPACE_AUTHORIZED: ActivationKind.WORKSPACE,
      PUBLIC_AUTHORIZED: ActivationKind.PUBLIC,
    };
    const requiredDistributionKind = distributionAuthorizingKinds[distributionReadiness];
    if (requiredDistributionKind !== undefined && activationKind !== requiredDistributionKind) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        `entering ACTIVE refused: distribution readiness ${distributionReadiness} requires a ${requiredDistributionKind} activation evaluation, but the gate result was evaluated for ${activationKind}`,
        {
          reason: ModuleStateRefusalReason.ACTIVATION_GATE_REFUSED,
          requiredActivationKind: requiredDistributionKind,
          evaluatedActivationKind: activationKind,
          scopeHash,
        },
      );
    }
    if (
      operationalReadiness === OperationalReadiness.READY_FOR_ACTIVE_PROFILE &&
      activationKind === ActivationKind.OPERATIONAL
    ) {
      throw new ForesiftError(
        ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
        'entering ACTIVE refused: READY_FOR_ACTIVE_PROFILE requires confirmed-opportunity evidence, but the gate result was evaluated for OPERATIONAL activation',
        {
          reason: ModuleStateRefusalReason.ACTIVATION_GATE_REFUSED,
          evaluatedActivationKind: activationKind,
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
    // §69.3: PROVEN is not a declaration. Inside the same transaction, the
    // named promotion evidence must resolve to a persisted, complete, unexpired
    // OPPORTUNITY evaluation batch for the exact scope (audit H5): its required
    // statistical gates ARE the registered mature evaluation, so a fabricated
    // content address can never establish PROVEN.
    if (toState === ModuleLifecycleState.PROVEN && provenEvidenceRef !== null) {
      const provenEvidence = await requirePersistedActivationEvidence(tx, {
        scope,
        scopeHash,
        activationKind: ActivationKind.OPPORTUNITY,
        activationEventRef: provenEvidenceEventRef ?? '',
        evaluationSetRef: provenEvidenceRef,
        at: input.at,
      });
      // §69.2/§69.5 independent dimensions (audit H5 residual): PROVEN is a
      // LATER rung than AVAILABLE, so the same persisted-dimension cross-check
      // the ACTIVE edge applies must bind here too. Without it a scope that
      // never established AVAILABLE could present a fabricated all-PASS
      // OPPORTUNITY batch (caller booleans set available/proven true) to jump
      // SHADOW -> PROVEN and then legitimately cross into ACTIVE. The exact
      // scope must have genuinely established AVAILABLE in governed history.
      const dimensions = await statesFor(tx, { moduleId, scope });
      if (dimensions.available !== true) {
        throw new ForesiftError(
          ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
          'promotion to PROVEN refused: the exact scope never established AVAILABLE in governed history',
          {
            reason: ModuleStateRefusalReason.GATE_DIMENSION_MISMATCH,
            gate: ActivationGateKind.AVAILABLE_EVIDENCE,
            scopeHash,
          },
        );
      }
      // The IMPLEMENTED/AVAILABLE binding reads the PERSISTED rows, never the
      // mutable in-memory evaluator object (audit R1). PROVEN_PRESENT is
      // excluded because THIS transition establishes it.
      const claimedDimensions: readonly [ActivationGateKind, boolean][] = [
        [ActivationGateKind.IMPLEMENTED_PRESENT, dimensions.implemented],
        [ActivationGateKind.AVAILABLE_EVIDENCE, dimensions.available],
      ];
      for (let dimensionIndex = 0; dimensionIndex < claimedDimensions.length; dimensionIndex += 1) {
        const claimed = claimedDimensions[dimensionIndex];
        if (claimed === undefined) continue;
        const gate = claimed[0];
        const established = claimed[1];
        // Numeric scan only (audit HIGH): `provenEvidence.rows.find` is
        // shadowable and a shadowed `find` would hide a forged PASS claim.
        let persisted: PersistedActivationEvidence['rows'][number] | undefined;
        for (let rowIndex = 0; rowIndex < provenEvidence.rows.length; rowIndex += 1) {
          const entry = provenEvidence.rows[rowIndex];
          if (entry !== undefined && entry.gateKind === gate) persisted = entry;
        }
        if (persisted?.verdict === 'PASS' && established !== true) {
          throw new ForesiftError(
            ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
            `promotion to PROVEN refused: the persisted evidence claims ${gate} but the governed history never established it for the exact scope`,
            { reason: ModuleStateRefusalReason.GATE_DIMENSION_MISMATCH, gate, scopeHash },
          );
        }
      }
    }
    // ACTIVE is not a declaration: inside the SAME transaction that writes the
    // row, re-derive the evidence from `prod.activation_gate_evaluations`. A
    // caller-constructed PASS object (even a well-formed one) cannot name rows
    // that were never persisted, so it can never cross into ACTIVE.
    if (crossing && input.gateResult?.verdict === 'PASS') {
      // §69.2/§69.4 independent dimensions (audit H5): a gate PASS may only
      // claim a dimension the exact scope's governed history actually
      // established. A caller boolean can no longer assert IMPLEMENTED /
      // AVAILABLE / PROVEN that no persisted row supports.
      const dimensions = await statesFor(tx, { moduleId, scope });
      // A `requires_proven` scope may NEVER reach ACTIVE unless the exact scope
      // actually reached PROVEN, whatever the gate recorded (audit H5 residual).
      if (scope.requires_proven && dimensions.proven !== true) {
        throw new ForesiftError(
          ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
          'entering ACTIVE refused: the exact scope specifies requires_proven but no persisted PROVEN state exists for it',
          {
            reason: ModuleStateRefusalReason.GATE_DIMENSION_MISMATCH,
            gate: 'PROVEN_PRESENT',
            scopeHash,
          },
        );
      }
      // §69.11: containment is a governed stop, not a suggestion. While a
      // containment event on the EXACT scope is still open, replaying older
      // genuine evidence must not re-activate the scope; the documented sole
      // reactivation path is `clearContainment` plus a fresh recorded
      // evaluation. The read happens in this transaction, alongside the write.
      const openContainment = await tx.query<{ containment_id: string; action: string }>(
        `SELECT containment_id, action
           FROM prod.containment_events
          WHERE module_id = $1 AND scope_hash = $2 AND cleared_by_event_ref IS NULL
          ORDER BY created_at ASC, containment_id ASC
          LIMIT 1`,
        [moduleId, scopeHash],
      );
      const open = openContainment.rows[0];
      if (open !== undefined) {
        throw new ForesiftError(
          ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
          `entering ACTIVE refused: containment ${open.containment_id} (${open.action}) is still open on the exact scope; clearContainment plus a fresh recorded evaluation is the only reactivation path (AC-278)`,
          {
            reason: ModuleStateRefusalReason.CONTAINMENT_OPEN,
            containmentId: open.containment_id,
            containmentAction: open.action,
            scopeHash,
          },
        );
      }
      // An activation event is single-use. If any governed row for the exact
      // scope already reached ACTIVE under this event, the event was consumed and
      // its recorded PASS cannot be replayed (for example from a plain DEGRADED
      // row); a fresh evaluation for a distinct activation event is required.
      // The reference must be non-empty: an empty event ref cannot be singled
      // out as consumed and would let a stale PASS be replayed indefinitely.
      const activationEventRef = input.gateResult.activationEventRef;
      if (typeof activationEventRef !== 'string' || activationEventRef.trim().length === 0) {
        throw new ForesiftError(
          ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
          'entering ACTIVE refused: the activation event reference must be a non-empty identifier so it can be recorded and consumed exactly once',
          { reason: ModuleStateRefusalReason.ACTIVATION_EVENT_REF_MISSING, scopeHash },
        );
      }
      {
        const consumed = await tx.query<{ state_row_id: string }>(
          `SELECT state_row_id
             FROM prod.module_states
            WHERE module_id = $1 AND scope_hash = $2
              AND lifecycle_state = 'ACTIVE'
              AND activation_event_ref = $3
            LIMIT 1`,
          [moduleId, scopeHash, activationEventRef],
        );
        if (consumed.rows.length > 0) {
          throw new ForesiftError(
            ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
            `entering ACTIVE refused: activation event ${JSON.stringify(
              input.gateResult.activationEventRef,
            )} already backed an ACTIVE row for the exact scope; a fresh evaluation for a distinct activation event is required`,
            {
              reason: ModuleStateRefusalReason.ACTIVATION_EVENT_ALREADY_CONSUMED,
              activationEventRef: input.gateResult.activationEventRef,
              scopeHash,
            },
          );
        }
      }
      const persistedEvidence: PersistedActivationEvidence =
        await requirePersistedActivationEvidence(tx, {
          scope,
          scopeHash,
          activationKind: activationKind ?? parseActivationKind(input.gateResult.activationKind),
          activationEventRef: input.gateResult.activationEventRef,
          evaluationSetRef: input.gateResult.evaluationSetRef,
          at: input.at,
        });
      // The IMPLEMENTED/AVAILABLE/PROVEN binding reads the PERSISTED rows, never
      // the mutable in-memory evaluator object (audit R1/T053): a caller that
      // mutates a recorded pass's nested evaluation cannot change what the
      // database recorded.
      const claimedDimensions: readonly [ActivationGateKind, boolean][] = [
        [ActivationGateKind.IMPLEMENTED_PRESENT, dimensions.implemented],
        [ActivationGateKind.AVAILABLE_EVIDENCE, dimensions.available],
        [ActivationGateKind.PROVEN_PRESENT, dimensions.proven],
      ];
      for (let dimensionIndex = 0; dimensionIndex < claimedDimensions.length; dimensionIndex += 1) {
        const claimed = claimedDimensions[dimensionIndex];
        if (claimed === undefined) continue;
        const gate = claimed[0];
        const established = claimed[1];
        // Numeric scan only (audit HIGH): `persistedEvidence.rows.find` is
        // shadowable and a shadowed `find` would hide a forged PASS claim.
        let persisted: PersistedActivationEvidence['rows'][number] | undefined;
        for (let rowIndex = 0; rowIndex < persistedEvidence.rows.length; rowIndex += 1) {
          const entry = persistedEvidence.rows[rowIndex];
          if (entry !== undefined && entry.gateKind === gate) persisted = entry;
        }
        if (persisted?.verdict === 'PASS' && established !== true) {
          throw new ForesiftError(
            ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
            `entering ACTIVE refused: the persisted evidence claims ${gate} but the governed history never established it for the exact scope`,
            { reason: ModuleStateRefusalReason.GATE_DIMENSION_MISMATCH, gate, scopeHash },
          );
        }
      }
    }
    // Insert the NEW row FIRST: `superseded_by` is a foreign key into this very
    // table, so the pointer can only be set once the successor row exists.
    await tx.query(
      `INSERT INTO prod.module_states
         (state_row_id, module_id, artifact_set_hash, scope, scope_hash, lifecycle_state,
          operational_readiness, distribution_readiness, activation_event_ref, activation_kind,
          created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::timestamptz)`,
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
        activationKind,
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
            ? (input.gateResult.evaluationSetRef ?? input.gateResult.activationEventRef)
            : null
          : provenEvidenceRef,
        reason,
        actorRef,
        input.at,
      ],
    );
    const inserted = await tx.query<RawModuleStateRow>(
      `SELECT state_row_id, module_id, artifact_set_hash, scope, lifecycle_state,
              operational_readiness, distribution_readiness, activation_event_ref,
              activation_kind, superseded_by, created_at
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
