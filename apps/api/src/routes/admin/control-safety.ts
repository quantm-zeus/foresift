/**
 * §35.1 high-impact admin action guard
 * (T011, FR-ADM-003/007, PRD §28.3–§28.5, §35.1; AC-014, AC-063, AC-262).
 *
 * Every control-plane action (schedule/configuration lifecycle and the six
 * §28.13 kill-switch transitions) passes through this guard BEFORE any owner
 * call. It refuses, with ONE typed admin code each:
 *
 *   - a stale, missing, future-dated, or TOTP-only step-up proof — the
 *     authorization decision itself comes from `@foresift/security`'s
 *     `ActionGate` (the security-owned primitive), never from a bespoke model
 *     re-implemented here;
 *   - an authorization scope that is not the exact Appendix B
 *     `admin:high:*` scope the action requires;
 *   - a missing/invalid CSRF token, a missing idempotency key, an empty reason,
 *     or an audit-health block.
 *
 * Every allowed AND refused decision is written to `adm.admin_action_audit`.
 * A refusal is always surfaced as {@link AdminControlError} with a stable
 * `code`; the audit write may fail, but it can never mask the typed refusal
 * (the failure is attached as the error's `cause`).
 *
 * Immutability duties encoded here: an existing configuration version's
 * content can never be edited in place (an edit creates a NEW version), and a
 * lifecycle state may only advance along the §28.3 law. The resolved-config
 * preview precedence chain is validated against the §28.4 order before it is
 * stored.
 */
import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { ActionGate, type CsrfEvaluationInput } from '@foresift/security';
import { HighImpactActionScopeSchema } from '@foresift/shared-schemas';
import {
  ADMIN_CONTROL_ACTION_SCOPE,
  AdminActionAuditKindSchema,
  AdminActionAuditRowSchema,
  AdminControlActionRequestSchema,
  AdminErrorCode,
  ConfigLifecycleStateSchema,
  ConfigVersionRowSchema,
  isAllowedLifecycleTransition,
  isOrderedPrecedenceChain,
  type AdminActionAuditKind,
  type AdminActionAuditRow,
  type AdminControlActionRequest,
  type ConfigLifecycleState,
  type ConfigVersionRow,
} from '@foresift/shared-schemas';
import type {
  ActionGateDecision,
  ActionGateRefusalReason,
  StepUpPolicy,
  StepUpProof,
} from '@foresift/shared-schemas';

/** Typed refusal carrying a stable machine code, correlation id, and detail. */
export class AdminControlError extends Error {
  readonly code: AdminErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly correlationId: string;

  constructor(
    code: AdminErrorCode,
    message: string,
    detail: Readonly<Record<string, unknown>> = {},
    correlationId: string = randomUUID(),
  ) {
    super(`${code}: ${message}`);
    this.name = 'AdminControlError';
    this.code = code;
    this.detail = detail;
    this.correlationId = correlationId;
  }
}

/** One `ActionGateRefusalReason` maps to exactly one stable admin code. */
const REFUSAL_CODE_BY_REASON: Readonly<Record<ActionGateRefusalReason, AdminErrorCode>> =
  Object.freeze({
    STEP_UP_MISSING: AdminErrorCode.ADMIN_STEP_UP_MISSING,
    STEP_UP_STALE: AdminErrorCode.ADMIN_STEP_UP_STALE,
    AUTHENTICATOR_CLASS_INSUFFICIENT: AdminErrorCode.ADMIN_AUTHENTICATOR_CLASS_INSUFFICIENT,
    SCOPE_MISMATCH: AdminErrorCode.ADMIN_ACTION_SCOPE_MISMATCH,
    CSRF_INVALID: AdminErrorCode.ADMIN_CSRF_INVALID,
    IDEMPOTENCY_KEY_MISSING: AdminErrorCode.ADMIN_IDEMPOTENCY_KEY_MISSING,
    REASON_MISSING: AdminErrorCode.ADMIN_REASON_MISSING,
    AUDIT_HEALTH_BLOCKED: AdminErrorCode.ADMIN_AUDIT_HEALTH_BLOCKED,
  });

/**
 * The exact `admin:high:*` scope a control action requires (Appendix B). The
 * mapping lives in the shared schema authority so the router, the guard, and
 * the telemetry catalog can never disagree.
 */
export function scopeForAction(actionKind: AdminActionAuditKind): string {
  return ADMIN_CONTROL_ACTION_SCOPE[actionKind];
}

/** The request shape a guarded action must produce (idempotency + reason). */
export interface AdminControlActionInput {
  readonly actionKind: AdminActionAuditKind;
  readonly targetRef: string;
  readonly targetVersionRef?: string | null | undefined;
  readonly actorRef: string;
  readonly reason?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly stepUpProof?: StepUpProof | undefined;
  readonly csrf?: CsrfEvaluationInput | undefined;
  readonly authorizedScopes: readonly string[];
  readonly policy: StepUpPolicy;
}

/** A fully-authorized action: its decision, request envelope, and evidence. */
export interface AuthorizedControlAction {
  readonly decision: Extract<ActionGateDecision, { outcome: 'ALLOW' }>;
  readonly request: AdminControlActionRequest;
  /** Non-secret digest of the CSRF evidence (raw tokens are never stored). */
  readonly csrfRef: string;
}

/** Non-secret evidence refs recorded alongside an allowed action. */
export interface ControlActionExecution {
  readonly beforeHash?: string | null | undefined;
  readonly afterHash?: string | null | undefined;
  readonly auditRef?: string | null | undefined;
}

export interface AdminControlGuardOptions {
  readonly engine: DatabaseEngine;
  /** Injected `@foresift/security` gate; defaults to a DB-free instance. */
  readonly actionGate?: ActionGate | undefined;
  readonly clock?: (() => number) | undefined;
}

/** Non-secret digest of the presented CSRF evidence. */
function csrfReference(csrf: CsrfEvaluationInput | undefined): string {
  return sha256Text(
    canonicalJson({
      submittedToken: csrf?.submittedToken ?? null,
      tokenBoundOrigin: csrf?.tokenBoundOrigin ?? null,
      requestOrigin: csrf?.requestOrigin ?? null,
    }),
  );
}

/** Deterministic content hash of a state/version identity triple. */
export function stateHash(input: Record<string, unknown>): string {
  return sha256Text(canonicalJson(input));
}

export class AdminControlGuard {
  private readonly engine: DatabaseEngine;
  private readonly actionGate: ActionGate;
  private readonly clock: () => number;

  constructor(options: AdminControlGuardOptions) {
    this.engine = options.engine;
    this.clock = options.clock ?? (() => Date.now());
    // The security-owned gate shares the guard's injected clock so step-up
    // freshness windows are deterministic in tests and never drift.
    this.actionGate = options.actionGate ?? new ActionGate({ clock: this.clock });
  }

  private resolveNow(): string {
    return new Date(this.clock()).toISOString();
  }

  /**
   * The single §35.1 choke point. Returns the authorized request or throws a
   * typed {@link AdminControlError}; a refusal is toujours audited first.
   */
  async authorize(input: AdminControlActionInput): Promise<AuthorizedControlAction> {
    // Typed validation of the action kind: an unknown literal refuses before
    // any authorization or owner call, never fail-open.
    const actionKind = AdminActionAuditKindSchema.safeParse(input.actionKind);
    if (!actionKind.success) {
      throw await this.refuse(
        input,
        AdminErrorCode.ADMIN_CONTROL_ACTION_UNKNOWN,
        `unknown admin control action '${String(input.actionKind)}'`,
      );
    }
    const kind = actionKind.data;
    if (typeof input.targetRef !== 'string' || input.targetRef.length === 0) {
      throw await this.refuse(
        input,
        AdminErrorCode.ADMIN_ACTION_REQUEST_INVALID,
        'a control action requires a non-empty target reference',
      );
    }
    if (typeof input.actorRef !== 'string' || input.actorRef.length === 0) {
      throw await this.refuse(
        input,
        AdminErrorCode.ADMIN_ACTION_REQUEST_INVALID,
        'a control action requires a non-empty actor reference',
      );
    }

    const scope = HighImpactActionScopeSchema.parse(scopeForAction(kind));
    const decision = await this.actionGate.evaluateHighImpactAction({
      action: scope,
      actor: input.actorRef,
      authorizedScopes: input.authorizedScopes,
      policy: input.policy,
      ...(input.stepUpProof === undefined ? {} : { stepUpProof: input.stepUpProof }),
      ...(input.csrf === undefined ? {} : { csrf: input.csrf }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      ...(input.reason === undefined ? {} : { reasonEntry: input.reason }),
    });

    if (decision.outcome === 'REFUSE') {
      const code = REFUSAL_CODE_BY_REASON[decision.reasons[0] as ActionGateRefusalReason];
      throw await this.refuse(
        input,
        code ?? AdminErrorCode.ADMIN_ACTION_REFUSED,
        `high-impact action refused: ${decision.reasons.join(', ')}`,
        { reasons: [...decision.reasons] },
      );
    }

    // The ALLOW path re-validates the full envelope through the shared schema:
    // idempotency and a non-empty reason are unconditional.
    const request = AdminControlActionRequestSchema.safeParse({
      actionKind: kind,
      targetRef: input.targetRef,
      targetVersionRef: input.targetVersionRef ?? null,
      actorRef: input.actorRef,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      authorizationScope: scope,
      requestedAt: this.resolveNow(),
    });
    if (!request.success) {
      throw await this.refuse(
        input,
        AdminErrorCode.ADMIN_ACTION_REQUEST_INVALID,
        'the authorized control action envelope is incomplete',
        { issues: request.error.issues.map((issue) => issue.message) },
      );
    }

    return {
      decision,
      request: request.data,
      csrfRef: csrfReference(input.csrf),
    };
  }

  /** Append the ALLOWED decision; call inside the action's own transaction. */
  async recordAllowed(
    engine: DatabaseEngine,
    authorized: AuthorizedControlAction,
    execution: ControlActionExecution = {},
  ): Promise<void> {
    await this.writeAudit(engine, {
      actionId: randomUUID(),
      actionKind: authorized.request.actionKind,
      targetRef: authorized.request.targetRef,
      targetVersionRef: authorized.request.targetVersionRef,
      actorRef: authorized.request.actorRef,
      stepUpRef: authorized.decision.stepUpProofId,
      csrfRef: authorized.csrfRef,
      idempotencyKey: authorized.request.idempotencyKey,
      reason: authorized.request.reason,
      outcome: 'ALLOWED',
      refusalCode: null,
      beforeHash: execution.beforeHash ?? null,
      afterHash: execution.afterHash ?? null,
      auditRef: execution.auditRef ?? `adm:action:${authorized.request.actionKind}`,
      recordedAt: this.resolveNow(),
    });
  }

  /**
   * The delegated action wrapper: authorize, run the caller's owner call, and
   * guarantee exactly one ALLOWED audit row (the caller may record it inside
   * its own transaction via the supplied `recordAllowed`).
   */
  async run<T>(
    input: AdminControlActionInput,
    work: (
      authorized: AuthorizedControlAction,
      recordAllowed: (execution?: ControlActionExecution, engine?: DatabaseEngine) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const authorized = await this.authorize(input);
    let recorded = false;
    const recordAllowed = async (
      execution: ControlActionExecution = {},
      engine: DatabaseEngine = this.engine,
    ): Promise<void> => {
      await this.recordAllowed(engine, authorized, execution);
      recorded = true;
    };
    const result = await work(authorized, recordAllowed);
    if (!recorded) await this.recordAllowed(this.engine, authorized);
    return result;
  }

  /** Write a typed refusal; the audit failure never masks the returned code. */
  private async refuse(
    input: AdminControlActionInput,
    code: AdminErrorCode,
    message: string,
    detail: Readonly<Record<string, unknown>> = {},
  ): Promise<AdminControlError> {
    const actionKind = AdminActionAuditKindSchema.safeParse(input.actionKind);
    const row: AdminActionAuditRow = {
      actionId: randomUUID(),
      actionKind: actionKind.success ? actionKind.data : 'CONFIG_VALIDATE',
      targetRef: input.targetRef.length > 0 ? input.targetRef : 'unknown',
      targetVersionRef: input.targetVersionRef ?? null,
      actorRef: input.actorRef.length > 0 ? input.actorRef : 'unknown',
      stepUpRef: input.stepUpProof?.proofId ?? null,
      csrfRef: input.csrf === undefined ? null : csrfReference(input.csrf),
      idempotencyKey: input.idempotencyKey === undefined ? null : input.idempotencyKey,
      reason:
        input.reason !== undefined && input.reason.length > 0 ? input.reason : `refused: ${code}`,
      outcome: 'REFUSED',
      refusalCode: code,
      beforeHash: null,
      afterHash: null,
      auditRef: null,
      recordedAt: this.resolveNow(),
    };
    const error = new AdminControlError(code, message, detail);
    try {
      // A refusal with an unknown kind still names a valid kind so the refusal
      // stays durably auditable rather than being dropped.
      await this.writeAudit(this.engine, row);
    } catch (auditError) {
      error.cause = auditError;
    }
    return error;
  }

  private async writeAudit(engine: DatabaseEngine, row: AdminActionAuditRow): Promise<void> {
    const parsed = AdminActionAuditRowSchema.parse(row);
    await engine.query(
      `INSERT INTO adm.admin_action_audit
         (action_id, action_kind, target_ref, target_version_ref, actor_ref, step_up_ref,
          csrf_ref, idempotency_key, reason, outcome, refusal_code, before_hash, after_hash,
          audit_ref, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        parsed.actionId,
        parsed.actionKind,
        parsed.targetRef,
        parsed.targetVersionRef,
        parsed.actorRef,
        parsed.stepUpRef,
        parsed.csrfRef,
        parsed.idempotencyKey,
        parsed.reason,
        parsed.outcome,
        parsed.refusalCode,
        parsed.beforeHash,
        parsed.afterHash,
        parsed.auditRef,
        parsed.recordedAt,
      ],
    );
  }
}

/** Build the §35.1 guard. */
export function createAdminControlGuard(options: AdminControlGuardOptions): AdminControlGuard {
  return new AdminControlGuard(options);
}

// --- immutable-version enforcement ------------------------------------------

/** A requested mutation of an existing configuration version. */
export interface ConfigVersionMutation {
  readonly configHash?: string | undefined;
  readonly resolvedConfigHash?: string | undefined;
  readonly resolvedConfig?: unknown | undefined;
  readonly lifecycleState?: ConfigLifecycleState | undefined;
  readonly supersededBy?: string | null | undefined;
}

/**
 * §28.3/§28.5 immutability law: content of an existing version is NEVER
 * editable (an edit creates a NEW version); only the governed lifecycle state
 * may advance, and `supersededBy` may be set exactly once from null.
 */
export function assertConfigVersionMutationAllowed(
  row: ConfigVersionRow,
  mutation: ConfigVersionMutation,
): void {
  const parsed = ConfigVersionRowSchema.parse(row);
  const contentChanged =
    (mutation.configHash !== undefined && mutation.configHash !== parsed.configHash) ||
    (mutation.resolvedConfigHash !== undefined &&
      mutation.resolvedConfigHash !== parsed.resolvedConfigHash) ||
    (mutation.resolvedConfig !== undefined &&
      canonicalJson(mutation.resolvedConfig) !== canonicalJson(parsed.resolvedConfig));
  if (contentChanged) {
    throw new AdminControlError(
      AdminErrorCode.ADMIN_CONFIG_VERSION_IMMUTABLE,
      `configuration version ${parsed.configVersionId} is immutable: an edit creates a new version`,
      { configVersionId: parsed.configVersionId },
    );
  }
  if (mutation.supersededBy !== undefined && mutation.supersededBy !== parsed.supersededBy) {
    if (!(parsed.supersededBy === null && mutation.supersededBy !== null)) {
      throw new AdminControlError(
        AdminErrorCode.ADMIN_CONFIG_VERSION_IMMUTABLE,
        `configuration version ${parsed.configVersionId} can be superseded exactly once`,
        { configVersionId: parsed.configVersionId },
      );
    }
  }
  if (mutation.lifecycleState !== undefined && mutation.lifecycleState !== parsed.lifecycleState) {
    const toState = ConfigLifecycleStateSchema.parse(mutation.lifecycleState);
    if (!isAllowedLifecycleTransition(parsed.lifecycleState, toState)) {
      throw new AdminControlError(
        AdminErrorCode.ADMIN_CONFIG_LIFECYCLE_TRANSITION_INVALID,
        `§28.3 lifecycle transition ${parsed.lifecycleState} -> ${toState} is not allowed`,
        { configVersionId: parsed.configVersionId, from: parsed.lifecycleState, to: toState },
      );
    }
  }
}

// --- §28.4 resolved-configuration precedence --------------------------------

/**
 * §28.4 law: the precedence chain is a strictly ascending subsequence of
 * `SYSTEM_DEFAULTS < WORKFLOW_VERSION < AGENT_PROFILE_VERSION
 * < SCHEDULE_VERSION < RUN_NOW_OVERRIDE`. A reordered or unknown chain is
 * refused before it can be persisted or replayed.
 */
export function assertResolvedPrecedenceOrdered(chain: readonly string[]): void {
  if (!isOrderedPrecedenceChain(chain)) {
    throw new AdminControlError(
      AdminErrorCode.ADMIN_RESOLVED_PREVIEW_PRECEDENCE_INVALID,
      'the resolved-configuration precedence chain must follow the §28.4 order',
      { precedence: [...chain] },
    );
  }
}
