/**
 * Closed durable-workflow vocabularies and pure laws (FR-WF-001…008, PRD §25).
 *
 * The SQL CHECK literal lists in `migrations/g2_wf_*.sql` and the PRD §25
 * tables are the vocabulary authority; the const objects below transcribe
 * them verbatim. No writer may invent, rename, or omit members. Every parser
 * refuses fail-closed with a stable `ErrorCode` so callers branch on `code`,
 * never on prose.
 *
 * Strictly read-only: nothing here can trade, hold custody, sign, handle
 * private keys, or submit a transaction.
 */
import { ErrorCode, ForesiftError } from './errors.ts';

export const TriggerStatus = {
  RECEIVED: 'RECEIVED',
  VERIFIED: 'VERIFIED',
  PROCESSED: 'PROCESSED',
  DUPLICATE_COLLAPSED: 'DUPLICATE_COLLAPSED',
  REJECTED: 'REJECTED',
} as const;
export type TriggerStatus = (typeof TriggerStatus)[keyof typeof TriggerStatus];

export const RunStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  DEAD_LETTERED: 'DEAD_LETTERED',
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const StepStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_EXHAUSTED: 'FAILED_EXHAUSTED',
  SKIPPED_POLICY: 'SKIPPED_POLICY',
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const ScheduleStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
} as const;
export type ScheduleStatus = (typeof ScheduleStatus)[keyof typeof ScheduleStatus];

/** PRD §25.6 order: SKIP_IF_RUNNING, QUEUE_AFTER_RUNNING, CANCEL_PREVIOUS, ALLOW_PARALLEL. */
export const ConcurrencyPolicy = {
  SKIP_IF_RUNNING: 'SKIP_IF_RUNNING',
  QUEUE_AFTER_RUNNING: 'QUEUE_AFTER_RUNNING',
  CANCEL_PREVIOUS: 'CANCEL_PREVIOUS',
  ALLOW_PARALLEL: 'ALLOW_PARALLEL',
} as const;
export type ConcurrencyPolicy = (typeof ConcurrencyPolicy)[keyof typeof ConcurrencyPolicy];

/** PRD §25.8 row order, verbatim. */
export const RetryErrorClass = {
  AUTH_INVALID_KEY: 'AUTH_INVALID_KEY',
  INVALID_INPUT: 'INVALID_INPUT',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT_OR_5XX: 'TIMEOUT_OR_5XX',
  SCHEMA_DRIFT: 'SCHEMA_DRIFT',
  MODEL_FORMAT_ERROR: 'MODEL_FORMAT_ERROR',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  SERIALIZATION_CONFLICT: 'SERIALIZATION_CONFLICT',
  NOTIFICATION_TRANSIENT: 'NOTIFICATION_TRANSIENT',
} as const;
export type RetryErrorClass = (typeof RetryErrorClass)[keyof typeof RetryErrorClass];

export const OutboxStatus = {
  PENDING: 'PENDING',
  CLAIMED: 'CLAIMED',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SUPPRESSED_SHADOW: 'SUPPRESSED_SHADOW',
  SUPPRESSED_OUTAGE: 'SUPPRESSED_OUTAGE',
} as const;
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export const DeadLetterStatus = {
  OPEN: 'OPEN',
  RETRIED: 'RETRIED',
  RESOLVED: 'RESOLVED',
} as const;
export type DeadLetterStatus = (typeof DeadLetterStatus)[keyof typeof DeadLetterStatus];

/** PRD §25.11 eleven admin control actions, in the PRD's order. */
export const ScheduleControlAction = {
  CREATE: 'CREATE',
  EDIT_DRAFT: 'EDIT_DRAFT',
  VALIDATE: 'VALIDATE',
  ENABLE: 'ENABLE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  RUN_NOW: 'RUN_NOW',
  DRY_RUN: 'DRY_RUN',
  DUPLICATE: 'DUPLICATE',
  DISABLE: 'DISABLE',
  DELETE: 'DELETE',
} as const;
export type ScheduleControlAction =
  (typeof ScheduleControlAction)[keyof typeof ScheduleControlAction];

export const ALL_TRIGGER_STATUSES: readonly TriggerStatus[] = Object.values(TriggerStatus);
export const ALL_RUN_STATUSES: readonly RunStatus[] = Object.values(RunStatus);
export const ALL_STEP_STATUSES: readonly StepStatus[] = Object.values(StepStatus);
export const ALL_SCHEDULE_STATUSES: readonly ScheduleStatus[] = Object.values(ScheduleStatus);
export const ALL_CONCURRENCY_POLICIES: readonly ConcurrencyPolicy[] =
  Object.values(ConcurrencyPolicy);
export const ALL_RETRY_ERROR_CLASSES: readonly RetryErrorClass[] = Object.values(RetryErrorClass);
export const ALL_OUTBOX_STATUSES: readonly OutboxStatus[] = Object.values(OutboxStatus);
export const ALL_DEAD_LETTER_STATUSES: readonly DeadLetterStatus[] =
  Object.values(DeadLetterStatus);
export const ALL_SCHEDULE_CONTROL_ACTIONS: readonly ScheduleControlAction[] =
  Object.values(ScheduleControlAction);

function parseClosed<T extends string>(
  values: readonly T[],
  value: unknown,
  code: ErrorCode,
  label: string,
): T {
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) return value as T;
  throw new ForesiftError(code, `unknown ${label}`, {
    value: typeof value === 'string' ? value : null,
  });
}

export const parseTriggerStatus = (value: unknown): TriggerStatus =>
  parseClosed(ALL_TRIGGER_STATUSES, value, ErrorCode.WF_TRIGGER_STATUS_UNKNOWN, 'trigger status');
export const parseRunStatus = (value: unknown): RunStatus =>
  parseClosed(ALL_RUN_STATUSES, value, ErrorCode.WF_RUN_STATUS_UNKNOWN, 'run status');
export const parseStepStatus = (value: unknown): StepStatus =>
  parseClosed(ALL_STEP_STATUSES, value, ErrorCode.WF_STEP_STATUS_UNKNOWN, 'step status');
export const parseScheduleStatus = (value: unknown): ScheduleStatus =>
  parseClosed(
    ALL_SCHEDULE_STATUSES,
    value,
    ErrorCode.WF_SCHEDULE_STATUS_UNKNOWN,
    'schedule status',
  );
export const parseConcurrencyPolicy = (value: unknown): ConcurrencyPolicy =>
  parseClosed(
    ALL_CONCURRENCY_POLICIES,
    value,
    ErrorCode.WF_CONCURRENCY_POLICY_UNKNOWN,
    'concurrency policy',
  );
export const parseRetryErrorClass = (value: unknown): RetryErrorClass =>
  parseClosed(
    ALL_RETRY_ERROR_CLASSES,
    value,
    ErrorCode.WF_RETRY_ERROR_CLASS_UNKNOWN,
    'retry error class',
  );
export const parseOutboxStatus = (value: unknown): OutboxStatus =>
  parseClosed(ALL_OUTBOX_STATUSES, value, ErrorCode.WF_OUTBOX_STATUS_UNKNOWN, 'outbox status');
export const parseDeadLetterStatus = (value: unknown): DeadLetterStatus =>
  parseClosed(
    ALL_DEAD_LETTER_STATUSES,
    value,
    ErrorCode.WF_DEAD_LETTER_STATUS_UNKNOWN,
    'dead-letter status',
  );
export const parseScheduleControlAction = (value: unknown): ScheduleControlAction =>
  parseClosed(
    ALL_SCHEDULE_CONTROL_ACTIONS,
    value,
    ErrorCode.WF_SCHEDULE_ACTION_UNKNOWN,
    'schedule control action',
  );

/** Lowercase aliases mirroring the `obj.ts` convention. */
export const triggerStatus = parseTriggerStatus;
export const runStatus = parseRunStatus;
export const stepStatus = parseStepStatus;
export const scheduleStatus = parseScheduleStatus;
export const concurrencyPolicy = parseConcurrencyPolicy;
export const retryErrorClass = parseRetryErrorClass;
export const outboxStatus = parseOutboxStatus;
export const deadLetterStatus = parseDeadLetterStatus;
export const scheduleControlAction = parseScheduleControlAction;

/**
 * The retry policy a `RetryErrorClass` resolves to (PRD §25.8). A
 * discriminated union so consumers switch on `kind` and the compiler proves
 * every policy shape is handled.
 */
export interface RetryPolicyNone {
  readonly kind: 'NONE';
  /** Present only for AUTH_INVALID_KEY: the operation is disabled, not merely skipped. */
  readonly disableOperation?: true;
}
export interface RetryPolicyRetryAfterReset {
  readonly kind: 'RETRY_AFTER_RESET';
  readonly withinBudget: true;
}
export interface RetryPolicyBoundedExponential {
  readonly kind: 'BOUNDED_EXPONENTIAL';
  readonly withJitter: true;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}
export interface RetryPolicyDegradeNoRepeat {
  readonly kind: 'DEGRADE_NO_REPEAT';
}
export interface RetryPolicySingleRepair {
  readonly kind: 'SINGLE_REPAIR';
}
export interface RetryPolicyRetryTransaction {
  readonly kind: 'RETRY_TRANSACTION';
}
export interface RetryPolicyRetryOutbox {
  readonly kind: 'RETRY_OUTBOX';
}
export type RetryPolicy =
  | RetryPolicyNone
  | RetryPolicyRetryAfterReset
  | RetryPolicyBoundedExponential
  | RetryPolicyDegradeNoRepeat
  | RetryPolicySingleRepair
  | RetryPolicyRetryTransaction
  | RetryPolicyRetryOutbox;

/**
 * Bounded-exponential defaults: five attempts, 250 ms base, 30 s ceiling.
 * Concrete knobs are policy, not product law — the PRD §25.8 requirement is
 * only "bounded exponential retry with jitter".
 */
export const TIMEOUT_RETRY_MAX_ATTEMPTS = 5 as const;
export const TIMEOUT_RETRY_BASE_DELAY_MS = 250 as const;
export const TIMEOUT_RETRY_MAX_DELAY_MS = 30_000 as const;

const RETRY_POLICY_BY_ERROR_CLASS: Readonly<Record<RetryErrorClass, RetryPolicy>> = {
  AUTH_INVALID_KEY: { kind: 'NONE', disableOperation: true },
  INVALID_INPUT: { kind: 'NONE' },
  RATE_LIMITED: { kind: 'RETRY_AFTER_RESET', withinBudget: true },
  TIMEOUT_OR_5XX: {
    kind: 'BOUNDED_EXPONENTIAL',
    withJitter: true,
    maxAttempts: TIMEOUT_RETRY_MAX_ATTEMPTS,
    baseDelayMs: TIMEOUT_RETRY_BASE_DELAY_MS,
    maxDelayMs: TIMEOUT_RETRY_MAX_DELAY_MS,
  },
  SCHEMA_DRIFT: { kind: 'DEGRADE_NO_REPEAT' },
  MODEL_FORMAT_ERROR: { kind: 'SINGLE_REPAIR' },
  BUDGET_EXCEEDED: { kind: 'NONE' },
  SERIALIZATION_CONFLICT: { kind: 'RETRY_TRANSACTION' },
  NOTIFICATION_TRANSIENT: { kind: 'RETRY_OUTBOX' },
};

/** Total pure law: every one of the nine §25.8 classes maps to a policy. */
export function retryPolicyFor(errorClass: RetryErrorClass): RetryPolicy {
  // Re-parse so an unknown literal reaching this boundary from untrusted
  // state refuses with the typed code instead of returning `undefined`.
  return RETRY_POLICY_BY_ERROR_CLASS[parseRetryErrorClass(errorClass)];
}

/**
 * True when the policy attempts the operation again. `NONE` (no retry) and
 * `DEGRADE_NO_REPEAT` (no automated repeated retry; mark degraded) are the
 * only non-retryable outcomes.
 */
export function isRetryable(policy: RetryPolicy): boolean {
  return policy.kind !== 'NONE' && policy.kind !== 'DEGRADE_NO_REPEAT';
}

/** The three §25/§26 influence surfaces a run can attempt. */
export type ShadowInfluenceKind =
  'OPPORTUNITY_NOTIFICATION' | 'POLICY_WRITE_BACK' | 'EVIDENCE_READ';

export interface ShadowInfluenceInput {
  readonly shadow: boolean;
  readonly influence: ShadowInfluenceKind;
}

/**
 * Opportunity-influencing kinds (FR-WF-008): a shadow run executes fully but
 * must never send a confirmed-opportunity notification or write policy back.
 * Evidence reads are always allowed — shadow runs exist to be evaluated.
 */
const OPPORTUNITY_INFLUENCING_KINDS: readonly ShadowInfluenceKind[] = [
  'OPPORTUNITY_NOTIFICATION',
  'POLICY_WRITE_BACK',
];

/** True iff the input must be refused. Reads are always permitted. */
export function shadowSuppressesInfluence(input: ShadowInfluenceInput): boolean {
  return input.shadow && OPPORTUNITY_INFLUENCING_KINDS.includes(input.influence);
}

/** The two §25.6 default-concurrency workload kinds. */
export type WorkflowWorkloadKind = 'BROAD_SCAN' | 'CANDIDATE_RECHECK';

/**
 * Default concurrency per §25.6. A broad scan is `SKIP_IF_RUNNING`: a second
 * overlapping scan adds cost without new coverage. A candidate recheck is
 * `QUEUE_AFTER_RUNNING`, not `SKIP_IF_RUNNING`: §25.6 requires serialization
 * by candidate/profile, which the run dedupe key
 * `(schedule_id, resolved_schedule_version, inbox_id)` enforces per trigger.
 * `QUEUE_AFTER_RUNNING` is the closest policy because dropping a recheck
 * (`SKIP_IF_RUNNING`) would lose a required lifecycle re-evaluation, and
 * serialization — rather than parallelism — is exactly what queuing yields.
 */
export function defaultConcurrencyFor(kind: WorkflowWorkloadKind): ConcurrencyPolicy {
  switch (kind) {
    case 'BROAD_SCAN':
      return ConcurrencyPolicy.SKIP_IF_RUNNING;
    case 'CANDIDATE_RECHECK':
      return ConcurrencyPolicy.QUEUE_AFTER_RUNNING;
  }
}
