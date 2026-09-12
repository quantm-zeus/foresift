/**
 * Schedule reconciliation (T022, FR-WF-005; PRD §25.10).
 *
 * `reconcileSchedules` diffs the database's managed schedules (`ACTIVE` and
 * `PAUSED` — the two lifecycle states that own an external scheduler entry)
 * against `SchedulerPort.list()` across the five §25.10 dimensions:
 *
 * 1. presence (both directions: missing externally, missing in the database);
 * 2. cron/timezone;
 * 3. paused state;
 * 4. destination;
 * 5. external ID.
 *
 * A `wf.reconciliation_reports` row is ALWAYS persisted, and EVERY mismatch
 * raises an incident (one incident reference per skew, recorded in the report
 * and returned so the admin/recovery packages can surface it).
 *
 * Repair is opt-in per call and limited to the SAFE direction: a database
 * `PAUSED` schedule propagates its pause to the external scheduler. Repair never
 * UNPAUSES anything — a database `ACTIVE` schedule whose external counterpart
 * is paused is reported, never "fixed" — and an external schedule whose local
 * counterpart does not exist is never deleted. That asymmetry is the fail-closed
 * direction: a spurious pause costs availability, a spurious resume costs
 * correctness.
 *
 * Strictly read-only: reconciling/pausing a schedule can never trade, custody,
 * sign, handle keys, or submit a transaction.
 */
import { randomUUID } from 'node:crypto';
import { ErrorCode, ForesiftError } from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import { localExternalId, type SchedulerPort, type SchedulerSchedule } from './scheduler-port.ts';
import { resolveScheduleConfig, type ResolvedScheduleConfig } from './schedules.ts';

/** The five §25.10 reconciliation dimensions. */
export const ReconciliationDimension = {
  PRESENCE: 'PRESENCE',
  CRON_TIMEZONE: 'CRON_TIMEZONE',
  PAUSED_STATE: 'PAUSED_STATE',
  DESTINATION: 'DESTINATION',
  EXTERNAL_ID: 'EXTERNAL_ID',
} as const;
export type ReconciliationDimension =
  (typeof ReconciliationDimension)[keyof typeof ReconciliationDimension];
export const ALL_RECONCILIATION_DIMENSIONS: readonly ReconciliationDimension[] =
  Object.values(ReconciliationDimension);

/** One detected skew, carrying both observed values for the admin diff view. */
export interface ReconciliationSkew {
  readonly dimension: ReconciliationDimension;
  /** Field-level detail (`MISSING_EXTERNAL`, `cron`, `paused`, …). */
  readonly detail: string;
  readonly scheduleId: string;
  readonly externalId: string | null;
  readonly databaseValue: string | boolean | null;
  readonly externalValue: string | boolean | null;
}

/** One incident raised for one skew. */
export interface ReconciliationIncident {
  readonly incidentId: string;
  readonly scheduleId: string;
  readonly dimension: ReconciliationDimension;
  readonly detail: string;
  /** Human-actionable reason, safe to render in admin. */
  readonly reason: string;
}

/** One repair attempt (or an explicit refusal to repair). */
export interface ReconciliationRepair {
  readonly scheduleId: string;
  readonly externalId: string | null;
  /** `PAUSE_EXTERNAL` applied the safe direction; `REFUSED_UNPAUSE` never did. */
  readonly action: 'PAUSE_EXTERNAL' | 'REFUSED_UNPAUSE';
  readonly applied: boolean;
  readonly reason: string;
}

export interface ReconciliationReport {
  readonly reportId: string;
  readonly checkedAt: string;
  readonly skews: readonly ReconciliationSkew[];
  readonly incidents: readonly ReconciliationIncident[];
  readonly incidentRefs: readonly string[];
  /** Content address of the persisted diff. */
  readonly diffHash: string;
}

export interface ReconcileSchedulesOptions {
  readonly now?: string;
  /** Opt-in repair (safe direction only). Defaults to false (report only). */
  readonly repair?: boolean;
  readonly reportId?: string;
  /**
   * Maps a database `schedule_id` to the external ID the scheduler MUST hold.
   * Defaults to the local adapter's deterministic `local:<scheduleId>`.
   */
  readonly expectedExternalId?: (scheduleId: string) => string;
}

export interface ReconcileSchedulesResult extends ReconciliationReport {
  readonly repairRequested: boolean;
  readonly repaired: readonly ReconciliationRepair[];
}

interface ManagedScheduleRow {
  readonly schedule_id: string;
  readonly status: string;
  readonly resolved_config: unknown;
}

interface ManagedSchedule {
  readonly scheduleId: string;
  readonly status: string;
  readonly config: ResolvedScheduleConfig;
}

async function loadManagedSchedules(engine: DatabaseEngine): Promise<readonly ManagedSchedule[]> {
  const result = await engine.query<ManagedScheduleRow>(
    `SELECT s.schedule_id, s.status, v.resolved_config
       FROM wf.schedules s
       LEFT JOIN wf.schedule_versions v ON v.version_id = s.current_version_id
      WHERE s.status IN ('ACTIVE', 'PAUSED')
      ORDER BY s.schedule_id`,
  );
  return result.rows.map((row) => {
    if (row.resolved_config === null || typeof row.resolved_config !== 'object') {
      throw new ForesiftError(
        ErrorCode.WF_RECONCILIATION_CHECK_INVALID,
        'managed schedule has no readable current version configuration',
        { scheduleId: row.schedule_id, status: row.status },
      );
    }
    return {
      scheduleId: row.schedule_id,
      status: row.status,
      config: resolveScheduleConfig(row.resolved_config),
    };
  });
}

function skew(
  dimension: ReconciliationDimension,
  detail: string,
  scheduleId: string,
  externalId: string | null,
  databaseValue: string | boolean | null,
  externalValue: string | boolean | null,
): ReconciliationSkew {
  return { dimension, detail, scheduleId, externalId, databaseValue, externalValue };
}

/** The pure five-dimension diff (no I/O), shared by tests and the job. */
export function diffSchedulesAgainstExternal(
  database: readonly {
    readonly scheduleId: string;
    readonly status: string;
    readonly config: ResolvedScheduleConfig;
  }[],
  external: readonly SchedulerSchedule[],
  expectedExternalId: (scheduleId: string) => string = localExternalId,
): readonly ReconciliationSkew[] {
  const skews: ReconciliationSkew[] = [];
  const externalById = new Map(external.map((s) => [s.scheduleId, s]));

  for (const db of database) {
    const ext = externalById.get(db.scheduleId);
    if (ext === undefined) {
      skews.push(
        skew(
          ReconciliationDimension.PRESENCE,
          'MISSING_EXTERNAL',
          db.scheduleId,
          null,
          db.config.cron,
          null,
        ),
      );
      continue;
    }
    if (ext.cron !== db.config.cron) {
      skews.push(
        skew(
          ReconciliationDimension.CRON_TIMEZONE,
          'cron',
          db.scheduleId,
          ext.externalId,
          db.config.cron,
          ext.cron,
        ),
      );
    }
    if (ext.timezone !== db.config.timezone) {
      skews.push(
        skew(
          ReconciliationDimension.CRON_TIMEZONE,
          'timezone',
          db.scheduleId,
          ext.externalId,
          db.config.timezone,
          ext.timezone,
        ),
      );
    }
    const dbPaused = db.status === 'PAUSED';
    if (ext.paused !== dbPaused) {
      skews.push(
        skew(
          ReconciliationDimension.PAUSED_STATE,
          'paused',
          db.scheduleId,
          ext.externalId,
          dbPaused,
          ext.paused,
        ),
      );
    }
    if (ext.destination !== db.config.destination) {
      skews.push(
        skew(
          ReconciliationDimension.DESTINATION,
          'destination',
          db.scheduleId,
          ext.externalId,
          db.config.destination,
          ext.destination,
        ),
      );
    }
    const expectedId = expectedExternalId(db.scheduleId);
    if (ext.externalId !== expectedId) {
      skews.push(
        skew(
          ReconciliationDimension.EXTERNAL_ID,
          'externalId',
          db.scheduleId,
          ext.externalId,
          expectedId,
          ext.externalId,
        ),
      );
    }
  }

  const databaseIds = new Set(database.map((s) => s.scheduleId));
  for (const ext of external) {
    if (!databaseIds.has(ext.scheduleId)) {
      skews.push(
        skew(
          ReconciliationDimension.PRESENCE,
          'MISSING_DATABASE',
          ext.scheduleId,
          ext.externalId,
          null,
          ext.paused ? 'PAUSED' : 'ACTIVE',
        ),
      );
    }
  }

  return skews;
}

function incidentReason(s: ReconciliationSkew): string {
  switch (s.detail) {
    case 'MISSING_EXTERNAL':
      return `schedule ${s.scheduleId} is ${String(s.databaseValue)} in the database but missing from the external scheduler`;
    case 'MISSING_DATABASE':
      return `external schedule ${s.externalId ?? s.scheduleId} has no matching database schedule`;
    case 'cron':
      return `cron drift for ${s.scheduleId}: database ${String(s.databaseValue)} != external ${String(s.externalValue)}`;
    case 'timezone':
      return `timezone drift for ${s.scheduleId}: database ${String(s.databaseValue)} != external ${String(s.externalValue)}`;
    case 'paused':
      return `paused-state drift for ${s.scheduleId}: database ${String(s.databaseValue)} != external ${String(s.externalValue)}`;
    case 'destination':
      return `destination drift for ${s.scheduleId}: database ${String(s.databaseValue)} != external ${String(s.externalValue)}`;
    default:
      return `external-id drift for ${s.scheduleId}: expected ${String(s.databaseValue)} got ${String(s.externalValue)}`;
  }
}

/**
 * Diff managed database schedules against the external scheduler, ALWAYS
 * persist a report, always raise an incident per mismatch, and optionally
 * repair only in the safe (pause-propagating) direction.
 */
export async function reconcileSchedules(
  engine: DatabaseEngine,
  port: SchedulerPort,
  options: ReconcileSchedulesOptions = {},
): Promise<ReconcileSchedulesResult> {
  const checkedAt = options.now ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(checkedAt))) {
    throw new ForesiftError(
      ErrorCode.WF_RECONCILIATION_CHECK_INVALID,
      'reconciliation now is not a timestamp',
      { now: checkedAt },
    );
  }
  const reportId = options.reportId ?? `wfrc_${randomUUID()}`;
  const expectedExternalId = options.expectedExternalId ?? localExternalId;

  const database = await loadManagedSchedules(engine);
  const external = await port.list();
  const skews = diffSchedulesAgainstExternal(database, external, expectedExternalId);
  const incidents: ReconciliationIncident[] = skews.map((s, index) => ({
    incidentId: `wfinc_${reportId}_${index + 1}`,
    scheduleId: s.scheduleId,
    dimension: s.dimension,
    detail: s.detail,
    reason: incidentReason(s),
  }));

  const diff = {
    checkedAt,
    dimensions: ALL_RECONCILIATION_DIMENSIONS,
    skews,
    incidentRefs: incidents.map((i) => i.incidentId),
  };
  const diffHash = sha256Text(canonicalJson(diff));
  await engine.query(
    `INSERT INTO wf.reconciliation_reports (report_id, checked_at, diff, incident_refs)
     VALUES ($1, $2, $3::jsonb, $4::text[])`,
    [reportId, checkedAt, JSON.stringify(diff), incidents.map((i) => i.incidentId)],
  );

  const repaired: ReconciliationRepair[] = [];
  if (options.repair === true) {
    const externalById = new Map(external.map((s) => [s.scheduleId, s]));
    for (const s of skews) {
      if (s.dimension !== ReconciliationDimension.PAUSED_STATE) continue;
      const ext = externalById.get(s.scheduleId);
      if (ext === undefined) continue;
      if (s.databaseValue === true && s.externalValue === false) {
        // SAFE DIRECTION: propagate a database pause to the scheduler.
        await port.update(ext.externalId, {
          scheduleId: ext.scheduleId,
          cron: ext.cron,
          timezone: ext.timezone,
          paused: true,
          destination: ext.destination,
        });
        repaired.push({
          scheduleId: s.scheduleId,
          externalId: ext.externalId,
          action: 'PAUSE_EXTERNAL',
          applied: true,
          reason: 'propagated the database pause to the external scheduler',
        });
      } else if (s.databaseValue === false && s.externalValue === true) {
        // NEVER unpause on our own: report the refusals explicitly.
        repaired.push({
          scheduleId: s.scheduleId,
          externalId: ext.externalId,
          action: 'REFUSED_UNPAUSE',
          applied: false,
          reason: 'repair never unpauses an external schedule; operator action required',
        });
      }
    }
  }

  return {
    reportId,
    checkedAt,
    skews,
    incidents,
    incidentRefs: incidents.map((i) => i.incidentId),
    diffHash,
    repairRequested: options.repair === true,
    repaired,
  };
}
