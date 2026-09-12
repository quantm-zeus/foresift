/**
 * Executable §25.8 retry taxonomy (T017, FR-WF-003, FR-WF-007).
 *
 * `retryPolicyFor` (packages/domain/src/wf.ts) is the pure law mapping the nine
 * error classes to a policy; this module is its executable form. It decides,
 * per attempt, whether to RETRY (and after how long), to STOP, to disable the
 * operation, or to degrade — and on exhaustion returns a typed dead-letter
 * handoff input for the next slice's dead-letter writer.
 *
 * Every delay is bounded and every jitter draw comes from an INJECTED
 * `() => number`, so tests are deterministic and a policy can never sleep
 * unbounded. The name deliberately avoids `execute`/`submit`/`sign`: this is
 * read-only scheduling of a retry, not an action.
 */
import {
  ErrorCode,
  ForesiftError,
  retryPolicyFor,
  type RetryErrorClass,
  type RetryPolicy,
} from '@foresift/domain';

/** §25.8 bounded-exponential retry budget for timeout/5xx. */
export const TIMEOUT_ATTEMPT_CAP = 5 as const;
/** Database serialization conflicts are retried a small bounded number of times. */
export const TRANSACTION_RETRY_MAX_ATTEMPTS = 3 as const;
/** Notification outbox retries are bounded and spaced out. */
export const OUTBOX_RETRY_MAX_ATTEMPTS = 5 as const;
export const OUTBOX_RETRY_BASE_DELAY_MS = 1_000 as const;
export const OUTBOX_RETRY_MAX_DELAY_MS = 60_000 as const;
/** One repair attempt for a model format error (§25.8). */
export const SINGLE_REPAIR_MAX_ATTEMPTS = 2 as const;
/** One hour is the longest rate-limit reset this engine will wait out. */
export const RATE_LIMIT_MAX_DELAY_MS = 60 * 60 * 1000;

export type AttemptAction = 'RETRY' | 'STOP' | 'DISABLE_OPERATION' | 'DEGRADE';

/** Typed input the dead-letter writer consumes once retries are exhausted. */
export interface DeadLetterHandoffInput {
  readonly errorClass: RetryErrorClass | null;
  readonly attempts: number;
  readonly lastValidCheckpointRef: string | null;
  readonly reason: string;
}

export interface AttemptPlan {
  readonly policyKind: RetryPolicy['kind'];
  readonly action: AttemptAction;
  /** The attempt that just failed (1-based). */
  readonly attempt: number;
  /** The next attempt number, or null when the action is not RETRY. */
  readonly nextAttempt: number | null;
  /** Delay before the next attempt (0 when not RETRY). */
  readonly delayMs: number;
  readonly jittered: boolean;
  readonly exhausted: boolean;
  readonly handoff: DeadLetterHandoffInput | null;
  readonly reason: string;
}

export interface AttemptPlanContext {
  /** Enables the typed dead-letter handoff on exhaustion. */
  readonly errorClass?: RetryErrorClass;
  readonly lastValidCheckpointRef?: string | null;
  /** RATE_LIMITED: the provider's advertised reset delay. */
  readonly retryAfterMs?: number;
  /** RATE_LIMITED: budget remaining for waiting out the reset. */
  readonly budgetRemainingMs?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value >= 1) return 0.999_999;
  return value;
}

function assertAttempt(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new ForesiftError(
      ErrorCode.WF_RETRY_POLICY_INVALID,
      'attempt must be a positive integer',
      {
        attempt,
      },
    );
  }
  return attempt;
}

function handoffFor(
  context: AttemptPlanContext | undefined,
  attempts: number,
  reason: string,
): DeadLetterHandoffInput | null {
  if (context?.errorClass === undefined) return null;
  return {
    errorClass: context.errorClass,
    attempts,
    lastValidCheckpointRef: context.lastValidCheckpointRef ?? null,
    reason,
  };
}

function stopPlan(
  policyKind: RetryPolicy['kind'],
  attempt: number,
  action: AttemptAction,
  reason: string,
  context?: AttemptPlanContext,
): AttemptPlan {
  return {
    policyKind,
    action,
    attempt,
    nextAttempt: null,
    delayMs: 0,
    jittered: false,
    exhausted: true,
    handoff: handoffFor(context, attempt, reason),
    reason,
  };
}

function retryPlan(
  policyKind: RetryPolicy['kind'],
  attempt: number,
  delayMs: number,
  jittered: boolean,
  reason: string,
): AttemptPlan {
  return {
    policyKind,
    action: 'RETRY',
    attempt,
    nextAttempt: attempt + 1,
    delayMs,
    jittered,
    exhausted: false,
    handoff: null,
    reason,
  };
}

/**
 * Bounded exponential delay with equal jitter: `delay = min(base * 2^(n-1),
 * max)`, then `delay/2 + random() * delay/2`. The result is always within
 * `[delay/2, maxDelayMs]` — bounded in both directions.
 */
export function boundedExponentialDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const raw = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const half = raw / 2;
  const jittered = half + clamp01(random()) * half;
  return Math.min(Math.round(jittered), maxDelayMs);
}

/**
 * The pure per-attempt decision for a resolved §25.8 policy. `attempt` is the
 * attempt that just failed; `random` is injected so delay jitter is
 * deterministic in tests.
 */
export function nextAttemptPlan(
  policy: RetryPolicy,
  attempt: number,
  random: () => number,
  context?: AttemptPlanContext,
): AttemptPlan {
  const n = assertAttempt(attempt);
  switch (policy.kind) {
    case 'NONE':
      if (policy.disableOperation === true) {
        return stopPlan(
          'NONE',
          n,
          'DISABLE_OPERATION',
          'authentication invalid: disable operation',
          context,
        );
      }
      return stopPlan('NONE', n, 'STOP', 'error class is not retryable', context);
    case 'DEGRADE_NO_REPEAT':
      return stopPlan(
        'DEGRADE_NO_REPEAT',
        n,
        'DEGRADE',
        'schema drift: no automated repeated retry; mark operation degraded',
        context,
      );
    case 'RETRY_AFTER_RESET': {
      const retryAfterMs = context?.retryAfterMs ?? 0;
      if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
        throw new ForesiftError(
          ErrorCode.WF_RETRY_POLICY_INVALID,
          'retryAfterMs must be a finite non-negative duration',
          { retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : null },
        );
      }
      if (retryAfterMs > RATE_LIMIT_MAX_DELAY_MS) {
        return stopPlan(
          'RETRY_AFTER_RESET',
          n,
          'STOP',
          'rate-limit reset exceeds the bounded wait window',
          context,
        );
      }
      const budget = context?.budgetRemainingMs;
      if (budget !== undefined) {
        if (!Number.isFinite(budget) || budget < 0) {
          throw new ForesiftError(
            ErrorCode.WF_RETRY_POLICY_INVALID,
            'budgetRemainingMs must be a finite non-negative duration',
            { budgetRemainingMs: Number.isFinite(budget) ? budget : null },
          );
        }
        if (retryAfterMs > budget) {
          return stopPlan(
            'RETRY_AFTER_RESET',
            n,
            'STOP',
            'rate-limit reset exceeds the remaining retry budget',
            context,
          );
        }
      }
      return retryPlan('RETRY_AFTER_RESET', n, retryAfterMs, false, 'retry after reset');
    }
    case 'BOUNDED_EXPONENTIAL': {
      if (n >= policy.maxAttempts) {
        return stopPlan(
          'BOUNDED_EXPONENTIAL',
          n,
          'STOP',
          'bounded exponential retry budget exhausted',
          context,
        );
      }
      const delayMs = boundedExponentialDelay(n, policy.baseDelayMs, policy.maxDelayMs, random);
      return retryPlan('BOUNDED_EXPONENTIAL', n, delayMs, true, 'bounded exponential with jitter');
    }
    case 'SINGLE_REPAIR':
      if (n >= SINGLE_REPAIR_MAX_ATTEMPTS) {
        return stopPlan('SINGLE_REPAIR', n, 'STOP', 'single repair attempt already used', context);
      }
      return retryPlan('SINGLE_REPAIR', n, 0, false, 'one repair attempt');
    case 'RETRY_TRANSACTION':
      if (n >= TRANSACTION_RETRY_MAX_ATTEMPTS) {
        return stopPlan(
          'RETRY_TRANSACTION',
          n,
          'STOP',
          'transaction retry budget exhausted',
          context,
        );
      }
      return retryPlan('RETRY_TRANSACTION', n, 0, false, 'retry transaction');
    case 'RETRY_OUTBOX': {
      if (n >= OUTBOX_RETRY_MAX_ATTEMPTS) {
        return stopPlan('RETRY_OUTBOX', n, 'STOP', 'outbox retry budget exhausted', context);
      }
      const delayMs = boundedExponentialDelay(
        n,
        OUTBOX_RETRY_BASE_DELAY_MS,
        OUTBOX_RETRY_MAX_DELAY_MS,
        random,
      );
      return retryPlan('RETRY_OUTBOX', n, delayMs, true, 'retry from outbox');
    }
    default: {
      // Fail closed: an unknown policy shape must never be treated as retryable.
      throw new ForesiftError(ErrorCode.WF_RETRY_POLICY_INVALID, 'unknown retry policy kind', {
        kind: (policy as { kind?: string }).kind ?? null,
      });
    }
  }
}

/** Convenience: resolve the §25.8 policy for an error class, then plan. */
export function planAttempt(
  errorClass: RetryErrorClass,
  attempt: number,
  random: () => number,
  context?: Omit<AttemptPlanContext, 'errorClass'>,
): AttemptPlan {
  const policy = retryPolicyFor(errorClass);
  const withClass: AttemptPlanContext = { errorClass, ...context };
  return nextAttemptPlan(policy, attempt, random, withClass);
}
