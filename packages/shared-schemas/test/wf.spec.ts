/**
 * Durable-workflow shared-schema suite (T005, FR-WF-001…008).
 * Pins the §25.2 inbox and §25.5 step shapes, `.strict()` refusal of unknown
 * keys, the `sha256:<64hex>` hash shape, the closed-vocabulary enums, and the
 * immutability-by-construction rule that no schedule-version update schema is
 * exported.
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
} from '@foresift/domain';
import * as wf from '../src/wf.ts';
import {
  ConcurrencyPolicySchema,
  CostForecastPayloadSchema,
  DeadLetterStatusSchema,
  OutboxRowSchema,
  OutboxStatusSchema,
  ReconciliationReportSchema,
  RetryErrorClassSchema,
  RunStatusSchema,
  ScheduleControlActionSchema,
  ScheduleRowSchema,
  ScheduleStatusSchema,
  ScheduleVersionInsertSchema,
  ScheduleVersionRowSchema,
  StepRecordSchema,
  StepStatusSchema,
  TriggerInboxRecordSchema,
  TriggerStatusSchema,
  WF_SCHEMA_REGISTRY_VERSION,
  WfSchemaRegistry,
  parseWfSchema,
} from '../src/wf.ts';

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const T0 = '2026-06-01T12:00:00.000Z';
const T1 = '2026-06-01T12:00:05.000Z';

/** Exact §25.2 shape. */
const INBOX = {
  source: 'qstash',
  externalMessageId: 'msg-1',
  canonicalExternalMessageId: 'qstash:msg-1',
  scheduleId: 'schedule-1',
  scheduledFor: T0,
  payloadHash: HASH,
  receivedAt: T0,
  verifiedAt: T0,
  processedRunId: null,
  status: 'RECEIVED',
} as const;

/** Exact §25.5 shape. */
const STEP = {
  stepId: 'step-1',
  runId: 'run-1',
  stepType: 'discover_candidates',
  idempotencyKey: 'run-1:discover_candidates:1',
  attempt: 0,
  inputHash: null,
  outputHash: HASH_B,
  status: 'SUCCEEDED',
  leaseOwner: null,
  leaseVersion: 0,
  leaseExpiresAt: null,
  startedAt: T0,
  completedAt: T1,
  errorClass: null,
  retryable: false,
} as const;

describe('§25.2 / §25.5 shapes round-trip', () => {
  it('accepts the exact trigger-inbox record', () => {
    expect(TriggerInboxRecordSchema.parse(INBOX)).toEqual(INBOX);
    expect(parseWfSchema('TriggerInboxRecord', INBOX)).toEqual(INBOX);
    expect(WF_SCHEMA_REGISTRY_VERSION).toBe(1);
  });

  it('accepts the exact step record, including null hashes and error class', () => {
    expect(StepRecordSchema.parse(STEP)).toEqual(STEP);
    expect(parseWfSchema('StepRecord', STEP)).toEqual(STEP);
  });

  it('accepts a failed exhausted step with a typed error class', () => {
    const failed = {
      ...STEP,
      status: 'FAILED_EXHAUSTED',
      errorClass: 'TIMEOUT_OR_5XX',
      retryable: false,
      outputHash: null,
    } as const;
    expect(StepRecordSchema.parse(failed)).toEqual(failed);
  });

  it('refuses negative attempts and negative lease versions', () => {
    expect(StepRecordSchema.safeParse({ ...STEP, attempt: -1 }).success).toBe(false);
    expect(StepRecordSchema.safeParse({ ...STEP, leaseVersion: -1 }).success).toBe(false);
  });

  it('refuses empty identity fields and blank schedule names', () => {
    expect(TriggerInboxRecordSchema.safeParse({ ...INBOX, source: '' }).success).toBe(false);
    expect(TriggerInboxRecordSchema.safeParse({ ...INBOX, externalMessageId: '' }).success).toBe(
      false,
    );
    expect(
      TriggerInboxRecordSchema.safeParse({ ...INBOX, canonicalExternalMessageId: '' }).success,
    ).toBe(false);
    expect(TriggerInboxRecordSchema.safeParse({ ...INBOX, scheduleId: '' }).success).toBe(false);
    expect(ScheduleRowSchema.safeParse({ ...scheduleRow, name: '' }).success).toBe(false);
  });
});

describe('every envelope is .strict() and refuses unknown keys', () => {
  it('refuses an extra key on the inbox and step records', () => {
    expect(TriggerInboxRecordSchema.safeParse({ ...INBOX, extra: true }).success).toBe(false);
    expect(StepRecordSchema.safeParse({ ...STEP, extra: true }).success).toBe(false);
  });

  it('refuses an extra key on every other envelope', () => {
    const envelopes: readonly { name: string; value: unknown }[] = [
      { name: 'ScheduleRow', value: scheduleRow },
      { name: 'ScheduleVersionRow', value: versionRow },
      { name: 'RunRow', value: runRow },
      { name: 'OutboxRow', value: outboxRow },
      { name: 'DeadLetterRow', value: deadLetterRow },
      { name: 'ReconciliationReport', value: reconciliationReport },
      { name: 'CostForecastPayload', value: costForecast },
    ];
    for (const { name, value } of envelopes) {
      const schema = WfSchemaRegistry[name as wf.WfSchemaName];
      expect(schema.safeParse(value).success, name).toBe(true);
      expect(
        schema.safeParse({ ...(value as Record<string, unknown>), extra: 1 }).success,
        name,
      ).toBe(false);
    }
  });
});

describe('hashes are full sha256 content addresses', () => {
  it('refuses malformed inbox and step hashes', () => {
    for (const bad of ['', 'sha256:', 'sha256:abc', 'a'.repeat(64), `sha256:${'A'.repeat(64)}`]) {
      expect(TriggerInboxRecordSchema.safeParse({ ...INBOX, payloadHash: bad }).success).toBe(
        false,
      );
      expect(StepRecordSchema.safeParse({ ...STEP, outputHash: bad }).success).toBe(false);
    }
  });

  it('refuses malformed version config hashes and outbox payload hashes', () => {
    expect(
      ScheduleVersionRowSchema.safeParse({ ...versionRow, configHash: 'sha256:zz' }).success,
    ).toBe(false);
    expect(OutboxRowSchema.safeParse({ ...outboxRow, payloadHash: 'nope' }).success).toBe(false);
    expect(
      ReconciliationReportSchema.safeParse({
        reportId: 'r1',
        checkedAt: T0,
        diff: {},
        incidentRefs: ['i1'],
      }).success,
    ).toBe(true);
  });
});

describe('closed vocabularies mirror the domain arrays', () => {
  const cases: readonly {
    name: string;
    schema: { safeParse: (v: unknown) => { success: boolean } };
    values: readonly string[];
  }[] = [
    { name: 'TriggerStatus', schema: TriggerStatusSchema, values: ALL_TRIGGER_STATUSES },
    { name: 'RunStatus', schema: RunStatusSchema, values: ALL_RUN_STATUSES },
    { name: 'StepStatus', schema: StepStatusSchema, values: ALL_STEP_STATUSES },
    { name: 'ScheduleStatus', schema: ScheduleStatusSchema, values: ALL_SCHEDULE_STATUSES },
    {
      name: 'ConcurrencyPolicy',
      schema: ConcurrencyPolicySchema,
      values: ALL_CONCURRENCY_POLICIES,
    },
    { name: 'RetryErrorClass', schema: RetryErrorClassSchema, values: ALL_RETRY_ERROR_CLASSES },
    { name: 'OutboxStatus', schema: OutboxStatusSchema, values: ALL_OUTBOX_STATUSES },
    {
      name: 'DeadLetterStatus',
      schema: DeadLetterStatusSchema,
      values: ALL_DEAD_LETTER_STATUSES,
    },
    {
      name: 'ScheduleControlAction',
      schema: ScheduleControlActionSchema,
      values: ALL_SCHEDULE_CONTROL_ACTIONS,
    },
  ];

  it('accepts every declared member and refuses unknown literals', () => {
    for (const c of cases) {
      expect(c.values.length, c.name).toBeGreaterThan(0);
      for (const value of c.values)
        expect(c.schema.safeParse(value).success, `${c.name}:${value}`).toBe(true);
      expect(c.schema.safeParse('NOT_A_MEMBER').success, c.name).toBe(false);
    }
  });
});

describe('version rows are immutable by construction', () => {
  it('exports an insert schema and NO update/patch schema', () => {
    expect(ScheduleVersionInsertSchema).toBe(ScheduleVersionRowSchema);
    const updateLike = Object.keys(wf).filter((key) => /update|patch/i.test(key));
    expect(updateLike).toEqual([]);
  });

  it('round-trips a superseded version row (supersede via a NEW row)', () => {
    const superseded = { ...versionRow, supersededBy: 'version-2' };
    expect(ScheduleVersionRowSchema.parse(superseded)).toEqual(superseded);
  });
});

describe('§33.6 cost forecast payload', () => {
  it('accepts the exact shape with an exact decimal spend string', () => {
    expect(CostForecastPayloadSchema.parse(costForecast)).toEqual(costForecast);
  });

  it('refuses a float spend and a malformed quota-exhaustion date', () => {
    expect(
      CostForecastPayloadSchema.safeParse({ ...costForecast, estimatedModelSpendPerDay: 1.5 })
        .success,
    ).toBe(false);
    expect(
      CostForecastPayloadSchema.safeParse({ ...costForecast, quotaExhaustionDate: '2026/06/01' })
        .success,
    ).toBe(false);
  });
});

const scheduleRow = {
  scheduleId: 'schedule-1',
  name: 'broad-scan',
  concurrencyPolicy: 'SKIP_IF_RUNNING',
  active: true,
  currentVersionId: 'version-1',
  createdAt: T0,
  updatedAt: T1,
};

const versionRow = {
  versionId: 'version-1',
  scheduleId: 'schedule-1',
  configHash: HASH,
  resolvedConfig: { cron: '*/5 * * * *', timezone: 'UTC' },
  shadow: false,
  supersededBy: null,
  createdAt: T0,
};

const runRow = {
  runId: 'run-1',
  scheduleId: 'schedule-1',
  resolvedScheduleVersion: 'version-1',
  inboxId: 'inbox-1',
  triggerSource: 'qstash',
  triggerExternalMessageId: 'msg-1',
  triggerCanonicalExternalMessageId: 'qstash:msg-1',
  concurrencyPolicy: 'SKIP_IF_RUNNING',
  concurrencyOutcome: 'SKIP_IF_RUNNING',
  shadow: false,
  status: 'RUNNING',
  deadline: T1,
  startedAt: T0,
  completedAt: null,
};

const outboxRow = {
  outboxId: 'outbox-1',
  decisionRef: 'decision-1',
  alertRef: 'alert-1',
  channel: 'telegram',
  payloadHash: HASH,
  status: 'PENDING',
  claimOwner: null,
  claimFencingToken: null,
  attempts: 0,
  enqueuedAt: T0,
  claimedAt: null,
  sentAt: null,
};

const deadLetterRow = {
  deadLetterId: 'dead-1',
  runId: 'run-1',
  stepId: 'step-1',
  errorClass: 'TIMEOUT_OR_5XX',
  context: { stepType: 'discover_candidates', attempt: 5 },
  lastValidCheckpointRef: 'step-0',
  status: 'OPEN',
  openedAt: T0,
  resolvedAt: null,
};

const reconciliationReport = {
  reportId: 'report-1',
  checkedAt: T0,
  diff: { missingExternal: [], missingDatabase: ['schedule-2'] },
  incidentRefs: ['incident-1'],
};

const costForecast = {
  runsPerDay: 288,
  providerCallsPerDay: 1200,
  modelTokensPerDay: 500000,
  estimatedModelSpendPerDay: '12.50',
  quotaExhaustionDate: '2026-07-01',
  storageGrowthPerMonth: 1073741824,
};
