/**
 * High-impact action gate (FR-SEC-001, §35.1, Appendix B; AC-274, and the
 * §35.9 block-rule integration AC-259 via T114).
 *
 * `evaluateHighImpactAction` is the single choke point every
 * `admin:high:*` action must pass. It enforces, independently and with one
 * typed refusal reason per dimension:
 *
 *   - fresh, phishing-resistant step-up proof — TOTP (RECOVERY_TOTP) is
 *     NEVER sufficient on its own; freshness is evaluated against an
 *     INJECTED clock so policy windows are testable and cannot drift;
 *   - exact authorization scope match against the Appendix B
 *     `admin:high:*` class;
 *   - valid double-submit + origin-bound CSRF token (`./csrf.ts`);
 *   - idempotency key and a durable reason entry;
 *   - audit health (T114): while a critical audit-verification incident is
 *     open, high-impact activation refuses outright.
 *
 * EVERY decision — allow or refuse — lands in the hash-chained audit trail
 * when a chain is wired, satisfying §35.9's "audit every gate decision".
 */
import {
  ActionGateDecisionSchema,
  HighImpactActionScopeSchema,
  PHISHING_RESISTANT_CLASSES,
  type ActionGateDecision,
  type ActionGateRefusalReason,
  type HighImpactActionScope,
  type StepUpPolicy,
  type StepUpProof,
} from '@foresift/shared-schemas';
import type { UtcTimestamp } from '@foresift/domain';
import { ActionGateError, AuditChainError, SecErrorCode } from './errors.ts';
import { evaluateCsrf, type CsrfEvaluationInput } from './csrf.ts';
import {
  appendSafe,
  numericCopy,
  numericIncludes,
  numericUnique,
  parseDecision,
  snapshotCallerInput,
} from './shadow-safe.ts';
import type { AuditChain } from './audit-chain.ts';

/** Injected clock seam — epoch milliseconds source. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

export interface HighImpactActionRequest {
  readonly action: HighImpactActionScope;
  readonly actor: string;
  /** The actor's authorized scopes; must contain the action EXACTLY. */
  readonly authorizedScopes: readonly string[];
  readonly policy: StepUpPolicy;
  readonly stepUpProof?: StepUpProof | undefined;
  readonly csrf?: CsrfEvaluationInput | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly reasonEntry?: string | undefined;
}

/** Audit action classes used for gate decisions (§35.9 vocabulary). */
const ALLOWED_AUDIT_CLASS = 'APPROVAL_STEP_UP' as const;
const REFUSED_AUDIT_CLASS = 'BLOCKED_OPERATION' as const;

/**
 * Tolerated clock skew between the proof's issuer and this gate before a
 * future-dated completion instant is refused (M11): proofs dated further
 * than this into the future are STALE, never "infinitely fresh".
 */
export const PROOF_CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * Appendix B `admin:high:*` catalog, captured ONCE at module initialization
 * (V7 security-review HIGH H2). The frozen zod enum's `options` is the only
 * authoritative list; a runtime literal is copied numerically so a later
 * `Array.prototype` shadow cannot widen the gate, and an unknown action can
 * never reach the ALLOW branch.
 */
const HIGH_IMPACT_ACTION_CATALOG: readonly string[] = Object.freeze(
  numericCopy(HighImpactActionScopeSchema.options),
);

export interface ActionGateOptions {
  /**
   * Hash-chained audit sink for decisions. Optional at construction only so
   * pure-policy tests stay DB-free; production wiring ALWAYS supplies it.
   */
  readonly auditChain?: AuditChain | undefined;
  readonly clock?: Clock | undefined;
  /**
   * T114 consultation seam: returns true while a critical
   * audit-verification incident is open (Incidents.isOpenAuditChainFailure).
   */
  readonly auditHealthBlocked?: () => Promise<boolean> | boolean;
}

function authenticatorClassSufficient(proof: StepUpProof, policy: StepUpPolicy): boolean {
  // TOTP can never clear the bar, regardless of any declared minimum.
  if (!numericIncludes(PHISHING_RESISTANT_CLASSES, proof.authenticatorClass)) {
    return false;
  }
  // The policy floor excludes RECOVERY_TOTP at the schema level, so every
  // admissible minimum names a phishing-resistant class; the proof must be
  // AT LEAST that class. All phishing-resistant classes rank equally here,
  // which keeps the check deterministic without inventing a false hierarchy.
  return numericIncludes(PHISHING_RESISTANT_CLASSES, policy.minimumAuthenticatorClass);
}

export class ActionGate {
  private readonly auditChain: AuditChain | undefined;
  private readonly clock: Clock;
  private readonly auditHealthBlocked: (() => Promise<boolean> | boolean) | undefined;

  constructor(options: ActionGateOptions = {}) {
    // Each option is read exactly ONCE below and the fields are independent,
    // so no snapshot is required (and `auditChain` is a branded class instance
    // that must NOT be passed through `snapshotCallerInput`).
    this.auditChain = options.auditChain;
    this.clock = options.clock ?? systemClock;
    this.auditHealthBlocked = options.auditHealthBlocked;
  }

  async evaluateHighImpactAction(rawRequest: HighImpactActionRequest): Promise<ActionGateDecision> {
    // Single-read binding (V7 accessor class): a plain object with getters, a
    // Proxy, or a class instance could otherwise present `action`/`actor`/`csrf`
    // values that pass the checks and DIFFERENT values to the decision/audit —
    // an authorized actor's scope could be swapped for `admin:high:kill-switch`
    // or the ALLOW attributed to another actor.
    const request = snapshotCallerInput(rawRequest);
    const evaluatedAt = new Date(this.clock()).toISOString().replace('.000Z', 'Z') as UtcTimestamp;
    const reasons: ActionGateRefusalReason[] = [];

    // H2 fail-closed binding: the gate's own subject (`action`) and principal
    // (`actor`) are REQUIRED, typed, and validated against the Appendix B
    // catalog BEFORE any dimension is evaluated. An unknown action or an empty
    // actor is a malformed high-impact request, never an admissible one.
    const action = request.action;
    if (typeof action !== 'string' || !numericIncludes(HIGH_IMPACT_ACTION_CATALOG, action)) {
      throw new ActionGateError(
        'high-impact action is not a member of the Appendix B action catalog',
        { action: typeof action === 'string' ? action : 'non-string' },
        SecErrorCode.SEC_ACTION_GATE_INVALID_ACTION,
      );
    }
    const actor = request.actor;
    if (typeof actor !== 'string' || actor.trim() === '') {
      throw new ActionGateError(
        'high-impact action requires a non-empty string actor',
        {},
        SecErrorCode.SEC_ACTION_GATE_INVALID_ACTOR,
      );
    }

    // H3 fail-closed policy parse: an absent / NaN / Infinity freshness window
    // makes every `ageSeconds > window` comparison false, silently DISABLING
    // proof freshness. Validate the WHOLE policy explicitly (finite positive
    // integer window, phishing-resistant floor, boolean presence duties) so a
    // malformed policy can never weaken the gate.
    const policy = request.policy;
    if (policy === undefined || policy === null) {
      throw new ActionGateError(
        'step-up policy is missing or invalid (freshness window must be a finite positive integer)',
        {},
        SecErrorCode.SEC_ACTION_GATE_INVALID_POLICY,
      );
    }
    const freshnessWindowSeconds = policy.freshnessWindowSeconds;
    if (
      !Number.isInteger(freshnessWindowSeconds) ||
      !Number.isFinite(freshnessWindowSeconds) ||
      freshnessWindowSeconds <= 0 ||
      typeof policy.minimumAuthenticatorClass !== 'string' ||
      !numericIncludes(PHISHING_RESISTANT_CLASSES, policy.minimumAuthenticatorClass) ||
      typeof policy.requireUserPresence !== 'boolean' ||
      typeof policy.requireUserVerification !== 'boolean'
    ) {
      throw new ActionGateError(
        'step-up policy is missing or invalid (freshness window must be a finite positive integer)',
        {},
        SecErrorCode.SEC_ACTION_GATE_INVALID_POLICY,
      );
    }

    // Fail-closed symmetric with every sibling dimension: an ABSENT csrf
    // field is missing protection, not passed validation (AC-274).
    if (request.csrf === undefined || !evaluateCsrf(request.csrf).valid) {
      appendSafe(reasons, 'CSRF_INVALID');
    }
    if ((request.idempotencyKey ?? '').length === 0) {
      appendSafe(reasons, 'IDEMPOTENCY_KEY_MISSING');
    }
    if ((request.reasonEntry ?? '').length === 0) {
      appendSafe(reasons, 'REASON_MISSING');
    }
    if (!numericIncludes(request.authorizedScopes, action)) {
      appendSafe(reasons, 'SCOPE_MISMATCH');
    }

    const proof = request.stepUpProof;
    if (proof === undefined) {
      appendSafe(reasons, 'STEP_UP_MISSING');
    } else {
      const nowMs = this.clock();
      const completedMs = Date.parse(proof.completedAt);
      const ageSeconds = (nowMs - completedMs) / 1000;
      // Future-dated proofs never go stale (negative age), so anything
      // beyond a small clock-skew tolerance is refused as stale — a
      // far-future timestamp must not become a permanent credential.
      if (
        !Number.isFinite(completedMs) ||
        ageSeconds > freshnessWindowSeconds ||
        completedMs > nowMs + PROOF_CLOCK_SKEW_TOLERANCE_MS
      ) {
        appendSafe(reasons, 'STEP_UP_STALE');
      }
      if (
        proof.authenticatorClass === undefined ||
        !authenticatorClassSufficient(proof, policy) ||
        (policy.requireUserPresence && !proof.userPresence) ||
        (policy.requireUserVerification && !proof.userVerification)
      ) {
        appendSafe(reasons, 'AUTHENTICATOR_CLASS_INSUFFICIENT');
      }
      // The proof must belong to the acting principal.
      if (proof.actor !== actor) {
        appendSafe(reasons, 'STEP_UP_MISSING');
      }
    }

    if (this.auditHealthBlocked !== undefined && (await this.auditHealthBlocked())) {
      appendSafe(reasons, 'AUDIT_HEALTH_BLOCKED');
    }

    let decision: ActionGateDecision;
    if (reasons.length > 0) {
      decision = {
        outcome: 'REFUSE',
        action,
        actor,
        reasons: numericUnique(reasons),
        evaluatedAt,
      };
    } else if (proof !== undefined && request.idempotencyKey !== undefined) {
      decision = {
        outcome: 'ALLOW',
        action,
        actor,
        stepUpProofId: proof.proofId,
        idempotencyKey: request.idempotencyKey,
        evaluatedAt,
      };
    } else {
      // Unreachable by construction (missing key/proof produce refusals);
      // kept as a fail-closed backstop rather than a silent allow.
      decision = {
        outcome: 'REFUSE',
        action,
        actor,
        reasons: ['IDEMPOTENCY_KEY_MISSING'],
        evaluatedAt,
      };
    }

    const parsed = parseDecision(ActionGateDecisionSchema, decision);
    await this.recordDecision(parsed);
    return parsed;
  }

  /** §35.9 duty: every gate decision is audited; failure is loud, not silent. */
  private async recordDecision(decision: ActionGateDecision): Promise<void> {
    if (this.auditChain === undefined) return;
    try {
      await this.auditChain.append({
        // Schema parse yields a plain string; re-brand from our own cast value.
        occurredAt: decision.evaluatedAt as UtcTimestamp,
        actor: decision.actor,
        actionClass: decision.outcome === 'ALLOW' ? ALLOWED_AUDIT_CLASS : REFUSED_AUDIT_CLASS,
        subject: decision.action,
        payload:
          decision.outcome === 'ALLOW'
            ? { outcome: 'ALLOW', stepUpProofId: decision.stepUpProofId }
            : { outcome: 'REFUSE', reasons: numericCopy(decision.reasons) },
      });
    } catch (error) {
      throw new AuditChainError('failed to append gate decision to the audit chain', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
