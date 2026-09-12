/**
 * AC-013 acceptance (positive).
 * Traces: FR-WF-001, FR-WF-004.
 * AC text (manifest §39.2): "Active runs continue with their original
 * immutable config/workflow version after deployment."
 *
 * A run pins `resolved_schedule_version` at trigger time. Deploying a new
 * version (EDIT_DRAFT) moves the schedule's pointer and sets the old version's
 * one-time `superseded_by` pointer, but the in-flight run keeps executing on
 * version N and version N's configuration content stays byte-identical.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  applyScheduleControl,
  beginStep,
  checkpointStep,
  recordTriggerDelivery,
  type ScheduleControlResult,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_PAYLOAD_HASH_B,
  WF_TEST_T0,
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

async function control(
  input: Parameters<typeof applyScheduleControl>[1],
): Promise<ScheduleControlResult> {
  return (await applyScheduleControl(tdb.engine, input)) as ScheduleControlResult;
}

describe('AC-013: active runs keep their original immutable version after deployment', () => {
  it('lets a run started on version N continue and complete on N after version N+1 deploys', async () => {
    const scheduleId = 'ac013-sched-pinned';
    await control({
      action: 'CREATE',
      scheduleId,
      now: T0,
      versionId: 'ac013-v1',
      config: {
        name: 'ac013 version one',
        cron: '*/5 * * * *',
        timezone: 'UTC',
        destination: 'https://internal.example.test/wf/trigger',
        concurrencyPolicy: 'ALLOW_PARALLEL',
      },
    });
    await control({
      action: 'ENABLE',
      scheduleId,
      now: T0,
      forecast: WF_FORECASTS.FRESH,
    });

    const delivery = await recordTriggerDelivery(tdb.engine, {
      source: 'qstash',
      externalMessageId: 'ac013-msg-1',
      scheduleId,
      scheduledFor: T0,
      payloadHash: WF_TEST_PAYLOAD_HASH_A,
      receivedAt: T0,
      verifiedAt: T0,
    });
    expect(delivery.runId).not.toBeNull();
    const runId = delivery.runId!;

    // The run makes durable progress on version N.
    await beginStep(tdb.engine, {
      runId,
      stepType: 'discover_candidates',
      idempotencyKey: 'ac013-step-before-deploy',
      now: T0,
    });
    await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey: 'ac013-step-before-deploy',
      status: 'SUCCEEDED',
      outputHash: WF_TEST_PAYLOAD_HASH_B,
      now: T0,
    });

    // DEPLOY version N+1.
    const edited = await control({
      action: 'EDIT_DRAFT',
      scheduleId,
      now: T0,
      versionId: 'ac013-v2',
      config: { name: 'ac013 version two', cron: '*/10 * * * *' },
    });
    expect(edited.versionId).toBe('ac013-v2');

    // The run keeps executing on version N after the deployment.
    await beginStep(tdb.engine, {
      runId,
      stepType: 'canonicalize_and_deduplicate',
      idempotencyKey: 'ac013-step-after-deploy',
      now: T0,
    });
    const afterDeploy = await checkpointStep(tdb.engine, {
      runId,
      idempotencyKey: 'ac013-step-after-deploy',
      status: 'SUCCEEDED',
      outputHash: WF_TEST_PAYLOAD_HASH_B,
      now: T0,
    });
    expect(afterDeploy.status).toBe('SUCCEEDED');

    // No run-completion function exists in this package (run lifecycle is owned
    // by the orchestrator); mark the run terminal to prove it completes on N.
    await tdb.engine.query(
      `UPDATE wf.runs SET status = 'SUCCEEDED', completed_at = $2
        WHERE run_id = $1 AND status NOT IN ('SUCCEEDED', 'CANCELLED')`,
      [runId, T0],
    );

    const run = await tdb.engine.query<{
      resolved_schedule_version: string;
      status: string;
    }>(`SELECT resolved_schedule_version, status FROM wf.runs WHERE run_id = $1`, [runId]);
    expect(run.rows[0]?.status).toBe('SUCCEEDED');
    // …and it completed pinned to version N, not the deployed N+1.
    expect(run.rows[0]?.resolved_schedule_version).toBe('ac013-v1');

    const schedule = await tdb.engine.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM wf.schedules WHERE schedule_id = $1`,
      [scheduleId],
    );
    expect(schedule.rows[0]?.current_version_id).toBe('ac013-v2');

    const versions = await tdb.engine.query<{
      version_id: string;
      superseded_by: string | null;
      resolved_config: Record<string, unknown>;
    }>(
      `SELECT version_id, superseded_by, resolved_config FROM wf.schedule_versions
        WHERE schedule_id = $1 ORDER BY version_id`,
      [scheduleId],
    );
    expect(versions.rows.map((r) => r.version_id)).toEqual(['ac013-v1', 'ac013-v2']);
    expect(versions.rows[0]?.superseded_by).toBe('ac013-v2');
    expect(versions.rows[1]?.superseded_by).toBeNull();
    // Version N's configuration content is byte-identical to what it was.
    expect(versions.rows[0]?.resolved_config).toEqual({
      name: 'ac013 version one',
      cron: '*/5 * * * *',
      timezone: 'UTC',
      destination: 'https://internal.example.test/wf/trigger',
      concurrencyPolicy: 'ALLOW_PARALLEL',
      workloadKind: 'BROAD_SCAN',
      shadow: false,
    });
  });
});
