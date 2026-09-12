/**
 * Executable §25.8 retry-policy suite (T019, FR-WF-003, FR-WF-007).
 *
 * Pure-suite totality over all nine error classes plus the failure paths:
 * bounded jitter stays inside its window, every bounded budget exhausts into a
 * typed dead-letter handoff, single repair grants exactly one extra attempt, a
 * rate-limit reset that cannot be waited out inside budget stops, and the
 * no-retry/degrade/disable classes never claim a retry.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_RETRY_ERROR_CLASSES,
  ErrorCode,
  retryPolicyFor,
  TIMEOUT_RETRY_BASE_DELAY_MS,
  TIMEOUT_RETRY_MAX_ATTEMPTS,
  TIMEOUT_RETRY_MAX_DELAY_MS,
  type RetryErrorClass,
} from '@foresift/domain';
import {
  OUTBOX_RETRY_MAX_ATTEMPTS,
  RATE_LIMIT_DEFAULT_MAX_ATTEMPTS,
  boundedExponentialDelay,
  nextAttemptPlan,
  planAttempt,
  TRANSACTION_RETRY_MAX_ATTEMPTS,
} from '../src/index.ts';

const HALF = () => 0.5;

describe('§25.8 taxonomy totality over all nine classes', () => {
  it('produces a valid plan for every error class at every attempt', () => {
    for (const errorClass of ALL_RETRY_ERROR_CLASSES) {
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const plan = planAttempt(errorClass, attempt, HALF);
        expect(['RETRY', 'STOP', 'DISABLE_OPERATION', 'DEGRADE']).toContain(plan.action);
        if (plan.action === 'RETRY') {
          expect(plan.nextAttempt).toBe(attempt + 1);
          expect(plan.delayMs).toBeGreaterThanOrEqual(0);
          expect(plan.exhausted).toBe(false);
          expect(plan.handoff).toBeNull();
        } else {
          expect(plan.nextAttempt).toBeNull();
          expect(plan.delayMs).toBe(0);
          expect(plan.exhausted).toBe(true);
        }
      }
    }
  });

  it('maps AUTH_INVALID_KEY to disable, INVALID_INPUT/BUDGET to stop, SCHEMA_DRIFT to degrade', () => {
    expect(planAttempt('AUTH_INVALID_KEY', 1, HALF).action).toBe('DISABLE_OPERATION');
    expect(planAttempt('INVALID_INPUT', 1, HALF).action).toBe('STOP');
    expect(planAttempt('BUDGET_EXCEEDED', 1, HALF).action).toBe('STOP');
    expect(planAttempt('SCHEMA_DRIFT', 1, HALF).action).toBe('DEGRADE');
  });
});

describe('bounded exponential retry with jitter (TIMEOUT_OR_5XX)', () => {
  const policy = retryPolicyFor('TIMEOUT_OR_5XX');

  it('keeps jitter inside [delay/2, delay] and under the max delay', () => {
    for (let attempt = 1; attempt <= TIMEOUT_RETRY_MAX_ATTEMPTS; attempt += 1) {
      const raw = Math.min(
        TIMEOUT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        TIMEOUT_RETRY_MAX_DELAY_MS,
      );
      const low = boundedExponentialDelay(
        attempt,
        TIMEOUT_RETRY_BASE_DELAY_MS,
        TIMEOUT_RETRY_MAX_DELAY_MS,
        () => 0,
      );
      const high = boundedExponentialDelay(
        attempt,
        TIMEOUT_RETRY_BASE_DELAY_MS,
        TIMEOUT_RETRY_MAX_DELAY_MS,
        () => 0.999_999,
      );
      expect(low).toBeGreaterThanOrEqual(Math.floor(raw / 2));
      expect(high).toBeLessThanOrEqual(raw);
      expect(high).toBeGreaterThanOrEqual(low);
    }
  });

  it('is deterministic for an injected random source', () => {
    const a = nextAttemptPlan(policy, 2, () => 0.25);
    const b = nextAttemptPlan(policy, 2, () => 0.25);
    expect(a.delayMs).toBe(b.delayMs);
    expect(a.delayMs).toBeGreaterThan(0);
  });

  it('exhausts at maxAttempts with a typed handoff', () => {
    const lastRetry = nextAttemptPlan(policy, TIMEOUT_RETRY_MAX_ATTEMPTS - 1, HALF, {
      errorClass: 'TIMEOUT_OR_5XX',
      lastValidCheckpointRef: 'step-7',
    });
    expect(lastRetry.action).toBe('RETRY');

    const exhausted = nextAttemptPlan(policy, TIMEOUT_RETRY_MAX_ATTEMPTS, HALF, {
      errorClass: 'TIMEOUT_OR_5XX',
      lastValidCheckpointRef: 'step-7',
    });
    expect(exhausted.action).toBe('STOP');
    expect(exhausted.exhausted).toBe(true);
    expect(exhausted.handoff).toMatchObject({
      errorClass: 'TIMEOUT_OR_5XX',
      attempts: TIMEOUT_RETRY_MAX_ATTEMPTS,
      lastValidCheckpointRef: 'step-7',
    });
  });

  it('omits the handoff when no error class context is supplied', () => {
    const exhausted = nextAttemptPlan(policy, TIMEOUT_RETRY_MAX_ATTEMPTS, HALF);
    expect(exhausted.handoff).toBeNull();
  });
});

describe('single repair grants exactly one extra attempt (MODEL_FORMAT_ERROR)', () => {
  it('retries once and then stops', () => {
    const first = planAttempt('MODEL_FORMAT_ERROR', 1, HALF);
    expect(first.action).toBe('RETRY');
    expect(first.nextAttempt).toBe(2);
    const second = planAttempt('MODEL_FORMAT_ERROR', 2, HALF);
    expect(second.action).toBe('STOP');
    expect(second.handoff?.errorClass).toBe('MODEL_FORMAT_ERROR');
  });
});

describe('retry-after-reset within budget (RATE_LIMITED)', () => {
  it('retries after the advertised reset when it fits the budget', () => {
    const plan = planAttempt('RATE_LIMITED', 1, HALF, {
      retryAfterMs: 5_000,
      budgetRemainingMs: 30_000,
    });
    expect(plan.action).toBe('RETRY');
    expect(plan.delayMs).toBe(5_000);
  });

  it('stops with a handoff when the reset exceeds the budget', () => {
    const plan = planAttempt('RATE_LIMITED', 1, HALF, {
      retryAfterMs: 60_000,
      budgetRemainingMs: 1_000,
    });
    expect(plan.action).toBe('STOP');
    expect(plan.handoff).toMatchObject({ errorClass: 'RATE_LIMITED' });
  });

  it('bounds attempts with the documented default cap when NO budget is declared', () => {
    // Without a declared budget there is nothing to bound the wait, so the
    // retry policy fails closed at a fixed cap instead of retrying forever.
    expect(planAttempt('RATE_LIMITED', 1, HALF, { retryAfterMs: 1_000 }).action).toBe('RETRY');
    expect(
      planAttempt('RATE_LIMITED', RATE_LIMIT_DEFAULT_MAX_ATTEMPTS - 1, HALF, {
        retryAfterMs: 1_000,
      }).action,
    ).toBe('RETRY');

    const exhausted = planAttempt('RATE_LIMITED', RATE_LIMIT_DEFAULT_MAX_ATTEMPTS, HALF, {
      retryAfterMs: 1_000,
    });
    expect(exhausted.action).toBe('STOP');
    expect(exhausted.exhausted).toBe(true);
    expect(exhausted.nextAttempt).toBeNull();
    expect(exhausted.handoff).toMatchObject({
      errorClass: 'RATE_LIMITED',
      attempts: RATE_LIMIT_DEFAULT_MAX_ATTEMPTS,
    });
  });

  it('retries far past the default cap while a declared budget covers the reset', () => {
    const plan = planAttempt('RATE_LIMITED', 1_000, HALF, {
      retryAfterMs: 1_000,
      budgetRemainingMs: 10 * 60 * 60 * 1000,
    });
    expect(plan.action).toBe('RETRY');
    expect(plan.exhausted).toBe(false);
    expect(plan.nextAttempt).toBe(1_001);
  });

  it('refuses a non-finite reset and stops on an unbounded wait', () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      try {
        planAttempt('RATE_LIMITED', 1, HALF, { retryAfterMs: bad });
        throw new Error('expected a typed refusal');
      } catch (err) {
        expect((err as { code?: string }).code).toBe(ErrorCode.WF_RETRY_POLICY_INVALID);
      }
    }
    // A 30-day reset must never become a 30-day sleep: fail closed to a stop.
    const unbounded = planAttempt('RATE_LIMITED', 1, HALF, {
      retryAfterMs: 30 * 24 * 60 * 60 * 1000,
    });
    expect(unbounded.action).toBe('STOP');
    expect(unbounded.delayMs).toBe(0);
  });
});

describe('transaction and outbox retries are bounded', () => {
  it('retries a serialization conflict and then stops at the cap', () => {
    expect(planAttempt('SERIALIZATION_CONFLICT', 1, HALF).action).toBe('RETRY');
    expect(planAttempt('SERIALIZATION_CONFLICT', TRANSACTION_RETRY_MAX_ATTEMPTS, HALF).action).toBe(
      'STOP',
    );
  });

  it('retries the outbox with bounded jitter and then stops', () => {
    const retry = planAttempt('NOTIFICATION_TRANSIENT', 1, HALF);
    expect(retry.action).toBe('RETRY');
    expect(retry.jittered).toBe(true);
    expect(retry.delayMs).toBeGreaterThan(0);
    expect(planAttempt('NOTIFICATION_TRANSIENT', OUTBOX_RETRY_MAX_ATTEMPTS, HALF).action).toBe(
      'STOP',
    );
  });
});

describe('fail-closed validation', () => {
  it('refuses a non-positive attempt number', () => {
    expect(() => nextAttemptPlan(retryPolicyFor('TIMEOUT_OR_5XX'), 0, HALF)).toThrow();
    try {
      nextAttemptPlan(retryPolicyFor('TIMEOUT_OR_5XX'), -1, HALF);
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.WF_RETRY_POLICY_INVALID);
    }
  });

  it('is total over the closed vocabulary', () => {
    for (const errorClass of ALL_RETRY_ERROR_CLASSES) {
      expect(() => retryPolicyFor(errorClass as RetryErrorClass)).not.toThrow();
    }
  });
});
