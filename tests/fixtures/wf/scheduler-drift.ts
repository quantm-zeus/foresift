/**
 * Scheduler-drift fixtures (T030, FR-WF-005; PRD §25.10).
 *
 * `reconcileSchedules` diffs database schedules against the external
 * scheduler across five dimensions. Each fixture pins ONE class of skew and
 * carries the exact `(databaseValue, externalValue)` pair the diff must
 * report, so a suite can assert the dimension, the field detail, and both
 * observed values without reconstructing the intent.
 *
 * Covered:
 * 1. PRESENCE        — database schedule missing externally, and an external
 *                      schedule missing in the database;
 * 2. CRON_TIMEZONE   — cron drift (and a companion timezone drift);
 * 3. PAUSED_STATE    — database ACTIVE while externally paused (the unsafe
 *                      direction repair must never "fix");
 * 4. DESTINATION     — delivery destination drift;
 * 5. EXTERNAL_ID     — the external entry exists but under the wrong id.
 *
 * All fixtures are inert data over the real `SchedulerSchedule` /
 * `ResolvedScheduleConfig` shapes.
 */
import {
  ReconciliationDimension,
  localExternalId,
  type ResolvedScheduleConfig,
  type SchedulerSchedule,
} from '@foresift/workflow-runtime';

/** A complete, internally consistent managed-schedule configuration. */
export function buildDriftConfig(
  overrides: Partial<ResolvedScheduleConfig> = {},
): ResolvedScheduleConfig {
  return {
    name: 'wf drift fixture schedule',
    cron: '*/5 * * * *',
    timezone: 'UTC',
    destination: 'https://internal.example.test/wf/trigger',
    concurrencyPolicy: 'ALLOW_PARALLEL',
    workloadKind: 'BROAD_SCAN',
    shadow: false,
    ...overrides,
  };
}

export interface WfDriftDatabaseSchedule {
  readonly scheduleId: string;
  readonly status: 'ACTIVE' | 'PAUSED';
  readonly config: ResolvedScheduleConfig;
}

export interface WfDriftFixture {
  readonly name: string;
  readonly dimension: ReconciliationDimension;
  /** Field-level discriminator the diff emits (`cron`, `paused`, …). */
  readonly detail: string;
  /** `null` models a schedule that exists only in the external scheduler. */
  readonly database: WfDriftDatabaseSchedule | null;
  /** `null` models a schedule that is missing from the scheduler. */
  readonly external: SchedulerSchedule | null;
  readonly expectedDatabaseValue: string | boolean | null;
  readonly expectedExternalValue: string | boolean | null;
  readonly note: string;
}

const BASE_SCHEDULE_ID = 'wf-drift-schedule-1';

function manage(
  config: ResolvedScheduleConfig,
  status: 'ACTIVE' | 'PAUSED' = 'ACTIVE',
  scheduleId: string = BASE_SCHEDULE_ID,
): WfDriftDatabaseSchedule {
  return { scheduleId, status, config };
}

/** Build the external scheduler view for a database schedule. */
export function buildExternalSchedule(
  scheduleId: string,
  overrides: Partial<SchedulerSchedule> = {},
): SchedulerSchedule {
  const config = buildDriftConfig();
  return {
    externalId: localExternalId(scheduleId),
    scheduleId,
    cron: config.cron,
    timezone: config.timezone,
    paused: false,
    destination: config.destination,
    ...overrides,
  };
}

export const WF_SCHEDULER_DRIFT_FIXTURES: Readonly<Record<string, WfDriftFixture>> = Object.freeze({
  MISSING_EXTERNAL: {
    name: 'MISSING_EXTERNAL',
    dimension: ReconciliationDimension.PRESENCE,
    detail: 'MISSING_EXTERNAL',
    database: manage(buildDriftConfig({ cron: '*/5 * * * *' })),
    external: null,
    expectedDatabaseValue: '*/5 * * * *',
    expectedExternalValue: null,
    note: 'managed database schedule has no external counterpart',
  },
  MISSING_DATABASE: {
    name: 'MISSING_DATABASE',
    dimension: ReconciliationDimension.PRESENCE,
    detail: 'MISSING_DATABASE',
    database: null,
    external: buildExternalSchedule('wf-drift-orphan-schedule', { paused: true }),
    expectedDatabaseValue: null,
    expectedExternalValue: 'PAUSED',
    note: 'external entry has no database schedule (repair must never delete it)',
  },
  CRON_TIMEZONE: {
    name: 'CRON_TIMEZONE',
    dimension: ReconciliationDimension.CRON_TIMEZONE,
    detail: 'cron',
    database: manage(buildDriftConfig({ cron: '*/5 * * * *' })),
    external: buildExternalSchedule(BASE_SCHEDULE_ID, { cron: '*/10 * * * *' }),
    expectedDatabaseValue: '*/5 * * * *',
    expectedExternalValue: '*/10 * * * *',
    note: 'external cron drifted from the database version configuration',
  },
  TIMEZONE: {
    name: 'TIMEZONE',
    dimension: ReconciliationDimension.CRON_TIMEZONE,
    detail: 'timezone',
    database: manage(buildDriftConfig({ timezone: 'UTC' })),
    external: buildExternalSchedule(BASE_SCHEDULE_ID, { timezone: 'Europe/London' }),
    expectedDatabaseValue: 'UTC',
    expectedExternalValue: 'Europe/London',
    note: 'timezone drift is reported separately from cron drift',
  },
  PAUSED_STATE: {
    name: 'PAUSED_STATE',
    dimension: ReconciliationDimension.PAUSED_STATE,
    detail: 'paused',
    database: manage(buildDriftConfig(), 'ACTIVE'),
    external: buildExternalSchedule(BASE_SCHEDULE_ID, { paused: true }),
    expectedDatabaseValue: false,
    expectedExternalValue: true,
    note: 'the unsafe direction: repair reports it, never unpauses',
  },
  DESTINATION: {
    name: 'DESTINATION',
    dimension: ReconciliationDimension.DESTINATION,
    detail: 'destination',
    database: manage(buildDriftConfig({ destination: 'https://internal.example.test/wf/a' })),
    external: buildExternalSchedule(BASE_SCHEDULE_ID, {
      destination: 'https://internal.example.test/wf/b',
    }),
    expectedDatabaseValue: 'https://internal.example.test/wf/a',
    expectedExternalValue: 'https://internal.example.test/wf/b',
    note: 'delivery destination drift',
  },
  EXTERNAL_ID: {
    name: 'EXTERNAL_ID',
    dimension: ReconciliationDimension.EXTERNAL_ID,
    detail: 'externalId',
    database: manage(buildDriftConfig()),
    external: buildExternalSchedule(BASE_SCHEDULE_ID, {
      externalId: 'local:wf-drift-schedule-renamed',
    }),
    expectedDatabaseValue: localExternalId(BASE_SCHEDULE_ID),
    expectedExternalValue: 'local:wf-drift-schedule-renamed',
    note: 'the external entry exists but under the wrong external id',
  },
});

/** Every drift fixture; each contributes exactly one skew. */
export const ALL_WF_SCHEDULER_DRIFT_FIXTURES: readonly WfDriftFixture[] = Object.freeze(
  Object.values(WF_SCHEDULER_DRIFT_FIXTURES),
);

/** The five §25.10 dimensions the fixture set collectively covers. */
export const WF_DRIFT_FIXTURE_DIMENSIONS: readonly ReconciliationDimension[] = Object.freeze([
  ...new Set(ALL_WF_SCHEDULER_DRIFT_FIXTURES.map((fixture) => fixture.dimension)),
]);
