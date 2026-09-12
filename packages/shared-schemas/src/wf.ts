/**
 * Runtime schemas for the durable workflow substrate (FR-WF-001…008, PRD §25).
 *
 * Every closed vocabulary is imported from `@foresift/domain` and compiled into
 * a Zod enum — the member lists are never restated here, so SQL, domain, and
 * schema can only drift by editing the domain authority. Every object is
 * `.strict()`: unknown keys are refused, never ignored.
 *
 * Immutability by construction: schedule *version* rows have an insert schema
 * only. No update schema is exported anywhere in this module (FR-WF-004).
 */
import { z } from 'zod';
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
} from '@foresift/domain';
import { UtcTimestampSchema } from './data.ts';

export const WF_SCHEMA_REGISTRY_VERSION = 1 as const;

const id = z.string().min(1);
const contentAddress = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const unsignedDecimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().positive();
const dateOnly = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
const jsonRecord = z.record(z.unknown());
const domainEnum = <T extends string>(values: readonly [T, ...T[]] | readonly T[]) =>
  z.enum([...values] as [T, ...T[]]);

// --- closed vocabularies (mirrors of packages/domain/src/wf.ts) ------------

export const TriggerStatusSchema = domainEnum(ALL_TRIGGER_STATUSES);
export const RunStatusSchema = domainEnum(ALL_RUN_STATUSES);
export const StepStatusSchema = domainEnum(ALL_STEP_STATUSES);
export const ScheduleStatusSchema = domainEnum(ALL_SCHEDULE_STATUSES);
export const ConcurrencyPolicySchema = domainEnum(ALL_CONCURRENCY_POLICIES);
export const RetryErrorClassSchema = domainEnum(ALL_RETRY_ERROR_CLASSES);
export const OutboxStatusSchema = domainEnum(ALL_OUTBOX_STATUSES);
export const DeadLetterStatusSchema = domainEnum(ALL_DEAD_LETTER_STATUSES);
export const ScheduleControlActionSchema = domainEnum(ALL_SCHEDULE_CONTROL_ACTIONS);

// --- §25.2 trigger inbox --------------------------------------------------

/**
 * §25.2 record field set PLUS the plan-sanctioned `canonicalExternalMessageId`
 * (T006/T013 canonicalized identity, enforced by the SQL uniqueness
 * constraint) and the row primary key `inboxId`. `canonicalExternalMessageId`
 * and every identity field must be non-empty, and the payload hash must be a
 * full `sha256:<64hex>`. This is the camelCase runtime envelope, not a literal
 * mirror of the SQL column list.
 */
export const TriggerInboxRecordSchema = z
  .object({
    inboxId: id,
    source: id,
    externalMessageId: id,
    canonicalExternalMessageId: id,
    scheduleId: id,
    scheduledFor: UtcTimestampSchema,
    payloadHash: contentAddress,
    receivedAt: UtcTimestampSchema,
    verifiedAt: UtcTimestampSchema.nullable(),
    processedRunId: id.nullable(),
    status: TriggerStatusSchema,
  })
  .strict();

// --- §25.5 step durability ------------------------------------------------

/** Exact §25.5 step record; hashes are `sha256:<64hex>` and attempts are counts. */
export const StepRecordSchema = z
  .object({
    stepId: id,
    runId: id,
    stepType: id,
    idempotencyKey: id,
    attempt: nonNegativeInt,
    inputHash: contentAddress.nullable(),
    outputHash: contentAddress.nullable(),
    status: StepStatusSchema,
    leaseOwner: id.nullable(),
    leaseVersion: nonNegativeInt,
    leaseExpiresAt: UtcTimestampSchema.nullable(),
    startedAt: UtcTimestampSchema.nullable(),
    completedAt: UtcTimestampSchema.nullable(),
    errorClass: RetryErrorClassSchema.nullable(),
    retryable: z.boolean().nullable(),
  })
  .strict();

// --- §25.11 schedules and immutable versions ------------------------------

/**
 * Schedule row. `status` is the persisted §25.11 four-state lifecycle
 * (DRAFT/ACTIVE/PAUSED/DISABLED), the SQL truth of `wf.schedules.status`.
 */
export const ScheduleRowSchema = z
  .object({
    scheduleId: id,
    name: id,
    concurrencyPolicy: ConcurrencyPolicySchema,
    status: ScheduleStatusSchema,
    currentVersionId: id.nullable(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();

/**
 * Immutable configuration version. `supersededBy` points at the replacement
 * version; the row itself is never rewritten (only a new row is inserted).
 */
export const ScheduleVersionRowSchema = z
  .object({
    versionId: id,
    scheduleId: id,
    configHash: contentAddress,
    resolvedConfig: jsonRecord,
    shadow: z.boolean(),
    supersededBy: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();

/** Insert-only mirror of the version row; no update schema exists by design. */
export const ScheduleVersionInsertSchema = ScheduleVersionRowSchema;

// --- §25.2/§25.6 runs -----------------------------------------------------

/**
 * Run row. `concurrencyOutcome` records which §25.6 policy was applied when
 * the run started (the policy decision, distinct from the run's own status),
 * so a policy skip and a duplicate collapse stay distinguishable in telemetry.
 */
export const RunRowSchema = z
  .object({
    runId: id,
    scheduleId: id,
    resolvedScheduleVersion: id,
    inboxId: id,
    triggerSource: id,
    triggerExternalMessageId: id,
    triggerCanonicalExternalMessageId: id,
    concurrencyPolicy: ConcurrencyPolicySchema,
    concurrencyOutcome: ConcurrencyPolicySchema,
    shadow: z.boolean(),
    status: RunStatusSchema,
    deadline: UtcTimestampSchema,
    startedAt: UtcTimestampSchema.nullable(),
    completedAt: UtcTimestampSchema.nullable(),
  })
  .strict();

// --- §26.5 outbox ---------------------------------------------------------

/**
 * §26.5 outbox row envelope. Includes the claim-shape columns
 * `claimFencingToken` (strictly positive when present, mirroring the SQL
 * `claim_fencing_token > 0` CHECK) and `claimExpiresAt`, plus the delivery
 * diagnostics column `lastError`.
 */
export const OutboxRowSchema = z
  .object({
    outboxId: id,
    decisionRef: id,
    alertRef: id.nullable(),
    channel: id,
    payloadHash: contentAddress,
    status: OutboxStatusSchema,
    claimOwner: id.nullable(),
    claimFencingToken: positiveInt.nullable(),
    claimExpiresAt: UtcTimestampSchema.nullable(),
    attempts: nonNegativeInt,
    enqueuedAt: UtcTimestampSchema,
    claimedAt: UtcTimestampSchema.nullable(),
    sentAt: UtcTimestampSchema.nullable(),
    lastError: z.string().nullable(),
  })
  .strict();

// --- §25.9 dead letters ---------------------------------------------------

export const DeadLetterRowSchema = z
  .object({
    deadLetterId: id,
    runId: id,
    stepId: id.nullable(),
    errorClass: RetryErrorClassSchema,
    context: jsonRecord,
    lastValidCheckpointRef: id.nullable(),
    status: DeadLetterStatusSchema,
    openedAt: UtcTimestampSchema,
    resolvedAt: UtcTimestampSchema.nullable(),
  })
  .strict();

// --- §25.10 reconciliation ------------------------------------------------

export const ReconciliationReportSchema = z
  .object({
    reportId: id,
    checkedAt: UtcTimestampSchema,
    diff: jsonRecord,
    incidentRefs: z.array(id),
  })
  .strict();

// --- §33.6 cost forecast (consumed by the enable gate) --------------------

/**
 * §33.6 projected shape shown before enable. Monetary spend stays an exact
 * decimal string (never binary floating point); storage growth is integer
 * bytes per month.
 */
export const CostForecastPayloadSchema = z
  .object({
    runsPerDay: nonNegativeInt,
    providerCallsPerDay: nonNegativeInt,
    modelTokensPerDay: nonNegativeInt,
    estimatedModelSpendPerDay: unsignedDecimal,
    quotaExhaustionDate: dateOnly.nullable(),
    storageGrowthPerMonth: nonNegativeInt,
  })
  .strict();

// --- registry -------------------------------------------------------------

/**
 * Envelope registry (mirrors the `sig.ts` pattern). Names are stable and map
 * one-to-one to the telemetry catalog's data shapes.
 */
export const WfSchemaRegistry = Object.freeze({
  TriggerInboxRecord: TriggerInboxRecordSchema,
  StepRecord: StepRecordSchema,
  ScheduleRow: ScheduleRowSchema,
  ScheduleVersionRow: ScheduleVersionRowSchema,
  ScheduleVersionInsert: ScheduleVersionInsertSchema,
  RunRow: RunRowSchema,
  OutboxRow: OutboxRowSchema,
  DeadLetterRow: DeadLetterRowSchema,
  ReconciliationReport: ReconciliationReportSchema,
  CostForecastPayload: CostForecastPayloadSchema,
});

export type WfSchemaName = keyof typeof WfSchemaRegistry;

export function parseWfSchema<T extends WfSchemaName>(
  name: T,
  input: unknown,
): z.infer<(typeof WfSchemaRegistry)[T]> {
  return WfSchemaRegistry[name].parse(input);
}

export type TriggerInboxRecord = z.infer<typeof TriggerInboxRecordSchema>;
export type StepRecord = z.infer<typeof StepRecordSchema>;
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;
export type ScheduleVersionRow = z.infer<typeof ScheduleVersionRowSchema>;
export type RunRow = z.infer<typeof RunRowSchema>;
export type OutboxRow = z.infer<typeof OutboxRowSchema>;
export type DeadLetterRow = z.infer<typeof DeadLetterRowSchema>;
export type ReconciliationReport = z.infer<typeof ReconciliationReportSchema>;
export type CostForecastPayload = z.infer<typeof CostForecastPayloadSchema>;
