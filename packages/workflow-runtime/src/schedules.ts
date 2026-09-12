/**
 * Versioned schedule CRUD and the §25.11 control actions (T014, FR-WF-004,
 * AC-013/AC-014/AC-063; PRD §25.10/§25.11, §33.6).
 *
 * Immutability law: EVERY configuration mutation inserts a NEW
 * `wf.schedule_versions` row and moves `wf.schedules.current_version_id`; the
 * previous row's `superseded_by` is set exactly once (NULL -> non-null). No
 * code path updates a version's configuration in place — the SQL trigger would
 * refuse it anyway. A run therefore keeps the version it started on (AC-013).
 *
 * The eleven §25.11 actions dispatch through `applyScheduleControl`:
 * CREATE, EDIT_DRAFT, VALIDATE, ENABLE, PAUSE, RESUME, RUN_NOW, DRY_RUN,
 * DUPLICATE, DISABLE, DELETE. ENABLE refuses without a FRESH §33.6 forecast
 * (AC-063) and persists the accepted forecast; DRY_RUN resolves the whole
 * pipeline but commits no run, no outbox row, and no opportunity influence.
 *
 * Strictly read-only: schedule control can pause, disable, and dry-run
 * automation; it can never trade, custody, sign, handle keys, or submit a
 * transaction.
 */
import { randomUUID } from 'node:crypto';
import {
  ConcurrencyPolicy,
  ErrorCode,
  ForesiftError,
  ScheduleStatus,
  defaultConcurrencyFor,
  parseScheduleControlAction,
  type ScheduleControlAction,
  type WorkflowWorkloadKind,
} from '@foresift/domain';
import { CostForecastPayloadSchema, type CostForecastPayload } from '@foresift/shared-schemas';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { recordTriggerDelivery, type TriggerDeliveryResult } from './trigger-inbox.ts';
import { WF_STANDARD_STEP_ORDER } from './steps.ts';

/** Documented AC-063 freshness window: a forecast older than this is stale. */
export const FORECAST_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Tolerated clock skew for a forecast computed "in the future". */
export const FORECAST_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The hashable, persisted schedule configuration. */
export interface ResolvedScheduleConfig {
  readonly name: string;
  readonly cron: string;
  readonly timezone: string;
  readonly destination: string;
  readonly concurrencyPolicy: ConcurrencyPolicy;
  readonly workloadKind: WorkflowWorkloadKind;
  readonly shadow: boolean;
}

/** Partial configuration patch; CREATE requires the four identity fields. */
export interface ScheduleConfigPatch {
  readonly name?: string;
  readonly cron?: string;
  readonly timezone?: string;
  readonly destination?: string;
  readonly concurrencyPolicy?: ConcurrencyPolicy;
  readonly shadow?: boolean;
  readonly workloadKind?: WorkflowWorkloadKind;
}

export interface ScheduleControlInput {
  readonly action: ScheduleControlAction;
  readonly scheduleId: string;
  /** Injected clock; defaults to wall clock. */
  readonly now?: string;
  /** CREATE/EDIT_DRAFT configuration patch. */
  readonly config?: ScheduleConfigPatch;
  /** ENABLE §33.6 forecast payload (must carry `computedAt`). */
  readonly forecast?: unknown;
  /** §25.6 workload kind used when no policy is pinned. */
  readonly workloadKind?: WorkflowWorkloadKind;
  /** Deterministic id overrides (tests) or admin-supplied request identity. */
  readonly versionId?: string;
  readonly forecastId?: string;
  readonly requestId?: string;
  readonly newScheduleId?: string;
}

export interface ScheduleControlResult {
  readonly action: ScheduleControlAction;
  readonly scheduleId: string;
  readonly status: ScheduleStatus;
  readonly versionId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ScheduleValidationReport {
  readonly valid: true;
  readonly scheduleId: string;
  readonly versionId: string | null;
  readonly configHash: string;
  readonly resolvedConfig: ResolvedScheduleConfig;
}

export interface ScheduleDryRunReport {
  readonly dryRun: true;
  readonly scheduleId: string;
  readonly versionId: string;
  readonly configHash: string;
  readonly resolvedConfig: ResolvedScheduleConfig;
  readonly concurrencyPolicy: ConcurrencyPolicy;
  readonly concurrencyOutcome: ConcurrencyPolicy;
  readonly wouldStartRun: boolean;
  readonly standardStepOrder: readonly string[];
  /** A dry run exerts no opportunity influence and commits no outbox row. */
  readonly opportunityInfluence: false;
  readonly outboxCommitted: false;
}

interface ScheduleRow {
  readonly schedule_id: string;
  readonly name: string;
  readonly concurrency_policy: string;
  readonly status: string;
  readonly current_version_id: string | null;
}

interface VersionRow {
  readonly version_id: string;
  readonly schedule_id: string;
  readonly config_hash: string;
  readonly resolved_config: unknown;
  readonly shadow: boolean;
  readonly superseded_by: string | null;
}

function nowIso(input?: string): string {
  const now = input ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_CONFIG_INVALID, 'now is not a timestamp', {
      now,
    });
  }
  return now;
}

// --- cron + timezone validation (implemented locally, no new dependency) ----

const CRON_FIELD_BOUNDS: readonly (readonly [number, number])[] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 are Sunday)
];

function parseCronValue(token: string, min: number, max: number, field: string): void {
  if (!/^\d{1,2}$/.test(token)) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_CRON_INVALID, `cron ${field} value is invalid`, {
      field,
      token,
    });
  }
  const value = Number(token);
  if (value < min || value > max) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULE_CRON_INVALID,
      `cron ${field} value is outside ${min}-${max}`,
      { field, value },
    );
  }
}

/**
 * Validate a 5-field cron expression (`minute hour day-of-month month
 * day-of-week`). Supported per field: `*`, `a`, `a-b`, `*\/n`, `a-b/n`, and
 * comma lists of those. Anything else — including `@daily` aliases, `?`, and
 * `L` — is refused fail-closed rather than guessed.
 */
export function validateCronExpression(expression: unknown): string {
  if (typeof expression !== 'string') {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_CRON_INVALID, 'cron expression must be a string');
  }
  const trimmed = expression.trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULE_CRON_INVALID,
      'cron expression must have exactly five fields',
      { fields: fields.length },
    );
  }
  fields.forEach((field, index) => {
    const bounds = CRON_FIELD_BOUNDS[index];
    if (bounds === undefined) return;
    const [min, max] = bounds;
    const label = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'][index] ?? 'field';
    for (const item of field.split(',')) {
      if (item.length === 0) {
        throw new ForesiftError(ErrorCode.WF_SCHEDULE_CRON_INVALID, `cron ${label} list is empty`);
      }
      const [range, step, ...rest] = item.split('/');
      if (rest.length > 0 || range === undefined) {
        throw new ForesiftError(
          ErrorCode.WF_SCHEDULE_CRON_INVALID,
          `cron ${label} entry is invalid`,
          { field: label, item },
        );
      }
      if (step !== undefined) {
        if (!/^\d{1,2}$/.test(step) || Number(step) < 1) {
          throw new ForesiftError(
            ErrorCode.WF_SCHEDULE_CRON_INVALID,
            `cron ${label} step must be a positive integer`,
            { field: label, step },
          );
        }
      }
      if (range === '*') continue;
      const [start, end, ...extra] = range.split('-');
      if (extra.length > 0 || start === undefined) {
        throw new ForesiftError(
          ErrorCode.WF_SCHEDULE_CRON_INVALID,
          `cron ${label} range is invalid`,
          { field: label, item },
        );
      }
      parseCronValue(start, min, max, label);
      if (end !== undefined) {
        parseCronValue(end, min, max, label);
        if (Number(start) > Number(end)) {
          throw new ForesiftError(
            ErrorCode.WF_SCHEDULE_CRON_INVALID,
            `cron ${label} range start exceeds end`,
            { field: label, item },
          );
        }
      }
    }
  });
  return trimmed;
}

/** Validate an IANA timezone name through the platform's own tz database. */
export function validateIanaTimezone(timezone: unknown): string {
  if (typeof timezone !== 'string' || timezone.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULE_TIMEZONE_INVALID,
      'timezone must be a non-empty string',
    );
  }
  const trimmed = timezone.trim();
  if (trimmed === 'UTC' || trimmed === 'Etc/UTC') return trimmed;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
  } catch {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_TIMEZONE_INVALID, 'unknown IANA timezone', {
      timezone: trimmed,
    });
  }
  return trimmed;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_CONFIG_INVALID, `${field} is required`, {
      field,
    });
  }
  return value.trim();
}

/**
 * Resolve a configuration patch over an optional base into the immutable
 * version configuration. Cron and timezone are validated here, so an invalid
 * schedule can never reach the database.
 */
export function resolveScheduleConfig(
  patch: ScheduleConfigPatch,
  base?: ResolvedScheduleConfig,
): ResolvedScheduleConfig {
  const name = requireText(patch.name ?? base?.name, 'name');
  const cron = validateCronExpression(patch.cron ?? base?.cron);
  const timezone = validateIanaTimezone(patch.timezone ?? base?.timezone);
  const destination = requireText(patch.destination ?? base?.destination, 'destination');
  const workloadKind =
    patch.workloadKind ?? base?.workloadKind ?? ('BROAD_SCAN' satisfies WorkflowWorkloadKind);
  const concurrencyPolicy =
    patch.concurrencyPolicy ??
    base?.concurrencyPolicy ??
    defaultConcurrencyFor(patch.workloadKind ?? base?.workloadKind ?? 'BROAD_SCAN');
  const shadow = patch.shadow ?? base?.shadow ?? false;
  return { name, cron, timezone, destination, concurrencyPolicy, workloadKind, shadow };
}

/** Parse and freshness-check a §33.6 forecast against an enable/resume instant. */
export function assertForecastFresh(
  forecast: unknown,
  now: string,
  freshnessWindowMs: number = FORECAST_FRESHNESS_WINDOW_MS,
): CostForecastPayload {
  if (forecast === null || forecast === undefined) {
    throw new ForesiftError(
      ErrorCode.WF_FORECAST_MISSING,
      'enable requires a §33.6 cost forecast payload',
    );
  }
  const parsed = CostForecastPayloadSchema.safeParse(forecast);
  if (!parsed.success) {
    throw new ForesiftError(
      ErrorCode.WF_FORECAST_MISSING,
      'enable requires a valid §33.6 cost forecast payload',
    );
  }
  const computedAtMs = Date.parse(parsed.data.computedAt);
  const nowMs = Date.parse(now);
  if (computedAtMs > nowMs + FORECAST_CLOCK_SKEW_MS) {
    throw new ForesiftError(
      ErrorCode.WF_FORECAST_STALE,
      'forecast is computed in the future; refusing to enable on an implausible forecast',
      { computedAt: parsed.data.computedAt, now },
    );
  }
  if (nowMs - computedAtMs > freshnessWindowMs) {
    throw new ForesiftError(
      ErrorCode.WF_FORECAST_STALE,
      'forecast is older than the freshness window',
      {
        computedAt: parsed.data.computedAt,
        now,
        freshnessWindowMs,
      },
    );
  }
  return parsed.data;
}

// --- version store primitives ---------------------------------------------

async function loadSchedule(engine: DatabaseEngine, scheduleId: string): Promise<ScheduleRow> {
  const result = await engine.query<ScheduleRow>(
    `SELECT schedule_id, name, concurrency_policy, status, current_version_id
       FROM wf.schedules WHERE schedule_id = $1`,
    [scheduleId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_NOT_FOUND, 'unknown schedule', { scheduleId });
  }
  return row;
}

async function loadVersion(
  engine: DatabaseEngine,
  scheduleId: string,
  versionId: string,
): Promise<VersionRow> {
  const result = await engine.query<VersionRow>(
    `SELECT version_id, schedule_id, config_hash, resolved_config, shadow, superseded_by
       FROM wf.schedule_versions WHERE version_id = $1 AND schedule_id = $2`,
    [versionId, scheduleId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_VERSION_NOT_FOUND, 'unknown schedule version', {
      scheduleId,
      versionId,
    });
  }
  return row;
}

async function loadCurrentVersion(
  engine: DatabaseEngine,
  schedule: ScheduleRow,
): Promise<VersionRow> {
  if (schedule.current_version_id === null) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULE_VERSION_NOT_FOUND,
      'schedule has no current immutable version',
      { scheduleId: schedule.schedule_id },
    );
  }
  return loadVersion(engine, schedule.schedule_id, schedule.current_version_id);
}

/**
 * Re-validate a stored version configuration instead of trusting the JSONB:
 * `resolveScheduleConfig` re-checks name/cron/timezone/destination and
 * re-derives the concurrency policy, so a hand-edited or drifted row fails
 * closed at read time.
 */
function configFromVersion(version: VersionRow): ResolvedScheduleConfig {
  const config = version.resolved_config;
  if (config === null || typeof config !== 'object') {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULE_CONFIG_INVALID,
      'stored schedule version configuration is not an object',
      { versionId: version.version_id },
    );
  }
  return resolveScheduleConfig(config as ScheduleConfigPatch);
}

/**
 * Insert a NEW immutable version and point the schedule at it. The previous
 * version's `superseded_by` is set exactly once; the SQL trigger is the final
 * guard.
 */
async function appendVersion(
  engine: DatabaseEngine,
  input: {
    scheduleId: string;
    config: ResolvedScheduleConfig;
    now: string;
    versionId?: string;
    previousVersionId: string | null;
  },
): Promise<VersionRow> {
  const configHash = sha256Text(canonicalJson(input.config));
  const versionId = input.versionId ?? `wfv_${randomUUID()}`;
  // Insert the replacement FIRST: `superseded_by` carries an immediate FK to
  // `wf.schedule_versions`, so the pointer may only be set once the new row
  // exists.
  await engine.query(
    `INSERT INTO wf.schedule_versions
       (version_id, schedule_id, config_hash, resolved_config, shadow)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [versionId, input.scheduleId, configHash, JSON.stringify(input.config), input.config.shadow],
  );
  if (input.previousVersionId !== null) {
    const superseded = await engine.query(
      `UPDATE wf.schedule_versions SET superseded_by = $1
        WHERE version_id = $2 AND schedule_id = $3 AND superseded_by IS NULL
        RETURNING version_id`,
      [versionId, input.previousVersionId, input.scheduleId],
    );
    if (superseded.rows.length === 0) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_VERSION_IMMUTABLE,
        'previous schedule version was already superseded or is unknown',
        { scheduleId: input.scheduleId, previousVersionId: input.previousVersionId },
      );
    }
  }
  // Point the schedule at the new version AND refresh its denormalized columns
  // (name/concurrency_policy) so a config change never leaves the schedule row
  // describing the previous version.
  await engine.query(
    `UPDATE wf.schedules
        SET current_version_id = $1, name = $2, concurrency_policy = $3, updated_at = $4
      WHERE schedule_id = $5`,
    [versionId, input.config.name, input.config.concurrencyPolicy, input.now, input.scheduleId],
  );
  return {
    version_id: versionId,
    schedule_id: input.scheduleId,
    config_hash: configHash,
    resolved_config: input.config,
    shadow: input.config.shadow,
    superseded_by: null,
  };
}

/** Current active-run probe used by DRY_RUN and RUN_NOW. */
async function hasActiveRun(engine: DatabaseEngine, scheduleId: string): Promise<boolean> {
  const rows = await engine.query<{ run_id: string }>(
    `SELECT run_id FROM wf.runs
      WHERE schedule_id = $1 AND status IN ('PENDING', 'RUNNING', 'WAITING')
      LIMIT 1`,
    [scheduleId],
  );
  return rows.rows.length > 0;
}

// --- §25.11 actions --------------------------------------------------------

export interface CreateScheduleInput {
  readonly scheduleId: string;
  readonly config: ScheduleConfigPatch;
  readonly now?: string;
  readonly versionId?: string;
}

/** CREATE: a DRAFT schedule with its first immutable version. */
export async function createSchedule(
  engine: DatabaseEngine,
  input: CreateScheduleInput,
): Promise<ScheduleControlResult> {
  const now = nowIso(input.now);
  const config = resolveScheduleConfig(input.config);
  return engine.transaction(async (tx) => {
    const existing = await tx.query(`SELECT schedule_id FROM wf.schedules WHERE schedule_id = $1`, [
      input.scheduleId,
    ]);
    if (existing.rows.length > 0) {
      throw new ForesiftError(ErrorCode.WF_SCHEDULE_TRANSITION_INVALID, 'schedule already exists', {
        scheduleId: input.scheduleId,
      });
    }
    await tx.query(
      `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'DRAFT', $4, $4)`,
      [input.scheduleId, config.name, config.concurrencyPolicy, now],
    );
    const version = await appendVersion(tx, {
      scheduleId: input.scheduleId,
      config,
      now,
      ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
      previousVersionId: null,
    });
    return {
      action: 'CREATE',
      scheduleId: input.scheduleId,
      status: ScheduleStatus.DRAFT,
      versionId: version.version_id,
      details: { configHash: version.config_hash, resolvedConfig: config },
    };
  });
}

/** EDIT_DRAFT: a configuration mutation always appends a new immutable version. */
export async function editScheduleDraft(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult> {
  const now = nowIso(input.now);
  return engine.transaction(async (tx) => {
    const schedule = await loadSchedule(tx, input.scheduleId);
    if (schedule.status === ScheduleStatus.DISABLED) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
        'a DISABLED schedule is not editable; duplicate it into a new draft',
        { scheduleId: input.scheduleId, status: schedule.status },
      );
    }
    const current = await loadCurrentVersion(tx, schedule);
    const config = resolveScheduleConfig(input.config ?? {}, configFromVersion(current));
    const version = await appendVersion(tx, {
      scheduleId: input.scheduleId,
      config,
      now,
      ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
      previousVersionId: current.version_id,
    });
    return {
      action: 'EDIT_DRAFT',
      scheduleId: input.scheduleId,
      status: schedule.status as ScheduleStatus,
      versionId: version.version_id,
      details: {
        supersededVersionId: current.version_id,
        configHash: version.config_hash,
        resolvedConfig: config,
      },
    };
  });
}

/** VALIDATE: cron/timezone/config validation with no state change. */
export async function validateSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleValidationReport> {
  if (input.config !== undefined) {
    const config = resolveScheduleConfig(input.config);
    return {
      valid: true,
      scheduleId: input.scheduleId,
      versionId: null,
      configHash: sha256Text(canonicalJson(config)),
      resolvedConfig: config,
    };
  }
  const schedule = await loadSchedule(engine, input.scheduleId);
  const version = await loadCurrentVersion(engine, schedule);
  const config = resolveScheduleConfig(configFromVersion(version));
  return {
    valid: true,
    scheduleId: input.scheduleId,
    versionId: version.version_id,
    configHash: sha256Text(canonicalJson(config)),
    resolvedConfig: config,
  };
}

/** ENABLE: ACTIVE transition gated on a fresh §33.6 forecast (AC-063). */
export async function enableSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult> {
  const now = nowIso(input.now);
  const forecast = assertForecastFresh(input.forecast, now);
  return engine.transaction(async (tx) => {
    const schedule = await loadSchedule(tx, input.scheduleId);
    if (schedule.status === ScheduleStatus.ACTIVE) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
        'schedule is already ACTIVE',
        {
          scheduleId: input.scheduleId,
        },
      );
    }
    // A soft-DELETED schedule (DELETE tombstones the name and disables it) is
    // terminal: enabling it back would resurrect deleted automation.
    if (schedule.name.endsWith(' (deleted)')) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
        'a deleted schedule cannot be enabled; duplicate it into a new draft',
        { scheduleId: input.scheduleId },
      );
    }
    const version = await loadCurrentVersion(tx, schedule);
    const payloadHash = sha256Text(canonicalJson(forecast));
    const forecastId = input.forecastId ?? `wff_${randomUUID()}`;
    await tx.query(
      `INSERT INTO wf.schedule_forecasts
         (forecast_id, schedule_id, version_id, computed_at, payload, payload_hash, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        forecastId,
        input.scheduleId,
        version.version_id,
        forecast.computedAt,
        JSON.stringify(forecast),
        payloadHash,
        now,
      ],
    );
    await tx.query(
      `UPDATE wf.schedules SET status = 'ACTIVE', updated_at = $1 WHERE schedule_id = $2`,
      [now, input.scheduleId],
    );
    return {
      action: 'ENABLE',
      scheduleId: input.scheduleId,
      status: ScheduleStatus.ACTIVE,
      versionId: version.version_id,
      details: { forecastId, forecastHash: payloadHash, computedAt: forecast.computedAt },
    };
  });
}

async function transitionStatus(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
  from: readonly ScheduleStatus[],
  to: ScheduleStatus,
  action: ScheduleControlAction,
): Promise<ScheduleControlResult> {
  const now = nowIso(input.now);
  return engine.transaction(async (tx) => {
    const schedule = await loadSchedule(tx, input.scheduleId);
    if (!from.includes(schedule.status as ScheduleStatus)) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
        `cannot ${action} a schedule in status ${schedule.status}`,
        { scheduleId: input.scheduleId, status: schedule.status, action },
      );
    }
    await tx.query(`UPDATE wf.schedules SET status = $1, updated_at = $2 WHERE schedule_id = $3`, [
      to,
      now,
      input.scheduleId,
    ]);
    return {
      action,
      scheduleId: input.scheduleId,
      status: to,
      versionId: schedule.current_version_id,
      details: { previousStatus: schedule.status },
    };
  });
}

/** PAUSE: ACTIVE -> PAUSED. Pausing exerts no influence and commits no outbox row. */
export function pauseSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult> {
  return transitionStatus(engine, input, [ScheduleStatus.ACTIVE], ScheduleStatus.PAUSED, 'PAUSE');
}

/** RESUME: PAUSED -> ACTIVE, re-checking the persisted forecast freshness. */
export async function resumeSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult> {
  const now = nowIso(input.now);
  const schedule = await loadSchedule(engine, input.scheduleId);
  if (schedule.status !== ScheduleStatus.PAUSED) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
      `cannot RESUME a schedule in status ${schedule.status}`,
      { scheduleId: input.scheduleId, status: schedule.status },
    );
  }
  const latest = await engine.query<{ computed_at: string }>(
    `SELECT computed_at FROM wf.schedule_forecasts
      WHERE schedule_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [input.scheduleId],
  );
  const computedAt = latest.rows[0]?.computed_at;
  if (computedAt === undefined) {
    throw new ForesiftError(
      ErrorCode.WF_FORECAST_MISSING,
      'resume requires a persisted §33.6 cost forecast',
      { scheduleId: input.scheduleId },
    );
  }
  // Same freshness law as ENABLE, including the future-clock-skew bound: a
  // forecast whose computedAt is implausibly ahead is refused, not trusted.
  if (Date.parse(computedAt) > Date.parse(now) + FORECAST_CLOCK_SKEW_MS) {
    throw new ForesiftError(
      ErrorCode.WF_FORECAST_STALE,
      'persisted forecast is computed in the future on resume',
      { scheduleId: input.scheduleId, computedAt, now },
    );
  }
  if (Date.parse(now) - Date.parse(computedAt) > FORECAST_FRESHNESS_WINDOW_MS) {
    throw new ForesiftError(ErrorCode.WF_FORECAST_STALE, 'persisted forecast is stale on resume', {
      scheduleId: input.scheduleId,
      computedAt,
      now,
    });
  }
  return transitionStatus(engine, input, [ScheduleStatus.PAUSED], ScheduleStatus.ACTIVE, 'RESUME');
}

/** RUN_NOW: an admin trigger through the same idempotent inbox pipeline. */
export async function runScheduleNow(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult & { readonly run: TriggerDeliveryResult }> {
  const now = nowIso(input.now);
  const schedule = await loadSchedule(engine, input.scheduleId);
  if (schedule.status === ScheduleStatus.DISABLED) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_DISABLED, 'cannot RUN_NOW a DISABLED schedule', {
      scheduleId: input.scheduleId,
    });
  }
  if (schedule.status === ScheduleStatus.PAUSED) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULE_PAUSED, 'cannot RUN_NOW a PAUSED schedule', {
      scheduleId: input.scheduleId,
    });
  }
  if (schedule.status !== ScheduleStatus.ACTIVE) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULE_NOT_ACTIVE,
      'RUN_NOW requires an ACTIVE schedule',
      { scheduleId: input.scheduleId, status: schedule.status },
    );
  }
  const requestId = input.requestId ?? `run-now:${input.scheduleId}:${now}`;
  const run = await recordTriggerDelivery(engine, {
    source: 'admin',
    externalMessageId: requestId,
    scheduleId: input.scheduleId,
    scheduledFor: now,
    payloadHash: sha256Text(
      canonicalJson({ action: 'RUN_NOW', scheduleId: input.scheduleId, requestId }),
    ),
    receivedAt: now,
    verifiedAt: now,
    ...(input.workloadKind === undefined ? {} : { workloadKind: input.workloadKind }),
  });
  return {
    action: 'RUN_NOW',
    scheduleId: input.scheduleId,
    status: schedule.status as ScheduleStatus,
    versionId: schedule.current_version_id,
    details: { requestId, runId: run.runId, outcome: run.outcome },
    run,
  };
}

/**
 * DRY_RUN: resolve the schedule/version/policy pipeline and return what WOULD
 * happen. It commits no run, no outbox row, and exerts no opportunity
 * influence — the resolution path only.
 */
export async function dryRunSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleDryRunReport> {
  const schedule = await loadSchedule(engine, input.scheduleId);
  const version = await loadCurrentVersion(engine, schedule);
  const config = configFromVersion(version);
  const resolvedConfig = resolveScheduleConfig({}, config);
  const active = await hasActiveRun(engine, schedule.schedule_id);
  const policy = resolvedConfig.concurrencyPolicy;
  return {
    dryRun: true,
    scheduleId: schedule.schedule_id,
    versionId: version.version_id,
    configHash: version.config_hash,
    resolvedConfig,
    concurrencyPolicy: policy,
    concurrencyOutcome: policy,
    wouldStartRun: !(active && policy === ConcurrencyPolicy.SKIP_IF_RUNNING),
    standardStepOrder: [...WF_STANDARD_STEP_ORDER],
    opportunityInfluence: false,
    outboxCommitted: false,
  };
}

/** DUPLICATE: copy the current configuration into a brand-new DRAFT schedule. */
export async function duplicateSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult> {
  const now = nowIso(input.now);
  return engine.transaction(async (tx) => {
    const schedule = await loadSchedule(tx, input.scheduleId);
    const current = await loadCurrentVersion(tx, schedule);
    const base = configFromVersion(current);
    const newScheduleId = input.newScheduleId ?? `wfs_${randomUUID()}`;
    const config: ResolvedScheduleConfig = {
      ...base,
      name: `${base.name} (copy)`,
    };
    await tx.query(
      `INSERT INTO wf.schedules (schedule_id, name, concurrency_policy, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'DRAFT', $4, $4)`,
      [newScheduleId, config.name, config.concurrencyPolicy, now],
    );
    const version = await appendVersion(tx, {
      scheduleId: newScheduleId,
      config,
      now,
      ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
      previousVersionId: null,
    });
    return {
      action: 'DUPLICATE',
      scheduleId: newScheduleId,
      status: ScheduleStatus.DRAFT,
      versionId: version.version_id,
      details: { sourceScheduleId: schedule.schedule_id, sourceVersionId: current.version_id },
    };
  });
}

/** DISABLE: DRAFT/ACTIVE/PAUSED -> DISABLED. */
export function disableSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult> {
  return transitionStatus(
    engine,
    input,
    [ScheduleStatus.DRAFT, ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED],
    ScheduleStatus.DISABLED,
    'DISABLE',
  );
}

/**
 * DELETE: a fail-closed SOFT delete. The landed schema makes a physical delete
 * impossible by construction — `wf.schedule_versions` refuses DELETE/TRUNCATE
 * (immutability trigger) and `wf.runs`/`wf.trigger_inbox` reference the
 * schedule — so DELETE disables the schedule and marks it deleted, and is
 * refused outright while the schedule is ACTIVE or has any live run.
 */
export async function deleteSchedule(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult> {
  const now = nowIso(input.now);
  return engine.transaction(async (tx) => {
    const schedule = await loadSchedule(tx, input.scheduleId);
    if (schedule.status === ScheduleStatus.ACTIVE) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
        'disable a schedule before deleting it',
        { scheduleId: input.scheduleId, status: schedule.status },
      );
    }
    const live = await tx.query<{ run_id: string }>(
      `SELECT run_id FROM wf.runs
        WHERE schedule_id = $1 AND status IN ('PENDING', 'RUNNING', 'WAITING') LIMIT 1`,
      [input.scheduleId],
    );
    if (live.rows.length > 0) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
        'cannot delete a schedule with live runs',
        { scheduleId: input.scheduleId },
      );
    }
    const alreadyDeleted = schedule.name.endsWith(' (deleted)');
    const name = alreadyDeleted ? schedule.name : `${schedule.name} (deleted)`;
    await tx.query(
      `UPDATE wf.schedules SET status = 'DISABLED', name = $1, updated_at = $2 WHERE schedule_id = $3`,
      [name, now, input.scheduleId],
    );
    return {
      action: 'DELETE',
      scheduleId: input.scheduleId,
      status: ScheduleStatus.DISABLED,
      versionId: schedule.current_version_id,
      details: { softDeleted: true, alreadyDeleted },
    };
  });
}

/**
 * Dispatch one §25.11 control action. The action literal is parsed fail-closed
 * from the closed vocabulary, so an unknown action can never fall through to a
 * default behaviour.
 */
export async function applyScheduleControl(
  engine: DatabaseEngine,
  input: ScheduleControlInput,
): Promise<ScheduleControlResult | ScheduleValidationReport | ScheduleDryRunReport> {
  const action = parseScheduleControlAction(input.action);
  switch (action) {
    case 'CREATE':
      return createSchedule(engine, {
        scheduleId: input.scheduleId,
        config: input.config ?? {},
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
      });
    case 'EDIT_DRAFT':
      return editScheduleDraft(engine, input);
    case 'VALIDATE':
      return validateSchedule(engine, input);
    case 'ENABLE':
      return enableSchedule(engine, input);
    case 'PAUSE':
      return pauseSchedule(engine, input);
    case 'RESUME':
      return resumeSchedule(engine, input);
    case 'RUN_NOW':
      return runScheduleNow(engine, input);
    case 'DRY_RUN':
      return dryRunSchedule(engine, input);
    case 'DUPLICATE':
      return duplicateSchedule(engine, input);
    case 'DISABLE':
      return disableSchedule(engine, input);
    case 'DELETE':
      return deleteSchedule(engine, input);
  }
}
