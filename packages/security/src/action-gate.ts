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
  PHISHING_RESISTANT_CLASSES,
  type ActionGateDecision,
  type ActionGateRefusalReason,
  type HighImpactActionScope,
  type StepUpPolicy,
  type StepUpProof,
} from '@foresift/shared-schemas';
import type { UtcTimestamp } from '@foresift/domain';
import { AuditChainError } from './errors.ts';
import { evaluateCsrf, type CsrfEvaluationInput } from './csrf.ts';
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
  if (!PHISHING_RESISTANT_CLASSES.includes(proof.authenticatorClass)) {
    return false;
  }
  // The policy floor excludes RECOVERY_TOTP at the schema level, so every
  // admissible minimum names a phishing-resistant class; the proof must be
  // AT LEAST that class. All phishing-resistant classes rank equally here,
  // which keeps the check deterministic without inventing a false hierarchy.
  return PHISHING_RESISTANT_CLASSES.includes(policy.minimumAuthenticatorClass);
}

export class ActionGate {
  private readonly auditChain: AuditChain | undefined;
  private readonly clock: Clock;
  private readonly auditHealthBlocked: (() => Promise<boolean> | boolean) | undefined;

  constructor(options: ActionGateOptions = {}) {
    this.auditChain = options.auditChain;
    this.clock = options.clock ?? systemClock;
    this.auditHealthBlocked = options.auditHealthBlocked;
  }

  async evaluateHighImpactAction(request: HighImpactActionRequest): Promise<ActionGateDecision> {
    const evaluatedAt = new Date(this.clock()).toISOString().replace('.000Z', 'Z') as UtcTimestamp;
    const reasons: ActionGateRefusalReason[] = [];

    // Fail-closed symmetric with every sibling dimension: an ABSENT csrf
    // field is missing protection, not passed validation (AC-274).
    if (request.csrf === undefined || !evaluateCsrf(request.csrf).valid) {
      reasons.push('CSRF_INVALID');
    }
    if ((request.idempotencyKey ?? '').length === 0) {
      reasons.push('IDEMPOTENCY_KEY_MISSING');
    }
    if ((request.reasonEntry ?? '').length === 0) {
      reasons.push('REASON_MISSING');
    }
    if (!request.authorizedScopes.includes(request.action)) {
      reasons.push('SCOPE_MISMATCH');
    }

    const proof = request.stepUpProof;
    if (proof === undefined) {
      reasons.push('STEP_UP_MISSING');
    } else {
      const nowMs = this.clock();
      const completedMs = Date.parse(proof.completedAt);
      const ageSeconds = (nowMs - completedMs) / 1000;
      if (!Number.isFinite(completedMs) || ageSeconds > request.policy.freshnessWindowSeconds) {
        reasons.push('STEP_UP_STALE');
      }
      if (
        proof.authenticatorClass === undefined ||
        !authenticatorClassSufficient(proof, request.policy) ||
        (request.policy.requireUserPresence && !proof.userPresence) ||
        (request.policy.requireUserVerification && !proof.userVerification)
      ) {
        reasons.push('AUTHENTICATOR_CLASS_INSUFFICIENT');
      }
      // The proof must belong to the acting principal.
      if (proof.actor !== request.actor) {
        reasons.push('STEP_UP_MISSING');
      }
    }

    if (this.auditHealthBlocked !== undefined && (await this.auditHealthBlocked())) {
      reasons.push('AUDIT_HEALTH_BLOCKED');
    }

    let decision: ActionGateDecision;
    if (reasons.length > 0) {
      decision = {
        outcome: 'REFUSE',
        action: request.action,
        actor: request.actor,
        reasons: [...new Set(reasons)],
        evaluatedAt,
      };
    } else if (proof !== undefined && request.idempotencyKey !== undefined) {
      decision = {
        outcome: 'ALLOW',
        action: request.action,
        actor: request.actor,
        stepUpProofId: proof.proofId,
        idempotencyKey: request.idempotencyKey,
        evaluatedAt,
      };
    } else {
      // Unreachable by construction (missing key/proof produce refusals);
      // kept as a fail-closed backstop rather than a silent allow.
      decision = {
        outcome: 'REFUSE',
        action: request.action,
        actor: request.actor,
        reasons: ['IDEMPOTENCY_KEY_MISSING'],
        evaluatedAt,
      };
    }

    const parsed = ActionGateDecisionSchema.parse(decision);
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
            : { outcome: 'REFUSE', reasons: [...decision.reasons] },
      });
    } catch (error) {
      throw new AuditChainError('failed to append gate decision to the audit chain', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
