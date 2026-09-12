/**
 * AC-014 negative (failure path).
 * Traces: FR-WF-004, FR-WF-008.
 * AC text (manifest §39.2): "Admin can validate, enable, pause, resume, run-now,
 * dry-run, and disable a schedule."
 *
 * Failure paths that must stay fail-closed:
 * - an invalid cron/timezone draft is refused typed and never persisted;
 * - ENABLE without a forecast (absent, stale, or malformed) is refused typed
 *   and the schedule stays DRAFT;
 * - RUN_NOW on a DISABLED schedule is refused typed;
 * - DRY_RUN commits no run, no outbox row, and no decision (no opportunity
 *   influence);
 * - RESUME whose persisted forecast belongs to a SUPERSEDED version is refused
 *   typed and the schedule stays PAUSED.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  applyScheduleControl,
  type ScheduleControlResult,
  type ScheduleDryRunReport,
} from '@foresift/workflow-runtime';
import {
  ALL_INVALID_WF_SCHEDULE_DRAFTS,
  ALL_WF_FORECAST_FIXTURES,
  WF_FORECASTS,
  WF_TEST_T0,
  buildScheduleDraft,
} from '../fixtures/wf/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T0 = WF_TEST_T0;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

async function seedActive(scheduleId: string): Promise<void> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
    config: buildScheduleDraft(`schedule ${scheduleId}`, {
      concurrencyPolicy: 'ALLOW_PARALLEL',
    }),
  });
  await applyScheduleControl(tdb.engine, {
    action: 'ENABLE',
    scheduleId,
    now: T0,
    forecast: WF_FORECASTS.FRESH,
  });
}

async function countRows(table: string): Promise<number> {
  const rows = await tdb.engine.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(rows.rows[0]?.n ?? '0');
}

describe('AC-014 negative: invalid configuration and illegal transitions are refused', () => {
  it('refuses every invalid cron and timezone draft typed, persisting no schedule', async () => {
    expect(ALL_INVALID_WF_SCHEDULE_DRAFTS.length).toBeGreaterThan(0);
    for (const draft of ALL_INVALID_WF_SCHEDULE_DRAFTS) {
      expect(draft.expectedError).not.toBeNull();
      const scheduleId = `ac014n-invalid-${draft.name}`;
      await expectForesiftError(
        applyScheduleControl(tdb.engine, {
          action: 'CREATE',
          scheduleId,
          now: T0,
          config: draft.config,
        }),
        draft.expectedError as string,
      );
      const persisted = await tdb.engine.query(
        `SELECT schedule_id FROM wf.schedules WHERE schedule_id = $1`,
        [scheduleId],
      );
      expect(persisted.rows).toHaveLength(0);
    }
  });

  it('refuses ENABLE without a forecast / with a stale or malformed forecast', async () => {
    const nonFresh = ALL_WF_FORECAST_FIXTURES.filter((fixture) => fixture.expectedError !== null);
    expect(nonFresh.length).toBeGreaterThanOrEqual(4);
    for (const fixture of nonFresh) {
      const scheduleId = `ac014n-forecast-${fixture.name}`;
      await applyScheduleControl(tdb.engine, {
        action: 'CREATE',
        scheduleId,
        now: T0,
        config: buildScheduleDraft(`schedule ${scheduleId}`),
      });
      await expectForesiftError(
        applyScheduleControl(tdb.engine, {
          action: 'ENABLE',
          scheduleId,
          now: fixture.now,
          forecast: fixture.payload,
        }),
        fixture.expectedError as string,
      );
      const row = await tdb.engine.query<{ status: string }>(
        `SELECT status FROM wf.schedules WHERE schedule_id = $1`,
        [scheduleId],
      );
      expect(row.rows[0]?.status).toBe('DRAFT');
      // No accepted forecast was persisted for a refused enable.
      const forecasts = await tdb.engine.query(
        `SELECT forecast_id FROM wf.schedule_forecasts WHERE schedule_id = $1`,
        [scheduleId],
      );
      expect(forecasts.rows).toHaveLength(0);
    }
  });

  it('refuses RUN_NOW on a DISABLED schedule', async () => {
    const scheduleId = 'ac014n-run-now-disabled';
    await seedActive(scheduleId);
    await applyScheduleControl(tdb.engine, { action: 'DISABLE', scheduleId, now: T0 });

    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        action: 'RUN_NOW',
        scheduleId,
        now: T0,
        requestId: 'ac014n-run-now-disabled-1',
      }),
      ErrorCode.WF_SCHEDULE_DISABLED,
    );
    const runs = await tdb.engine.query(`SELECT run_id FROM wf.runs WHERE schedule_id = $1`, [
      scheduleId,
    ]);
    expect(runs.rows).toHaveLength(0);
  });

  it('leaves no outbox row and no decision from a DRY_RUN', async () => {
    const scheduleId = 'ac014n-dry-run';
    await seedActive(scheduleId);

    const outboxBefore = await countRows('wf.notification_outbox');
    const decisionsBefore = await countRows('wf.decision_commits');
    const runsBefore = await countRows('wf.runs');

    const report = (await applyScheduleControl(tdb.engine, {
      action: 'DRY_RUN',
      scheduleId,
      now: T0,
    })) as ScheduleDryRunReport;
    expect(report.dryRun).toBe(true);
    expect(report.opportunityInfluence).toBe(false);
    expect(report.outboxCommitted).toBe(false);

    expect(await countRows('wf.notification_outbox')).toBe(outboxBefore);
    expect(await countRows('wf.decision_commits')).toBe(decisionsBefore);
    expect(await countRows('wf.runs')).toBe(runsBefore);
  });

  it('refuses RESUME when the persisted forecast belongs to a superseded version', async () => {
    const scheduleId = 'ac014n-superseded-resume';
    await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId,
      now: T0,
      versionId: 'ac014n-sr-v1',
      config: buildScheduleDraft('superseded resume'),
    });
    await applyScheduleControl(tdb.engine, {
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecastId: 'ac014n-sr-forecast-1',
      forecast: WF_FORECASTS.FRESH,
    });
    await applyScheduleControl(tdb.engine, { action: 'PAUSE', scheduleId, now: T0 });

    const edited = (await applyScheduleControl(tdb.engine, {
      action: 'EDIT_DRAFT',
      scheduleId,
      now: T0,
      versionId: 'ac014n-sr-v2',
      config: { cron: '*/10 * * * *' },
    })) as ScheduleControlResult;
    expect(edited.versionId).toBe('ac014n-sr-v2');

    await expectForesiftError(
      applyScheduleControl(tdb.engine, { action: 'RESUME', scheduleId, now: T0 }),
      ErrorCode.WF_FORECAST_STALE,
    );

    const row = await tdb.engine.query<{ status: string; current_version_id: string }>(
      `SELECT status, current_version_id FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(row.rows[0]?.status).toBe('PAUSED');
    expect(row.rows[0]?.current_version_id).toBe('ac014n-sr-v2');
  });
});
