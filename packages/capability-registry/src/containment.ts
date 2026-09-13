/**
 * Smallest-scope containment and additive rollback (T017, FR-PROD-002,
 * AC-278/279; PRD §69.11/§69.12; plan D7).
 *
 * `containForFailedGate` maps a failed CRITICAL gate (security, parity,
 * leakage, rights, capacity, recovery, calibration, adversarial, claims) to a
 * deterministic `DEGRADED`/`PAUSED`/`DISABLED` containment on the SMALLEST
 * affected exact scope, records the reason, appends the governed state change,
 * and refuses any automatic reactivation: `auto_reactivation_allowed` is pinned
 * false in SQL, and only an explicit revalidation event can clear the row via
 * the one-time `cleared_by_event_ref` pointer (AC-278).
 *
 * `rollbackToApproved` restores a previously approved IMMUTABLE
 * configuration/artifact set, appends a NEW activation event (the SQL unique
 * constraint forbids reusing one), preserves every historical decision (all
 * writes are additive), and blocks alert resumption until the targeted
 * candidate re-evaluation completes (AC-279).
 *
 * Strictly read-only: containment and rollback are governance records over
 * already-approved read-only behaviour — never execution, custody, signing, or
 * transaction submission.
 */
import {
  ContainmentAction,
  ErrorCode,
  ForesiftError,
  legalLifecycleTransition,
  parseContainmentAction,
  parseModuleLifecycleState,
  type ChangeClassification,
  type ModuleLifecycleState,
} from '@foresift/domain';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import {
  activationScopeHash,
  advanceState,
  currentStateRow,
  parseModuleStateScope,
  statesFor,
  type ModuleStateDimensions,
  type ModuleStateRow,
  type ModuleStateScope,
} from './module-states.ts';
import type { OpenContainmentFact } from './activation-gate.ts';

// --- critical gate vocabulary ----------------------------------------------

/** The AC-278 critical gates whose failure must contain the affected scope. */
export const CriticalGateKind = {
  SECURITY: 'SECURITY',
  PARITY: 'PARITY',
  LEAKAGE: 'LEAKAGE',
  RIGHTS: 'RIGHTS',
  CAPACITY: 'CAPACITY',
  RECOVERY: 'RECOVERY',
  CALIBRATION: 'CALIBRATION',
  ADVERSARIAL: 'ADVERSARIAL',
  CLAIMS: 'CLAIMS',
} as const;
export type CriticalGateKind = (typeof CriticalGateKind)[keyof typeof CriticalGateKind];
export const ALL_CRITICAL_GATE_KINDS: readonly CriticalGateKind[] = Object.values(CriticalGateKind);

/**
 * Deterministic critical gate → containment action. Hard safety failures
 * (`DISABLED`), evaluation/continuity failures (`PAUSED`), and pressure
 * failures (`DEGRADED`) are separated so a capacity breach cannot disable a
 * safe module and a security incident cannot merely degrade it.
 */
export const CONTAINMENT_ACTION_FOR_CRITICAL_GATE: Readonly<
  Record<CriticalGateKind, ContainmentAction>
> = {
  SECURITY: ContainmentAction.DISABLED,
  PARITY: ContainmentAction.PAUSED,
  LEAKAGE: ContainmentAction.DISABLED,
  RIGHTS: ContainmentAction.DISABLED,
  CAPACITY: ContainmentAction.DEGRADED,
  RECOVERY: ContainmentAction.PAUSED,
  CALIBRATION: ContainmentAction.DEGRADED,
  ADVERSARIAL: ContainmentAction.DISABLED,
  CLAIMS: ContainmentAction.DISABLED,
};

const CONTAINMENT_ESCALATION: Readonly<Record<ContainmentAction, number>> = {
  DEGRADED: 0,
  PAUSED: 1,
  DISABLED: 2,
};

function parseCriticalGate(value: unknown): CriticalGateKind {
  if (typeof value === 'string' && (ALL_CRITICAL_GATE_KINDS as readonly string[]).includes(value)) {
    return value as CriticalGateKind;
  }
  throw new ForesiftError(
    ErrorCode.PROD_CONTAINMENT_ACTION_UNKNOWN,
    'unknown critical gate for containment',
    { value: typeof value === 'string' ? value : null },
  );
}

/** The strictly stronger of two containment actions (never de-escalates). */
export function escalateContainmentAction(
  left: ContainmentAction,
  right: ContainmentAction,
): ContainmentAction {
  return CONTAINMENT_ESCALATION[left] >= CONTAINMENT_ESCALATION[right] ? left : right;
}

// --- smallest affected scope ------------------------------------------------

/** A wildcard scope dimension matches every concrete value. */
export const SCOPE_WILDCARD = '*' as const;

/**
 * A candidate scope the failed gate may affect. A scope with FEWER wildcard
 * dimensions is smaller (more specific) and therefore preferred.
 */
export interface ContainmentScopeCandidate {
  readonly moduleId: string;
  readonly scope: ModuleStateScope;
}

/** Number of concrete (non-wildcard) dimensions; higher means smaller scope. */
export function scopeSpecificity(scope: ModuleStateScope): number {
  const parsed = parseModuleStateScope(scope);
  return [
    parsed.profile_version,
    parsed.policy_version,
    parsed.regime_scope,
    parsed.execution_scenario,
    parsed.delay_policy,
    parsed.population_claim,
  ].filter((dimension) => dimension !== SCOPE_WILDCARD).length;
}

/**
 * The SMALLEST affected scope: the candidate with the most concrete dimensions
 * (fewest wildcards). Ties break deterministically by (specificity DESC,
 * scopeHash ASC, moduleId ASC) so containment never widens by accident.
 */
export function smallestAffectedScope(
  candidates: readonly ContainmentScopeCandidate[],
): ContainmentScopeCandidate {
  if (candidates.length === 0) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'containment requires at least one affected scope candidate',
      {},
    );
  }
  const ranked = candidates
    .map((candidate) => {
      const scope = parseModuleStateScope(candidate.scope);
      return {
        candidate: { moduleId: candidate.moduleId, scope },
        specificity: scopeSpecificity(scope),
        scopeHash: activationScopeHash(scope),
      };
    })
    .sort((a, b) => {
      if (b.specificity !== a.specificity) return b.specificity - a.specificity;
      if (a.scopeHash !== b.scopeHash) return a.scopeHash < b.scopeHash ? -1 : 1;
      return a.candidate.moduleId < b.candidate.moduleId ? -1 : 1;
    });
  const winner = ranked[0];
  if (winner === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'containment could not resolve an affected scope',
      {},
    );
  }
  return winner.candidate;
}

// --- containment rows -------------------------------------------------------

/** One persisted `prod.containment_events` row. */
export interface ContainmentEventRow {
  readonly containmentId: string;
  readonly moduleId: string;
  readonly scopeHash: string;
  readonly action: ContainmentAction;
  readonly triggerGateKind: string;
  readonly reason: string;
  readonly autoReactivationAllowed: false;
  readonly clearedByEventRef: string | null;
  readonly createdAt: string;
}

interface RawContainmentRow {
  containment_id: string;
  module_id: string;
  scope_hash: string;
  action: string;
  trigger_gate_kind: string;
  reason: string;
  auto_reactivation_allowed: boolean;
  cleared_by_event_ref: string | null;
  created_at: unknown;
}

function decodeContainmentRow(row: RawContainmentRow): ContainmentEventRow {
  return {
    containmentId: row.containment_id,
    moduleId: row.module_id,
    scopeHash: row.scope_hash,
    action: parseContainmentAction(row.action),
    triggerGateKind: row.trigger_gate_kind,
    reason: row.reason,
    autoReactivationAllowed: row.auto_reactivation_allowed as false,
    clearedByEventRef: row.cleared_by_event_ref,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/**
 * Map a critical gate to the `prod.activation_gate_evaluations.gate_kind`
 * vocabulary. The containment row references the gate family the failed
 * critical gate belongs to; it never invents a new gate name.
 */
export const CRITICAL_GATE_TO_ACTIVATION_GATE: Readonly<Record<CriticalGateKind, string>> = {
  SECURITY: 'VERIFIED_GATE_EVIDENCE',
  PARITY: 'VERIFIED_GATE_EVIDENCE',
  LEAKAGE: 'NEGATIVE_CONTROLS',
  RIGHTS: 'DISTRIBUTION_EVIDENCE',
  CAPACITY: 'CAPACITY_CONTRACT',
  RECOVERY: 'VERIFIED_GATE_EVIDENCE',
  CALIBRATION: 'CALIBRATION_MATURITY',
  ADVERSARIAL: 'NEGATIVE_CONTROLS',
  CLAIMS: 'DISTRIBUTION_EVIDENCE',
};

/** Input for `containForFailedGate`. */
export interface ContainForFailedGateInput {
  readonly criticalGate: CriticalGateKind;
  /** Every scope the gate may affect; the smallest one is contained. */
  readonly affectedScopes: readonly ContainmentScopeCandidate[];
  readonly reason: string;
  readonly at: string;
  /** Optional stronger action; can only ESCALATE, never downgrade. */
  readonly minimumAction?: ContainmentAction;
  readonly changeClassification?: ChangeClassification;
  readonly containmentId?: string;
}

/** Result of recording a containment. */
export interface ContainmentOutcome {
  readonly containment: ContainmentEventRow;
  readonly state: ModuleStateRow;
  readonly scope: ModuleStateScope;
  readonly scopeHash: string;
}

/** Open (uncleared) containments, optionally filtered by module. */
export async function openContainments(
  engine: DatabaseEngine,
  filter: { readonly moduleId?: string } = {},
): Promise<readonly ContainmentEventRow[]> {
  const params: unknown[] = [];
  let where = `cleared_by_event_ref IS NULL`;
  if (filter.moduleId !== undefined) {
    params.push(filter.moduleId);
    where += ` AND module_id = $${params.length}`;
  }
  const result = await engine.query<RawContainmentRow>(
    `SELECT containment_id, module_id, scope_hash, action, trigger_gate_kind, reason,
            auto_reactivation_allowed, cleared_by_event_ref, created_at
       FROM prod.containment_events
      WHERE ${where}
      ORDER BY created_at ASC, containment_id ASC`,
    params,
  );
  return result.rows.map(decodeContainmentRow);
}

/** Open containments as the activation gate's `OpenContainmentFact` list. */
export async function loadContainmentFacts(
  engine: DatabaseEngine,
  moduleId: string,
): Promise<readonly OpenContainmentFact[]> {
  const rows = await openContainments(engine, { moduleId });
  return rows.map((row) => ({
    containmentId: row.containmentId,
    moduleId: row.moduleId,
    scopeHash: row.scopeHash,
    action: row.action,
  }));
}

/**
 * Record the containment of the smallest affected scope. The action is the
 * deterministic critical-gate mapping (optionally escalated), the reason is
 * persisted verbatim, and the governed module state advances to the containment
 * state appended as a NEW row — no history is rewritten.
 */
export async function containForFailedGate(
  engine: DatabaseEngine,
  input: ContainForFailedGateInput,
): Promise<ContainmentOutcome> {
  const criticalGate = parseCriticalGate(input.criticalGate);
  if (typeof input.reason !== 'string' || input.reason.length === 0) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'containment requires a non-empty reason',
      {},
    );
  }
  const target = smallestAffectedScope(input.affectedScopes);
  const scope = parseModuleStateScope(target.scope);
  const scopeHash = activationScopeHash(scope);
  const baseAction = CONTAINMENT_ACTION_FOR_CRITICAL_GATE[criticalGate];
  const requested =
    input.minimumAction === undefined ? baseAction : parseContainmentAction(input.minimumAction);
  const requestedAction = escalateContainmentAction(baseAction, requested);

  const current = await currentStateRow(engine, { moduleId: target.moduleId, scope });
  if (current === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'containment targeted an unknown governed scope',
      { moduleId: target.moduleId, scopeHash },
    );
  }
  // DISABLED is reachable from every governed state; fall back to it only when
  // the mapped action is not a legal edge from the current position.
  const lifecycleAction: ModuleLifecycleState = parseModuleLifecycleState(requestedAction);
  const toState =
    legalLifecycleTransition(current.lifecycleState, lifecycleAction) === true
      ? lifecycleAction
      : parseModuleLifecycleState('DISABLED');

  const containmentId =
    input.containmentId ??
    `containment-${scopeHash.slice(7, 23)}-${criticalGate.toLowerCase()}-${input.at}`;
  const triggerGateKind = CRITICAL_GATE_TO_ACTIVATION_GATE[criticalGate];

  const advanced = await engine.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO prod.containment_events
         (containment_id, module_id, scope_hash, action, trigger_gate_kind, reason,
          auto_reactivation_allowed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7::timestamptz)`,
      [
        containmentId,
        target.moduleId,
        scopeHash,
        requestedAction,
        triggerGateKind,
        input.reason,
        input.at,
      ],
    );
    return advanceState(tx, {
      moduleId: target.moduleId,
      scope,
      artifactSetHash: current.artifactSetHash,
      toState,
      operationalReadiness: current.operationalReadiness,
      distributionReadiness: current.distributionReadiness,
      changeClassification: input.changeClassification ?? 'MATERIAL_SECURITY_OR_RIGHTS',
      reason: `containment ${requestedAction} (${criticalGate}): ${input.reason}`,
      actorRef: 'containment',
      at: input.at,
      currentStateRowId: current.stateRowId,
      stateRowId: `${containmentId}-state`,
      transitionId: `${containmentId}-transition`,
    });
  });

  const rows = await openContainments(engine, { moduleId: target.moduleId });
  const containment = rows.find((row) => row.containmentId === containmentId);
  if (containment === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_CONTAINMENT_ACTION_UNKNOWN,
      'containment event was not persisted',
      { containmentId },
    );
  }
  return { containment, state: advanced.state, scope, scopeHash };
}

/** True when a containment row can never auto-reactivate (always true in SQL). */
export function containmentNeverAutoReactivates(containment: ContainmentEventRow): boolean {
  return containment.autoReactivationAllowed === false;
}

/** Refuse a containment row that (impossibly) permits auto-reactivation. */
export function assertNoAutoReactivation(containment: ContainmentEventRow): void {
  if (!containmentNeverAutoReactivates(containment)) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'containment may never auto-reactivate; an explicit revalidation event is required (AC-278)',
      { containmentId: containment.containmentId },
    );
  }
}

/**
 * Clear an open containment with an EXPLICIT revalidation event. This is the
 * only path that advances a contained scope, it is never automatic, and the
 * one-time pointer can be set exactly once (a second clear refuses).
 */
export async function clearContainment(
  engine: DatabaseEngine,
  input: { readonly containmentId: string; readonly revalidationEventRef: string },
): Promise<ContainmentEventRow> {
  if (typeof input.revalidationEventRef !== 'string' || input.revalidationEventRef.length === 0) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'clearing containment requires an explicit revalidation event reference',
      { containmentId: input.containmentId },
    );
  }
  const cleared = await engine.query<{ containment_id: string }>(
    `UPDATE prod.containment_events
        SET cleared_by_event_ref = $1
      WHERE containment_id = $2 AND cleared_by_event_ref IS NULL
      RETURNING containment_id`,
    [input.revalidationEventRef, input.containmentId],
  );
  if (cleared.rows.length !== 1) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'containment auto-reactivation refused: the row is already cleared or unknown (AC-278)',
      { containmentId: input.containmentId, revalidationEventRef: input.revalidationEventRef },
    );
  }
  const result = await engine.query<RawContainmentRow>(
    `SELECT containment_id, module_id, scope_hash, action, trigger_gate_kind, reason,
            auto_reactivation_allowed, cleared_by_event_ref, created_at
       FROM prod.containment_events WHERE containment_id = $1`,
    [input.containmentId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_CONTAINMENT_ACTION_UNKNOWN,
      'containment event disappeared after clearing',
      { containmentId: input.containmentId },
    );
  }
  return decodeContainmentRow(row);
}

// --- rollback ---------------------------------------------------------------

/** One persisted `prod.rollback_events` row. */
export interface RollbackEventRow {
  readonly rollbackId: string;
  readonly moduleId: string;
  readonly restoredArtifactSetHash: string;
  readonly priorActivationEventRef: string;
  readonly newActivationEventRef: string;
  readonly historyPreserved: true;
  readonly candidateReevaluationRef: string;
  readonly createdAt: string;
}

interface RawRollbackRow {
  rollback_id: string;
  module_id: string;
  restored_artifact_set_hash: string;
  prior_activation_event_ref: string;
  new_activation_event_ref: string;
  history_preserved: boolean;
  candidate_reevaluation_ref: string;
  created_at: unknown;
}

function decodeRollbackRow(row: RawRollbackRow): RollbackEventRow {
  return {
    rollbackId: row.rollback_id,
    moduleId: row.module_id,
    restoredArtifactSetHash: row.restored_artifact_set_hash,
    priorActivationEventRef: row.prior_activation_event_ref,
    newActivationEventRef: row.new_activation_event_ref,
    historyPreserved: row.history_preserved as true,
    candidateReevaluationRef: row.candidate_reevaluation_ref,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** Alert resumption is blocked until the targeted candidate re-evaluation. */
export const ROLLBACK_ALERT_RESUMPTION = 'BLOCKED_PENDING_CANDIDATE_REEVALUATION' as const;

/** The lifecycle states that establish "previously approved" for a restore. */
const APPROVED_RESTORE_STATES: readonly ModuleLifecycleState[] = [
  'IMPLEMENTED',
  'AVAILABLE',
  'SHADOW',
  'PROVEN',
  'ACTIVE',
  'DEGRADED',
  'PAUSED',
];

/** Input for `rollbackToApproved`. */
export interface RollbackToApprovedInput {
  readonly moduleId: string;
  readonly scope: ModuleStateScope;
  /** The previously approved immutable artifact set being restored. */
  readonly restoredArtifactSetHash: string;
  readonly priorActivationEventRef: string;
  /** A NEW activation event; the SQL unique constraint refuses reuse. */
  readonly newActivationEventRef: string;
  readonly candidateReevaluationRef: string;
  readonly at: string;
  readonly reason?: string;
  readonly rollbackId?: string;
}

/** Result of an additive rollback. */
export interface RollbackOutcome {
  readonly rollback: RollbackEventRow;
  readonly state: ModuleStateRow;
  readonly alertResumption: typeof ROLLBACK_ALERT_RESUMPTION;
}

/**
 * Restore a previously approved immutable configuration/artifact set. The
 * restored state row is a NEW append-only row with the NEW activation event,
 * the rollback event preserves every historical decision, and alert resumption
 * is blocked until the candidate re-evaluation reference completes.
 */
export async function rollbackToApproved(
  engine: DatabaseEngine,
  input: RollbackToApprovedInput,
): Promise<RollbackOutcome> {
  const scope = parseModuleStateScope(input.scope);
  const scopeHash = activationScopeHash(scope);
  const moduleId = input.moduleId;
  if (!/^sha256:[0-9a-f]{64}$/.test(input.restoredArtifactSetHash)) {
    throw new ForesiftError(
      ErrorCode.PROD_PRECOMPUTED_BOUND_INVALID,
      'rollback requires a sha256 immutable artifact-set hash',
      { restoredArtifactSetHash: input.restoredArtifactSetHash },
    );
  }
  for (const field of [
    'priorActivationEventRef',
    'newActivationEventRef',
    'candidateReevaluationRef',
  ] as const) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      throw new ForesiftError(
        ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
        `rollback requires a non-empty ${field}`,
        { field },
      );
    }
  }
  if (input.newActivationEventRef === input.priorActivationEventRef) {
    throw new ForesiftError(
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
      'rollback creates a NEW activation event; history is never reused (AC-279)',
      { priorActivationEventRef: input.priorActivationEventRef },
    );
  }

  const rows = await engine.query<{
    state_row_id: string;
    artifact_set_hash: string;
    lifecycle_state: string;
    activation_event_ref: string | null;
  }>(
    `SELECT state_row_id, artifact_set_hash, lifecycle_state, activation_event_ref
       FROM prod.module_states
      WHERE module_id = $1 AND scope = $2::jsonb AND artifact_set_hash = $3
        AND (activation_event_ref IS NULL OR activation_event_ref = $4)
      ORDER BY created_at DESC, state_row_id DESC
      LIMIT 1`,
    [moduleId, canonicalJson(scope), input.restoredArtifactSetHash, input.priorActivationEventRef],
  );
  const approved = rows.rows.find((row) =>
    APPROVED_RESTORE_STATES.includes(row.lifecycle_state as ModuleLifecycleState),
  );
  if (approved === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
      'rollback may restore only a previously approved immutable artifact set (AC-279)',
      { moduleId, scopeHash, restoredArtifactSetHash: input.restoredArtifactSetHash },
    );
  }
  if (
    approved.activation_event_ref !== null &&
    approved.activation_event_ref !== input.priorActivationEventRef
  ) {
    throw new ForesiftError(
      ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
      'the supplied prior activation event does not match the approved artifact set',
      {
        approvedActivationEventRef: approved.activation_event_ref,
        priorActivationEventRef: input.priorActivationEventRef,
      },
    );
  }

  const current = await currentStateRow(engine, { moduleId, scope });
  if (current === undefined) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_SCOPE_INVALID,
      'rollback targeted an unknown governed scope',
      { moduleId, scopeHash },
    );
  }
  const approvedState = approved.lifecycle_state as ModuleLifecycleState;
  const preferred: ModuleLifecycleState =
    approvedState === 'IMPLEMENTED' || approvedState === 'RETIRED' || approvedState === 'DISABLED'
      ? 'DISABLED'
      : 'PAUSED';
  const toState = legalLifecycleTransition(current.lifecycleState, preferred)
    ? preferred
    : parseModuleLifecycleState('DISABLED');

  const rollbackId =
    input.rollbackId ?? `rollback-${moduleId}-${input.newActivationEventRef}`.replace(/\s+/g, '-');

  const { advanced, rollback } = await engine.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO prod.rollback_events
         (rollback_id, module_id, restored_artifact_set_hash, prior_activation_event_ref,
          new_activation_event_ref, history_preserved, candidate_reevaluation_ref, created_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7::timestamptz)`,
      [
        rollbackId,
        moduleId,
        input.restoredArtifactSetHash,
        input.priorActivationEventRef,
        input.newActivationEventRef,
        input.candidateReevaluationRef,
        input.at,
      ],
    );
    const advancedRow = await advanceState(tx, {
      moduleId,
      scope,
      artifactSetHash: input.restoredArtifactSetHash,
      toState,
      operationalReadiness: current.operationalReadiness,
      distributionReadiness: current.distributionReadiness,
      changeClassification: 'MATERIAL_EVALUATION',
      reason:
        input.reason ??
        `rollback restores approved artifact set; alerts blocked until candidate re-evaluation ${input.candidateReevaluationRef}`,
      actorRef: 'rollback',
      at: input.at,
      currentStateRowId: current.stateRowId,
      // The restored row carries the NEW activation event, never the prior one.
      activationEventRef: input.newActivationEventRef,
      stateRowId: `${rollbackId}-state`,
      transitionId: `${rollbackId}-transition`,
    });
    const persisted = await tx.query<RawRollbackRow>(
      `SELECT rollback_id, module_id, restored_artifact_set_hash, prior_activation_event_ref,
              new_activation_event_ref, history_preserved, candidate_reevaluation_ref, created_at
         FROM prod.rollback_events WHERE rollback_id = $1`,
      [rollbackId],
    );
    const rollbackRow = persisted.rows[0];
    if (rollbackRow === undefined) {
      throw new ForesiftError(
        ErrorCode.PROD_LIFECYCLE_TRANSITION_ILLEGAL,
        'rollback event was not persisted',
        { rollbackId },
      );
    }
    return { advanced: advancedRow, rollback: decodeRollbackRow(rollbackRow) };
  });
  return {
    rollback,
    state: advanced.state,
    alertResumption: ROLLBACK_ALERT_RESUMPTION,
  };
}

/** The latest rollback event for a module, if any. */
export async function latestRollback(
  engine: DatabaseEngine,
  moduleId: string,
): Promise<RollbackEventRow | undefined> {
  const result = await engine.query<RawRollbackRow>(
    `SELECT rollback_id, module_id, restored_artifact_set_hash, prior_activation_event_ref,
            new_activation_event_ref, history_preserved, candidate_reevaluation_ref, created_at
       FROM prod.rollback_events
      WHERE module_id = $1
      ORDER BY created_at DESC, rollback_id DESC
      LIMIT 1`,
    [moduleId],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : decodeRollbackRow(row);
}

/**
 * AC-279: alert resumption stays blocked after a rollback until the targeted
 * candidate re-evaluation reference completes. The caller supplies the
 * completed re-evaluation reference; anything else refuses.
 */
export async function assertAlertResumptionAllowed(
  engine: DatabaseEngine,
  input: { readonly moduleId: string; readonly completedReevaluationRef: string },
): Promise<void> {
  const rollback = await latestRollback(engine, input.moduleId);
  if (rollback === undefined) return;
  if (rollback.candidateReevaluationRef !== input.completedReevaluationRef) {
    throw new ForesiftError(
      ErrorCode.PROD_ACTIVATION_GATE_REFUSED,
      'alert resumption is blocked until currently actionable candidates are re-evaluated (AC-279)',
      {
        moduleId: input.moduleId,
        requiredReevaluationRef: rollback.candidateReevaluationRef,
        completedReevaluationRef: input.completedReevaluationRef,
      },
    );
  }
}

/** The three FR-PROD-001 dimensions for a contained scope (read-through). */
export function dimensionsForContainedScope(
  engine: DatabaseEngine,
  input: { readonly moduleId: string; readonly scope: ModuleStateScope },
): Promise<ModuleStateDimensions> {
  return statesFor(engine, input);
}
