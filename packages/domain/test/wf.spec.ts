/**
 * Durable-workflow domain suite (T005, FR-WF-001…008).
 * Pins the §25.8 retry taxonomy as a total function, the FR-WF-008 shadow
 * influence law, the §25.6 concurrency defaults, and fail-closed parsing of
 * every closed vocabulary in `packages/domain/src/wf.ts`.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_CONCURRENCY_POLICIES,
  ALL_DEAD_LETTER_STATUSES,
  ALL_OUTBOX_STATUSES,
  ALL_RETRY_ERROR_CLASSES,
  ALL_RUN_STATUSES,
  ALL_SCHEDULE_CONTROL_ACTIONS,
  ALL_SCHEDULE_STATUSES,
  ALL_STEP_STATUSES,
  ALL_TRIGGER_STATUSES,
  ConcurrencyPolicy,
  ErrorCode,
  ForesiftError,
  RetryErrorClass,
  defaultConcurrencyFor,
  isRetryable,
  parseConcurrencyPolicy,
  parseDeadLetterStatus,
  parseOutboxStatus,
  parseRetryErrorClass,
  parseRunStatus,
  parseScheduleControlAction,
  parseScheduleStatus,
  parseStepStatus,
  parseTriggerStatus,
  retryPolicyFor,
  shadowSuppressesInfluence,
  type RetryPolicy,
} from '../src/index.ts';

/** The documented §25.8 outcome for every class, in PRD row order. */
const EXPECTED_POLICY_KIND: Readonly<Record<RetryErrorClass, RetryPolicy['kind']>> = {
  AUTH_INVALID_KEY: 'NONE',
  INVALID_INPUT: 'NONE',
  RATE_LIMITED: 'RETRY_AFTER_RESET',
  TIMEOUT_OR_5XX: 'BOUNDED_EXPONENTIAL',
  SCHEMA_DRIFT: 'DEGRADE_NO_REPEAT',
  MODEL_FORMAT_ERROR: 'SINGLE_REPAIR',
  BUDGET_EXCEEDED: 'NONE',
  SERIALIZATION_CONFLICT: 'RETRY_TRANSACTION',
  NOTIFICATION_TRANSIENT: 'RETRY_OUTBOX',
};

const NON_RETRYABLE: readonly RetryErrorClass[] = [
  'AUTH_INVALID_KEY',
  'INVALID_INPUT',
  'SCHEMA_DRIFT',
  'BUDGET_EXCEEDED',
];

describe('§25.8 retry taxonomy is total over all nine classes', () => {
  it('declares exactly the nine PRD error classes', () => {
    expect([...ALL_RETRY_ERROR_CLASSES]).toEqual([
      'AUTH_INVALID_KEY',
      'INVALID_INPUT',
      'RATE_LIMITED',
      'TIMEOUT_OR_5XX',
      'SCHEMA_DRIFT',
      'MODEL_FORMAT_ERROR',
      'BUDGET_EXCEEDED',
      'SERIALIZATION_CONFLICT',
      'NOTIFICATION_TRANSIENT',
    ]);
  });

  it('maps every class to its documented policy kind', () => {
    for (const errorClass of ALL_RETRY_ERROR_CLASSES) {
      expect(retryPolicyFor(errorClass).kind).toBe(EXPECTED_POLICY_KIND[errorClass]);
    }
  });

  it('pins per-class policy detail', () => {
    const auth = retryPolicyFor(RetryErrorClass.AUTH_INVALID_KEY);
    expect(auth).toEqual({ kind: 'NONE', disableOperation: true });
    expect(retryPolicyFor(RetryErrorClass.INVALID_INPUT)).toEqual({ kind: 'NONE' });
    expect(retryPolicyFor(RetryErrorClass.RATE_LIMITED)).toEqual({
      kind: 'RETRY_AFTER_RESET',
      withinBudget: true,
    });
    const timeout = retryPolicyFor(RetryErrorClass.TIMEOUT_OR_5XX);
    expect(timeout.kind).toBe('BOUNDED_EXPONENTIAL');
    if (timeout.kind === 'BOUNDED_EXPONENTIAL') {
      expect(timeout.withJitter).toBe(true);
      expect(timeout.maxAttempts).toBeGreaterThan(0);
      expect(timeout.maxDelayMs).toBeGreaterThanOrEqual(timeout.baseDelayMs);
    }
    expect(retryPolicyFor(RetryErrorClass.SCHEMA_DRIFT)).toEqual({ kind: 'DEGRADE_NO_REPEAT' });
    expect(retryPolicyFor(RetryErrorClass.MODEL_FORMAT_ERROR)).toEqual({ kind: 'SINGLE_REPAIR' });
    expect(retryPolicyFor(RetryErrorClass.BUDGET_EXCEEDED)).toEqual({ kind: 'NONE' });
    expect(retryPolicyFor(RetryErrorClass.SERIALIZATION_CONFLICT)).toEqual({
      kind: 'RETRY_TRANSACTION',
    });
    expect(retryPolicyFor(RetryErrorClass.NOTIFICATION_TRANSIENT)).toEqual({
      kind: 'RETRY_OUTBOX',
    });
  });

  it('isRetryable agrees with the taxonomy for every class', () => {
    for (const errorClass of ALL_RETRY_ERROR_CLASSES) {
      const expected = !NON_RETRYABLE.includes(errorClass);
      expect(isRetryable(retryPolicyFor(errorClass)), errorClass).toBe(expected);
    }
  });

  it('refuses an unknown class instead of returning a policy', () => {
    expect(() => retryPolicyFor('NO_SUCH_CLASS' as RetryErrorClass)).toThrow(ForesiftError);
    try {
      retryPolicyFor('NO_SUCH_CLASS' as RetryErrorClass);
    } catch (error) {
      expect((error as ForesiftError).code).toBe(ErrorCode.WF_RETRY_ERROR_CLASS_UNKNOWN);
    }
  });
});

describe('FR-WF-008 shadow suppression', () => {
  it('refuses opportunity-influencing sends under shadow', () => {
    expect(shadowSuppressesInfluence({ shadow: true, influence: 'OPPORTUNITY_NOTIFICATION' })).toBe(
      true,
    );
    expect(shadowSuppressesInfluence({ shadow: true, influence: 'POLICY_WRITE_BACK' })).toBe(true);
  });

  it('always allows evidence reads, shadow or not', () => {
    expect(shadowSuppressesInfluence({ shadow: true, influence: 'EVIDENCE_READ' })).toBe(false);
    expect(shadowSuppressesInfluence({ shadow: false, influence: 'EVIDENCE_READ' })).toBe(false);
  });

  it('allows everything when the run is not shadow', () => {
    expect(
      shadowSuppressesInfluence({ shadow: false, influence: 'OPPORTUNITY_NOTIFICATION' }),
    ).toBe(false);
    expect(shadowSuppressesInfluence({ shadow: false, influence: 'POLICY_WRITE_BACK' })).toBe(
      false,
    );
  });
});

describe('§25.6 default concurrency', () => {
  it('broad scans skip while a run is in flight', () => {
    expect(defaultConcurrencyFor('BROAD_SCAN')).toBe(ConcurrencyPolicy.SKIP_IF_RUNNING);
  });

  it('candidate rechecks queue rather than drop a required re-evaluation', () => {
    expect(defaultConcurrencyFor('CANDIDATE_RECHECK')).toBe(ConcurrencyPolicy.QUEUE_AFTER_RUNNING);
  });
});

describe('closed vocabularies refuse unknown literals fail-closed', () => {
  const cases: readonly {
    label: string;
    values: readonly string[];
    parse: (value: unknown) => unknown;
    code: ErrorCode;
  }[] = [
    {
      label: 'trigger status',
      values: ALL_TRIGGER_STATUSES,
      parse: parseTriggerStatus,
      code: ErrorCode.WF_TRIGGER_STATUS_UNKNOWN,
    },
    {
      label: 'run status',
      values: ALL_RUN_STATUSES,
      parse: parseRunStatus,
      code: ErrorCode.WF_RUN_STATUS_UNKNOWN,
    },
    {
      label: 'step status',
      values: ALL_STEP_STATUSES,
      parse: parseStepStatus,
      code: ErrorCode.WF_STEP_STATUS_UNKNOWN,
    },
    {
      label: 'schedule status',
      values: ALL_SCHEDULE_STATUSES,
      parse: parseScheduleStatus,
      code: ErrorCode.WF_SCHEDULE_STATUS_UNKNOWN,
    },
    {
      label: 'concurrency policy',
      values: ALL_CONCURRENCY_POLICIES,
      parse: parseConcurrencyPolicy,
      code: ErrorCode.WF_CONCURRENCY_POLICY_UNKNOWN,
    },
    {
      label: 'retry error class',
      values: ALL_RETRY_ERROR_CLASSES,
      parse: parseRetryErrorClass,
      code: ErrorCode.WF_RETRY_ERROR_CLASS_UNKNOWN,
    },
    {
      label: 'outbox status',
      values: ALL_OUTBOX_STATUSES,
      parse: parseOutboxStatus,
      code: ErrorCode.WF_OUTBOX_STATUS_UNKNOWN,
    },
    {
      label: 'dead-letter status',
      values: ALL_DEAD_LETTER_STATUSES,
      parse: parseDeadLetterStatus,
      code: ErrorCode.WF_DEAD_LETTER_STATUS_UNKNOWN,
    },
    {
      label: 'schedule control action',
      values: ALL_SCHEDULE_CONTROL_ACTIONS,
      parse: parseScheduleControlAction,
      code: ErrorCode.WF_SCHEDULE_ACTION_UNKNOWN,
    },
  ];

  it('declares nine non-empty vocabularies', () => {
    for (const c of cases) expect(c.values.length, c.label).toBeGreaterThan(0);
  });

  it('round-trips every declared member', () => {
    for (const c of cases) {
      for (const value of c.values) expect(c.parse(value), `${c.label}:${value}`).toBe(value);
    }
  });

  it('throws the vocabulary-specific stable code for every unknown literal', () => {
    for (const c of cases) {
      for (const bad of ['NOT_A_MEMBER', '', 42, null, undefined, {}, []]) {
        let caught: unknown;
        try {
          c.parse(bad);
        } catch (error) {
          caught = error;
        }
        expect(caught, `${c.label}:${String(bad)}`).toBeInstanceOf(ForesiftError);
        expect((caught as ForesiftError).code).toBe(c.code);
      }
    }
  });
});
