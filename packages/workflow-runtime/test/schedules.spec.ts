/**
 * Versioned schedule CRUD + §25.11 control-action suite (T019, FR-WF-004,
 * AC-013/AC-014/AC-063; PRD §25.11, §33.6). Runs on a real SQL engine (PGlite).
 *
 * Proves:
 * - an active run completes on its original immutable version after a new
 *   version is deployed (AC-013) and an in-place version rewrite is refused;
 * - the full validate -> enable -> pause -> resume -> run-now -> dry-run ->
 *   disable lifecycle (AC-014);
 * - ENABLE refuses an absent or stale §33.6 forecast (AC-063) and persists the
 *   accepted forecast;
 * - invalid cron/timezone refuse, RUN_NOW on a DISABLED schedule refuses, and
 *   DRY_RUN commits no run and no outbox row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  applyScheduleControl,
  recordTriggerDelivery,
  type ScheduleControlInput,
  type ScheduleControlResult,
} from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  HASH_A,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';

/**
 * The §25.11 dispatcher returns a union of control/validation/dry-run arms.
 * Control actions (the ones this helper is used for) carry a `status`;
 * VALIDATE/DRY_RUN are called through `applyScheduleControl` directly.
 */
async function control(input: ScheduleControlInput): Promise<ScheduleControlResult> {
  return (await applyScheduleControl(tdb.engine, input)) as ScheduleControlResult;
}

const T0 = '2026-06-01T12:00:00.000Z';
const STALE = '2026-05-01T00:00:00.000Z';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

function forecast(computedAt: string) {
  return {
    computedAt,
    runsPerDay: 24,
    providerCallsPerDay: 100,
    modelTokensPerDay: 1000,
    estimatedModelSpendPerDay: '0.50',
    quotaExhaustionDate: null,
    storageGrowthPerMonth: 1024,
  };
}

function draft(scheduleId: string, cron = '*/5 * * * *') {
  return {
    action: 'CREATE' as const,
    scheduleId,
    now: T0,
    config: {
      name: `schedule ${scheduleId}`,
      cron,
      timezone: 'UTC',
      destination: 'https://example.test/trigger',
      concurrencyPolicy: 'ALLOW_PARALLEL' as const,
    },
  };
}

async function countOutbox(): Promise<number> {
  const rows = await tdb.engine.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM wf.notification_outbox`,
  );
  return Number(rows.rows[0]?.n ?? '0');
}

describe('§25.11 immutable versions (AC-013)', () => {
  it('pins an active run to version N after version N+1 is deployed', async () => {
    const scheduleId = 'sched-pin';
    await control({ ...draft(scheduleId), versionId: 'pin-v1' });
    await control({
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecast: forecast(T0),
    });

    const run = await recordTriggerDelivery(tdb.engine, {
      source: 'qstash',
      externalMessageId: 'pin-msg-1',
      scheduleId,
      scheduledFor: T0,
      payloadHash: HASH_A,
      receivedAt: T0,
    });

    // Deploy version N+1.
    await control({
      action: 'EDIT_DRAFT',
      scheduleId,
      now: T0,
      versionId: 'pin-v2',
      config: { cron: '*/10 * * * *', name: 'schedule sched-pin v2' },
    });

    const schedule = await tdb.engine.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(schedule.rows[0]?.current_version_id).toBe('pin-v2');

    const pinned = await tdb.engine.query<{
      resolved_schedule_version: string;
      status: string;
    }>(`SELECT resolved_schedule_version, status FROM wf.runs WHERE run_id = $1`, [run.runId]);
    expect(pinned.rows[0]?.resolved_schedule_version).toBe('pin-v1');

    const versions = await tdb.engine.query<{
      version_id: string;
      superseded_by: string | null;
      resolved_config: { cron: string };
    }>(
      `SELECT version_id, superseded_by, resolved_config FROM wf.schedule_versions
        WHERE schedule_id = $1 ORDER BY version_id`,
      [scheduleId],
    );
    expect(versions.rows.map((r) => r.version_id)).toEqual(['pin-v1', 'pin-v2']);
    expect(versions.rows[0]?.superseded_by).toBe('pin-v2');
    expect(versions.rows[1]?.superseded_by).toBeNull();
    // The original version's configuration is byte-for-byte unchanged.
    expect(versions.rows[0]?.resolved_config.cron).toBe('*/5 * * * *');
  });

  it('refuses an in-place version configuration rewrite', async () => {
    const error = await (async () => {
      try {
        await tdb.engine.query(
          `UPDATE wf.schedule_versions SET resolved_config = '{"cron":"* * * * *"}'::jsonb
            WHERE version_id = 'pin-v1'`,
        );
      } catch (err) {
        return err as Error;
      }
      return null;
    })();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/immutable/);
  });

  it('refuses a second supersede of the same version', async () => {
    const error = await (async () => {
      try {
        await tdb.engine.query(
          `UPDATE wf.schedule_versions SET superseded_by = 'pin-v2' WHERE version_id = 'pin-v1'`,
        );
      } catch (err) {
        return err as Error;
      }
      return null;
    })();
    expect(error?.message).toMatch(/immutable/);
  });

  it('refreshes the denormalized schedule columns on a new version', async () => {
    const scheduleId = 'sched-rename';
    await applyScheduleControl(tdb.engine, { ...draft(scheduleId), versionId: 'rn-v1' });
    await applyScheduleControl(tdb.engine, {
      action: 'EDIT_DRAFT',
      scheduleId,
      now: T0,
      versionId: 'rn-v2',
      config: { name: 'renamed schedule', concurrencyPolicy: 'SKIP_IF_RUNNING' },
    });
    const row = await tdb.engine.query<{ name: string; concurrency_policy: string }>(
      `SELECT name, concurrency_policy FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(row.rows[0]?.name).toBe('renamed schedule');
    expect(row.rows[0]?.concurrency_policy).toBe('SKIP_IF_RUNNING');
  });
});

describe('§25.11 control lifecycle (AC-014)', () => {
  it('runs validate -> enable -> pause -> resume -> run-now -> dry-run -> disable', async () => {
    const scheduleId = 'sched-life';
    await control({ ...draft(scheduleId), versionId: 'life-v1' });

    const validation = await control({
      action: 'VALIDATE',
      scheduleId,
      now: T0,
    });
    expect(validation).toMatchObject({ valid: true, versionId: 'life-v1' });

    const enabled = await control({
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecastId: 'life-forecast-1',
      forecast: forecast(T0),
    });
    expect(enabled.status).toBe('ACTIVE');

    const persisted = await tdb.engine.query<{ payload_hash: string; computed_at: string }>(
      `SELECT payload_hash, computed_at FROM wf.schedule_forecasts WHERE forecast_id = $1`,
      ['life-forecast-1'],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]?.payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Date.parse(persisted.rows[0]?.computed_at ?? '')).toBe(Date.parse(T0));

    const paused = await control({
      action: 'PAUSE',
      scheduleId,
      now: T0,
    });
    expect(paused.status).toBe('PAUSED');

    const resumed = await control({
      action: 'RESUME',
      scheduleId,
      now: T0,
    });
    expect(resumed.status).toBe('ACTIVE');

    const runNow = await control({
      action: 'RUN_NOW',
      scheduleId,
      now: T0,
      requestId: 'life-run-now-1',
    });
    expect(runNow.details.runId).not.toBeNull();

    const runsBefore = await tdb.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wf.runs WHERE schedule_id = $1`,
      [scheduleId],
    );
    const outboxBefore = await countOutbox();
    const dryRun = await control({
      action: 'DRY_RUN',
      scheduleId,
      now: T0,
    });
    expect(dryRun).toMatchObject({
      dryRun: true,
      opportunityInfluence: false,
      outboxCommitted: false,
      wouldStartRun: true,
    });
    const runsAfter = await tdb.engine.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM wf.runs WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(runsAfter.rows[0]?.n).toBe(runsBefore.rows[0]?.n);
    expect(await countOutbox()).toBe(outboxBefore);

    const disabled = await control({
      action: 'DISABLE',
      scheduleId,
      now: T0,
    });
    expect(disabled.status).toBe('DISABLED');

    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        action: 'RUN_NOW',
        scheduleId,
        now: T0,
        requestId: 'life-run-now-disabled',
      }),
      ErrorCode.WF_SCHEDULE_DISABLED,
    );
  });

  it('refuses RUN_NOW while PAUSED and EDIT_DRAFT while DISABLED', async () => {
    const scheduleId = 'sched-guards';
    await control({ ...draft(scheduleId), versionId: 'guard-v1' });
    await control({
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecast: forecast(T0),
    });
    await control({ action: 'PAUSE', scheduleId, now: T0 });

    await expectForesiftError(
      applyScheduleControl(tdb.engine, { action: 'RUN_NOW', scheduleId, now: T0 }),
      ErrorCode.WF_SCHEDULE_PAUSED,
    );

    await control({ action: 'DISABLE', scheduleId, now: T0 });
    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        action: 'EDIT_DRAFT',
        scheduleId,
        now: T0,
        config: { cron: '*/7 * * * *' },
      }),
      ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
    );
  });

  it('deletes fail-closed as a soft delete that disables the schedule', async () => {
    const scheduleId = 'sched-delete';
    await control({ ...draft(scheduleId), versionId: 'del-v1' });
    const deleted = await control({
      action: 'DELETE',
      scheduleId,
      now: T0,
    });
    expect(deleted.status).toBe('DISABLED');
    expect(deleted.details.softDeleted).toBe(true);
    const row = await tdb.engine.query<{ status: string; name: string }>(
      `SELECT status, name FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(row.rows[0]?.status).toBe('DISABLED');
    expect(row.rows[0]?.name).toMatch(/\(deleted\)$/);

    // A deleted tombstone is terminal: it cannot be resurrected by ENABLE.
    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        action: 'ENABLE',
        scheduleId,
        now: T0,
        forecast: forecast(T0),
      }),
      ErrorCode.WF_SCHEDULE_TRANSITION_INVALID,
    );
  });
});

describe('§33.6 forecast-before-enable gate (AC-063)', () => {
  it('refuses ENABLE without a forecast', async () => {
    const scheduleId = 'sched-no-forecast';
    await control({ ...draft(scheduleId), versionId: 'nf-v1' });
    await expectForesiftError(
      applyScheduleControl(tdb.engine, { action: 'ENABLE', scheduleId, now: T0 }),
      ErrorCode.WF_FORECAST_MISSING,
    );
    const row = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(row.rows[0]?.status).toBe('DRAFT');
  });

  it('refuses ENABLE with a stale forecast', async () => {
    const scheduleId = 'sched-stale-forecast';
    await control({ ...draft(scheduleId), versionId: 'sf-v1' });
    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        action: 'ENABLE',
        scheduleId,
        now: T0,
        forecast: forecast(STALE),
      }),
      ErrorCode.WF_FORECAST_STALE,
    );
    const row = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(row.rows[0]?.status).toBe('DRAFT');
  });

  it('refuses RESUME when the persisted forecast has gone stale', async () => {
    const scheduleId = 'sched-stale-resume';
    await control({ ...draft(scheduleId), versionId: 'sr-v1' });
    await control({
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecast: forecast(T0),
    });
    await control({ action: 'PAUSE', scheduleId, now: T0 });
    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        action: 'RESUME',
        scheduleId,
        now: '2026-06-05T12:00:00.000Z',
      }),
      ErrorCode.WF_FORECAST_STALE,
    );
  });

  it('refuses RESUME when the persisted forecast belongs to a superseded version', async () => {
    const scheduleId = 'sched-version-bound-resume';
    await control({ ...draft(scheduleId), versionId: 'vbr-v1' });
    await control({
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecastId: 'vbr-forecast-1',
      forecast: forecast(T0),
    });
    await control({ action: 'PAUSE', scheduleId, now: T0 });
    // A new version (different cron/cost profile) is drafted while PAUSED: the
    // v1 forecast is FRESH but must not enable the v2 configuration.
    const edited = await control({
      action: 'EDIT_DRAFT',
      scheduleId,
      now: T0,
      versionId: 'vbr-v2',
      config: { cron: '*/10 * * * *' },
    });
    expect(edited.versionId).toBe('vbr-v2');

    await expectForesiftError(
      applyScheduleControl(tdb.engine, { action: 'RESUME', scheduleId, now: T0 }),
      ErrorCode.WF_FORECAST_STALE,
    );

    const row = await tdb.engine.query<{ status: string; current_version_id: string }>(
      `SELECT status, current_version_id FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(row.rows[0]?.status).toBe('PAUSED');
    expect(row.rows[0]?.current_version_id).toBe('vbr-v2');
  });
});

describe('schedule configuration validation', () => {
  it('refuses a malformed cron expression', async () => {
    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        ...draft('sched-bad-cron', '60 * * * *'),
      }),
      ErrorCode.WF_SCHEDULE_CRON_INVALID,
    );
    await expectForesiftError(
      applyScheduleControl(tdb.engine, { ...draft('sched-bad-cron-2', '*/5 * * *') }),
      ErrorCode.WF_SCHEDULE_CRON_INVALID,
    );
    await expectForesiftError(
      applyScheduleControl(tdb.engine, { ...draft('sched-bad-cron-3', '@daily') }),
      ErrorCode.WF_SCHEDULE_CRON_INVALID,
    );
  });

  it('refuses an unknown IANA timezone', async () => {
    await expectForesiftError(
      applyScheduleControl(tdb.engine, {
        action: 'CREATE',
        scheduleId: 'sched-bad-tz',
        now: T0,
        config: {
          name: 'bad tz',
          cron: '*/5 * * * *',
          timezone: 'Not/AZone',
          destination: 'https://example.test/trigger',
        },
      }),
      ErrorCode.WF_SCHEDULE_TIMEZONE_INVALID,
    );
  });

  it('DUPLICATE copies the current configuration into a new DRAFT', async () => {
    const copy = await control({
      action: 'DUPLICATE',
      scheduleId: 'sched-pin',
      now: T0,
      newScheduleId: 'sched-pin-copy',
      versionId: 'pin-copy-v1',
    });
    expect(copy.status).toBe('DRAFT');
    expect(copy.scheduleId).toBe('sched-pin-copy');
    const row = await tdb.engine.query<{ resolved_config: { cron: string } }>(
      `SELECT resolved_config FROM wf.schedule_versions WHERE version_id = $1`,
      ['pin-copy-v1'],
    );
    // The copy takes the CURRENT (v2) configuration.
    expect(row.rows[0]?.resolved_config.cron).toBe('*/10 * * * *');
  });
});
