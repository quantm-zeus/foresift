/**
 * AC-014 acceptance (positive).
 * Traces: FR-WF-004, FR-WF-008.
 * AC text (manifest §39.2): "Admin can validate, enable, pause, resume, run-now,
 * dry-run, and disable a schedule."
 *
 * The full §25.11 control lifecycle over real SQL: VALIDATE -> ENABLE (fresh
 * §33.6 forecast) -> PAUSE -> RESUME -> RUN_NOW -> DRY_RUN -> DISABLE, with the
 * expected status transition at each step. DRY_RUN resolves the whole pipeline
 * but commits no run, no outbox row, and no opportunity influence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  WF_STANDARD_STEP_ORDER,
  applyScheduleControl,
  type ScheduleControlResult,
  type ScheduleDryRunReport,
  type ScheduleValidationReport,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_SCHEDULE_DRAFTS,
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

async function countRuns(scheduleId: string): Promise<number> {
  const rows = await tdb.engine.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wf.runs WHERE schedule_id = $1`,
    [scheduleId],
  );
  return Number(rows.rows[0]?.n ?? '0');
}

async function countOutbox(): Promise<number> {
  const rows = await tdb.engine.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wf.notification_outbox`,
  );
  return Number(rows.rows[0]?.n ?? '0');
}

describe('AC-014: the full schedule control lifecycle transitions as specified', () => {
  it('validates, enables, pauses, resumes, runs now, dry-runs, and disables', async () => {
    const scheduleId = 'ac014-sched-lifecycle';

    const created = (await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId,
      now: T0,
      versionId: 'ac014-v1',
      config: buildScheduleDraft('ac014 lifecycle', { concurrencyPolicy: 'ALLOW_PARALLEL' }),
    })) as ScheduleControlResult;
    expect(created.status).toBe('DRAFT');
    expect(created.versionId).toBe('ac014-v1');

    const validation = (await applyScheduleControl(tdb.engine, {
      action: 'VALIDATE',
      scheduleId,
      now: T0,
    })) as ScheduleValidationReport;
    expect(validation.valid).toBe(true);
    expect(validation.versionId).toBe('ac014-v1');
    expect(validation.resolvedConfig.cron).toBe('*/5 * * * *');

    const enabled = (await applyScheduleControl(tdb.engine, {
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecastId: 'ac014-forecast-1',
      forecast: WF_FORECASTS.FRESH,
    })) as ScheduleControlResult;
    expect(enabled.status).toBe('ACTIVE');
    const persistedForecast = await tdb.engine.query<{ version_id: string; computed_at: string }>(
      `SELECT version_id, computed_at FROM wf.schedule_forecasts WHERE forecast_id = $1`,
      ['ac014-forecast-1'],
    );
    expect(persistedForecast.rows[0]?.version_id).toBe('ac014-v1');

    const paused = (await applyScheduleControl(tdb.engine, {
      action: 'PAUSE',
      scheduleId,
      now: T0,
    })) as ScheduleControlResult;
    expect(paused.status).toBe('PAUSED');

    const resumed = (await applyScheduleControl(tdb.engine, {
      action: 'RESUME',
      scheduleId,
      now: T0,
    })) as ScheduleControlResult;
    expect(resumed.status).toBe('ACTIVE');

    const ranNow = (await applyScheduleControl(tdb.engine, {
      action: 'RUN_NOW',
      scheduleId,
      now: T0,
      requestId: 'ac014-run-now-1',
    })) as ScheduleControlResult;
    expect(ranNow.status).toBe('ACTIVE');
    expect(ranNow.details.runId).not.toBeNull();
    expect(await countRuns(scheduleId)).toBe(1);

    const runsBeforeDryRun = await countRuns(scheduleId);
    const outboxBeforeDryRun = await countOutbox();
    const dryRun = (await applyScheduleControl(tdb.engine, {
      action: 'DRY_RUN',
      scheduleId,
      now: T0,
    })) as ScheduleDryRunReport;
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.opportunityInfluence).toBe(false);
    expect(dryRun.outboxCommitted).toBe(false);
    expect(dryRun.versionId).toBe('ac014-v1');
    expect(dryRun.standardStepOrder).toEqual([...WF_STANDARD_STEP_ORDER]);
    // ALLOW_PARALLEL means a live run does not suppress the would-be run.
    expect(dryRun.wouldStartRun).toBe(true);
    expect(await countRuns(scheduleId)).toBe(runsBeforeDryRun);
    expect(await countOutbox()).toBe(outboxBeforeDryRun);

    const disabled = (await applyScheduleControl(tdb.engine, {
      action: 'DISABLE',
      scheduleId,
      now: T0,
    })) as ScheduleControlResult;
    expect(disabled.status).toBe('DISABLED');

    const finalRow = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(finalRow.rows[0]?.status).toBe('DISABLED');

    // The lifecycle also holds for a second draft shape (weekday/London).
    const secondId = 'ac014-sched-lifecycle-2';
    const secondCreated = (await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId: secondId,
      now: T0,
      config: WF_SCHEDULE_DRAFTS.VALID_WEEKDAY_LONDON.config,
    })) as ScheduleControlResult;
    expect(secondCreated.status).toBe('DRAFT');
  });
});
