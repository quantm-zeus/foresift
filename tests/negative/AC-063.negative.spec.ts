/**
 * AC-063 negative (failure path).
 * Traces: FR-WF-004.
 * AC text (manifest §39.7): "Cost forecast is displayed before schedule
 * enable."
 *
 * There is no enable without a displayable forecast:
 * - a missing, stale, future-dated, or malformed §33.6 payload is refused
 *   typed and the schedule stays DRAFT with no persisted forecast;
 * - a forecast bound to a SUPERSEDED version can never re-enable a schedule:
 *   after PAUSE -> EDIT_DRAFT the persisted v1 forecast is still fresh, but its
 *   version binding refuses the v2 configuration typed, so the schedule stays
 *   PAUSED and the new cost profile must be re-forecast.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import { applyScheduleControl } from '@foresift/workflow-runtime';
import {
  ALL_WF_FORECAST_FIXTURES,
  WF_FORECASTS,
  WF_FORECAST_FRESH_AT,
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

async function createDraft(scheduleId: string, versionId: string): Promise<void> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
    versionId,
    config: buildScheduleDraft(`schedule ${scheduleId}`),
  });
}

describe('AC-063 negative: enable without a fresh, current-version forecast is refused', () => {
  it('refuses ENABLE for absent, stale, future, and malformed forecasts with no state change', async () => {
    const refused = ALL_WF_FORECAST_FIXTURES.filter((fixture) => fixture.expectedError !== null);
    expect(refused.length).toBeGreaterThanOrEqual(4);
    for (const fixture of refused) {
      const scheduleId = `ac063n-${fixture.name}`;
      await createDraft(scheduleId, `ac063n-${fixture.name}-v1`);

      await expectForesiftError(
        applyScheduleControl(tdb.engine, {
          action: 'ENABLE',
          scheduleId,
          now: fixture.now,
          forecast: fixture.payload,
        }),
        fixture.expectedError as string,
      );

      const schedule = await tdb.engine.query<{ status: string }>(
        `SELECT status FROM wf.schedules WHERE schedule_id = $1`,
        [scheduleId],
      );
      expect(schedule.rows[0]?.status).toBe('DRAFT');
      const forecasts = await tdb.engine.query(
        `SELECT forecast_id FROM wf.schedule_forecasts WHERE schedule_id = $1`,
        [scheduleId],
      );
      expect(forecasts.rows).toHaveLength(0);
    }
  });

  it('refuses RESUME when the persisted forecast is bound to a superseded version', async () => {
    const scheduleId = 'ac063n-superseded';
    await createDraft(scheduleId, 'ac063n-sup-v1');
    await applyScheduleControl(tdb.engine, {
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecastId: 'ac063n-sup-forecast-1',
      forecast: WF_FORECASTS.FRESH,
    });
    await applyScheduleControl(tdb.engine, { action: 'PAUSE', scheduleId, now: T0 });
    await applyScheduleControl(tdb.engine, {
      action: 'EDIT_DRAFT',
      scheduleId,
      now: T0,
      versionId: 'ac063n-sup-v2',
      config: { cron: '*/10 * * * *', name: 'ac063 superseded v2' },
    });

    await expectForesiftError(
      applyScheduleControl(tdb.engine, { action: 'RESUME', scheduleId, now: T0 }),
      ErrorCode.WF_FORECAST_STALE,
    );

    const schedule = await tdb.engine.query<{ status: string; current_version_id: string }>(
      `SELECT status, current_version_id FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(schedule.rows[0]?.status).toBe('PAUSED');
    expect(schedule.rows[0]?.current_version_id).toBe('ac063n-sup-v2');

    // The persisted forecast remains bound to (and only to) the superseded v1.
    const forecast = await tdb.engine.query<{ version_id: string; computed_at: string }>(
      `SELECT version_id, computed_at FROM wf.schedule_forecasts WHERE forecast_id = $1`,
      ['ac063n-sup-forecast-1'],
    );
    expect(forecast.rows[0]?.version_id).toBe('ac063n-sup-v1');
    expect(Date.parse(forecast.rows[0]?.computed_at ?? '')).toBe(Date.parse(WF_FORECAST_FRESH_AT));
  });
});
