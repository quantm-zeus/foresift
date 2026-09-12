/**
 * AC-063 acceptance (positive).
 * Traces: FR-WF-004.
 * AC text (manifest §39.7): "Cost forecast is displayed before schedule
 * enable."
 *
 * ENABLE persists the accepted §33.6 forecast and binds it to the version that
 * becomes ACTIVE, so the shown cost profile is exactly the one the schedule
 * runs under. The control result surfaces the forecast id, hash, and
 * computation instant that an admin surface renders before the enable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { applyScheduleControl, type ScheduleControlResult } from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_FORECAST_FRESH_AT,
  WF_TEST_T0,
  buildScheduleDraft,
} from '../fixtures/wf/index.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T0 = WF_TEST_T0;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-063: a fresh forecast is displayed and persisted before enable', () => {
  it('enables with a fresh forecast and persists it bound to the enabled version', async () => {
    const scheduleId = 'ac063-sched-enable';
    await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId,
      now: T0,
      versionId: 'ac063-v1',
      config: buildScheduleDraft('ac063 forecast enable'),
    });

    const enabled = (await applyScheduleControl(tdb.engine, {
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecastId: 'ac063-forecast-1',
      forecast: WF_FORECASTS.FRESH,
    })) as ScheduleControlResult;

    expect(enabled.status).toBe('ACTIVE');
    expect(enabled.versionId).toBe('ac063-v1');
    // The accepted forecast is "displayed" on the result: id, content hash,
    // and the instant it was computed.
    expect(enabled.details.forecastId).toBe('ac063-forecast-1');
    expect(String(enabled.details.forecastHash)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(enabled.details.computedAt).toBe(WF_FORECAST_FRESH_AT);

    const persisted = await tdb.engine.query<{
      schedule_id: string;
      version_id: string;
      computed_at: string;
      payload: unknown;
      payload_hash: string;
    }>(
      `SELECT schedule_id, version_id, computed_at, payload, payload_hash
         FROM wf.schedule_forecasts WHERE forecast_id = $1`,
      ['ac063-forecast-1'],
    );
    expect(persisted.rows).toHaveLength(1);
    const forecast = persisted.rows[0];
    expect(forecast?.schedule_id).toBe(scheduleId);
    expect(forecast?.version_id).toBe('ac063-v1');
    expect(Date.parse(forecast?.computed_at ?? '')).toBe(Date.parse(WF_FORECAST_FRESH_AT));
    expect(forecast?.payload).toEqual(WF_FORECASTS.FRESH);

    // The schedule is ACTIVE on the very version the forecast is bound to.
    const schedule = await tdb.engine.query<{ status: string; current_version_id: string }>(
      `SELECT status, current_version_id FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(schedule.rows[0]?.status).toBe('ACTIVE');
    expect(schedule.rows[0]?.current_version_id).toBe(forecast?.version_id);
  });
});
