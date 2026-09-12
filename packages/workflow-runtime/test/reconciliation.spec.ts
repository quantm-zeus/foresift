/**
 * Schedule reconciliation suite (T026, FR-WF-005; PRD §25.10). Runs on PGlite
 * with a recording fake `SchedulerPort`.
 *
 * Proven here:
 * - all five §25.10 skew classes (presence both ways, cron/timezone, paused
 *   state, destination, external id) are detected;
 * - a `wf.reconciliation_reports` row is always persisted and every mismatch
 *   raises an incident;
 * - opt-in repair propagates a database pause and NEVER unpauses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  ReconciliationDimension,
  localExternalId,
  reconcileSchedules,
  type SchedulerPort,
  type SchedulerSchedule,
  type SchedulerScheduleInput,
} from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';
import { seedSchedule } from './lifecycle-fixtures.ts';

const T0 = '2026-06-01T12:00:00.000Z';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

/** Recording fake scheduler: hand-built external rows + captured updates. */
class RecordingSchedulerPort implements SchedulerPort {
  private readonly rows = new Map<string, SchedulerSchedule>();
  readonly updates: { readonly externalId: string; readonly input: SchedulerScheduleInput }[] = [];

  constructor(initial: readonly SchedulerSchedule[] = []) {
    for (const row of initial) this.rows.set(row.externalId, { ...row });
  }

  create(input: SchedulerScheduleInput): Promise<SchedulerSchedule> {
    const externalId = localExternalId(input.scheduleId);
    const row: SchedulerSchedule = { externalId, ...input };
    this.rows.set(externalId, row);
    return Promise.resolve({ ...row });
  }

  update(externalId: string, input: SchedulerScheduleInput): Promise<SchedulerSchedule> {
    this.updates.push({ externalId, input: { ...input } });
    const row: SchedulerSchedule = { externalId, ...input };
    this.rows.set(externalId, row);
    return Promise.resolve({ ...row });
  }

  delete(externalId: string): Promise<void> {
    this.rows.delete(externalId);
    return Promise.resolve();
  }

  get(externalId: string): Promise<SchedulerSchedule | null> {
    const row = this.rows.get(externalId);
    return Promise.resolve(row === undefined ? null : { ...row });
  }

  list(): Promise<readonly SchedulerSchedule[]> {
    return Promise.resolve([...this.rows.values()].map((row) => ({ ...row })));
  }

  get size(): number {
    return this.rows.size;
  }
}

function external(
  scheduleId: string,
  overrides: Partial<SchedulerSchedule> = {},
): SchedulerSchedule {
  return {
    externalId: localExternalId(scheduleId),
    scheduleId,
    cron: '*/5 * * * *',
    timezone: 'UTC',
    paused: false,
    destination: `local://internal/schedules/${scheduleId}`,
    ...overrides,
  };
}

describe('§25.10 reconciliation (FR-WF-005)', () => {
  it('persists a clean report and raises no incident when nothing drifts', async () => {
    const schedule = await seedSchedule(tdb.engine, { scheduleId: 'sched-consistent' });
    const port = new RecordingSchedulerPort([
      external('sched-consistent', {
        cron: schedule.config.cron,
        timezone: schedule.config.timezone,
        destination: schedule.config.destination,
      }),
    ]);

    const result = await reconcileSchedules(tdb.engine, port, {
      now: T0,
      reportId: 'report-clean',
    });
    expect(result.skews).toEqual([]);
    expect(result.incidents).toEqual([]);
    expect(result.incidentRefs).toEqual([]);
    expect(result.diffHash.startsWith('sha256:')).toBe(true);

    const report = await tdb.engine.query<{ report_id: string; incident_refs: string[] }>(
      `SELECT report_id, incident_refs FROM wf.reconciliation_reports WHERE report_id = $1`,
      ['report-clean'],
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.incident_refs).toEqual([]);
  });

  it('detects all five skew classes, persists a report, and raises an incident each', async () => {
    // 1a. Real database schedule with no external counterpart.
    const missingExternal = await seedSchedule(tdb.engine, {
      scheduleId: 'sched-missing-external',
    });
    // 1b. External schedule with no database counterpart (its own skew).
    // 2. Cron + timezone skew.
    const cronDrift = await seedSchedule(tdb.engine, { scheduleId: 'sched-cron' });
    // 3. Paused-state skew in the SAFE direction (db PAUSED, external running).
    const pausedDb = await seedSchedule(tdb.engine, {
      scheduleId: 'sched-paused',
      status: 'PAUSED',
    });
    // 4. Destination skew.
    const destinationDrift = await seedSchedule(tdb.engine, { scheduleId: 'sched-destination' });
    // 5. External-id skew.
    const externalIdDrift = await seedSchedule(tdb.engine, { scheduleId: 'sched-external-id' });
    // A paused-state skew in the UNSAFE direction (db ACTIVE, external paused).
    const unsafePause = await seedSchedule(tdb.engine, { scheduleId: 'sched-active-paused' });
    // The clean schedule from the previous test stays clean.
    const clean = await seedSchedule(tdb.engine, { scheduleId: 'sched-consistent-2' });

    const port = new RecordingSchedulerPort([
      external('sched-consistent'),
      external('sched-consistent-2', {
        cron: clean.config.cron,
        destination: clean.config.destination,
      }),
      external('sched-orphan-external'),
      external('sched-cron', {
        externalId: localExternalId('sched-cron'),
        cron: '*/10 * * * *',
        timezone: 'America/New_York',
      }),
      external('sched-paused', { paused: false }),
      external('sched-destination', { destination: 'ext://different/destination' }),
      external('sched-external-id', { externalId: 'external-id-not-derived' }),
      external('sched-active-paused', { paused: true }),
    ]);

    const result = await reconcileSchedules(tdb.engine, port, {
      now: T0,
      reportId: 'report-drifting',
      repair: true,
    });

    const dimensions = new Set(result.skews.map((s) => s.dimension));
    expect(dimensions).toEqual(new Set(Object.values(ReconciliationDimension)));

    const details = new Set(result.skews.map((s) => s.detail));
    for (const expected of [
      'MISSING_EXTERNAL',
      'MISSING_DATABASE',
      'cron',
      'timezone',
      'paused',
      'destination',
      'externalId',
    ]) {
      expect(details).toContain(expected);
    }

    // One incident per mismatch, recorded in the persisted report.
    expect(result.incidents.length).toBe(result.skews.length);
    expect(result.incidentRefs.length).toBe(result.skews.length);
    for (const incident of result.incidents) {
      expect(incident.reason.length).toBeGreaterThan(0);
      expect(incident.incidentId.startsWith('wfinc_report-drifting_')).toBe(true);
    }

    const report = await tdb.engine.query<{ incident_refs: string[]; diff: unknown }>(
      `SELECT incident_refs, diff FROM wf.reconciliation_reports WHERE report_id = $1`,
      ['report-drifting'],
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.incident_refs.length).toBe(result.skews.length);

    // SAFE repair: the database pause propagates to the external scheduler.
    expect(port.updates).toHaveLength(1);
    expect(port.updates[0]?.externalId).toBe(localExternalId('sched-paused'));
    expect(port.updates[0]?.input.paused).toBe(true);
    const pausedExternal = await port.get(localExternalId('sched-paused'));
    expect(pausedExternal?.paused).toBe(true);
    // UNSAFE repair refused: the externally-paused ACTIVE schedule stays paused.
    const unsafeExternal = await port.get(localExternalId('sched-active-paused'));
    expect(unsafeExternal?.paused).toBe(true);
    expect(result.repaired.map((r) => r.action).sort()).toEqual([
      'PAUSE_EXTERNAL',
      'REFUSED_UNPAUSE',
    ]);
    expect(result.repaired.find((r) => r.action === 'REFUSED_UNPAUSE')?.applied).toBe(false);

    // Sanity: the seeded-but-clean schedule contributes no skew.
    expect(result.skews.some((s) => s.scheduleId === 'sched-consistent-2')).toBe(false);
    expect(result.skews.some((s) => s.scheduleId === missingExternal.scheduleId)).toBe(true);
    expect(result.skews.some((s) => s.scheduleId === cronDrift.scheduleId)).toBe(true);
    expect(result.skews.some((s) => s.scheduleId === pausedDb.scheduleId)).toBe(true);
    expect(result.skews.some((s) => s.scheduleId === destinationDrift.scheduleId)).toBe(true);
    expect(result.skews.some((s) => s.scheduleId === externalIdDrift.scheduleId)).toBe(true);
    expect(result.skews.some((s) => s.scheduleId === unsafePause.scheduleId)).toBe(true);
  });

  it('rejects an invalid reconciliation clock', async () => {
    const port = new RecordingSchedulerPort([]);
    await expectForesiftError(
      reconcileSchedules(tdb.engine, port, { now: 'not-a-timestamp' }),
      ErrorCode.WF_RECONCILIATION_CHECK_INVALID,
    );
  });
});
