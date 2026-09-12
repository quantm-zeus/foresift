/**
 * Internal schedule surface endpoint tests (T029, FR-WF-002/004/005, AC-010,
 * AC-014, AC-063).
 *
 * PGlite is the deterministic test engine (ADR-0014). Every test proves a
 * trust-boundary property against durable state:
 * - a valid signed delivery returns 202 and creates exactly one run;
 * - forged, expired, and replayed deliveries are refused BEFORE any write
 *   (zero inbox and zero run rows);
 * - a duplicate delivery in a fresh surface still collapses to one run;
 * - control actions refuse forecast-less enable and run-now on a disabled
 *   schedule;
 * - read handlers return persisted state and mutate nothing.
 *
 * Traces: FR-WF-002, FR-WF-004, FR-WF-005, AC-010, AC-014, AC-063.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  LocalSchedulerAdapter,
  applyScheduleControl,
  computeDeliveryMac,
  type SchedulerPort,
} from '@foresift/workflow-runtime';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../../tests/acceptance/helpers.ts';
import {
  SCHEDULER_DELIVERED_AT_HEADER,
  SCHEDULER_MESSAGE_ID_HEADER,
  SCHEDULER_SIGNATURE_HEADER,
  createInternalScheduleSurface,
  schedulerDeliveryPayload,
  type InternalRequest,
  type InternalResponse,
  type InternalScheduleSurface,
} from './internal-surface.ts';

const SECRET = 'unit-test-scheduler-secret-not-a-real-credential';
const FIXED_NOW = '2026-09-12T12:00:00.000Z';
const EXPIRED_AT = '2026-09-12T11:40:00.000Z';
const TRIGGER_PATH = '/api/v1/internal/schedules/trigger';
const RECONCILE_PATH = '/api/v1/internal/schedules/reconcile';

const COUNTER_TABLES = [
  'wf.trigger_inbox',
  'wf.runs',
  'wf.steps',
  'wf.notification_outbox',
  'wf.dead_letters',
] as const;

interface TriggerBody {
  readonly ok: boolean;
  readonly statusCode: number;
  readonly inboxId: string;
  readonly runId: string | null;
  readonly outcome: string;
  readonly duplicate: boolean;
  readonly concurrencyPolicy: string;
}

interface ErrorBody {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

function authedHeaders(): Record<string, string> {
  return { authorization: `Bearer ${SECRET}` };
}

function get(path: string): InternalRequest {
  return { method: 'GET', path, headers: authedHeaders() };
}

function post(path: string, body: unknown): InternalRequest {
  return { method: 'POST', path, headers: authedHeaders(), body };
}

function errorCode(response: InternalResponse): string {
  return (response.body as ErrorBody).error.code;
}

function freshForecast(): Record<string, unknown> {
  return {
    computedAt: FIXED_NOW,
    runsPerDay: 4,
    providerCallsPerDay: 40,
    modelTokensPerDay: 4000,
    estimatedModelSpendPerDay: '1.25',
    quotaExhaustionDate: null,
    storageGrowthPerMonth: 1024,
  };
}

function triggerBody(scheduleId: string, deliveredAt: string): Record<string, unknown> {
  return { scheduleId, scheduledFor: deliveredAt };
}

function signedTrigger(options: {
  readonly scheduleId: string;
  readonly messageId: string;
  readonly deliveredAt?: string;
  readonly macSecret?: string;
  readonly bearer?: string;
}): InternalRequest {
  const deliveredAt = options.deliveredAt ?? FIXED_NOW;
  const body = triggerBody(options.scheduleId, deliveredAt);
  const payload = schedulerDeliveryPayload(body);
  const mac = computeDeliveryMac({
    payload,
    secret: options.macSecret ?? SECRET,
    deliveredAt,
    messageId: options.messageId,
  });
  return {
    method: 'POST',
    path: TRIGGER_PATH,
    headers: {
      authorization: `Bearer ${options.bearer ?? SECRET}`,
      [SCHEDULER_MESSAGE_ID_HEADER]: options.messageId,
      [SCHEDULER_DELIVERED_AT_HEADER]: deliveredAt,
      [SCHEDULER_SIGNATURE_HEADER]: `sha256=${mac}`,
    },
    body,
  };
}

async function seedActiveSchedule(engine: DatabaseEngine, scheduleId: string): Promise<void> {
  await applyScheduleControl(engine, {
    action: 'CREATE',
    scheduleId,
    now: FIXED_NOW,
    config: {
      name: `scan-${scheduleId}`,
      cron: '*/15 * * * *',
      timezone: 'UTC',
      destination: 'telegram:ops',
    },
  });
  await applyScheduleControl(engine, {
    action: 'ENABLE',
    scheduleId,
    now: FIXED_NOW,
    forecast: freshForecast(),
  });
}

async function countRows(engine: DatabaseEngine, table: string): Promise<number> {
  const result = await engine.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countAll(engine: DatabaseEngine): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of COUNTER_TABLES) {
    counts[table] = await countRows(engine, table);
  }
  return counts;
}

describe('internal schedule surface routes (T027-T029)', () => {
  let tdb: TestDatabase;
  let engine: DatabaseEngine;
  let surface: InternalScheduleSurface;

  function buildSurface(schedulerPort?: SchedulerPort): InternalScheduleSurface {
    return createInternalScheduleSurface({
      engine,
      schedulerSecret: SECRET,
      now: () => FIXED_NOW,
      ...(schedulerPort === undefined ? {} : { schedulerPort }),
    });
  }

  beforeEach(async () => {
    tdb = await makeTestDatabase();
    engine = tdb.engine;
    surface = buildSurface();
  });

  afterEach(async () => {
    await closeTestDatabase(tdb);
  });

  it('accepts a signed delivery with 202 and creates exactly one run', async () => {
    const scheduleId = 'wfs_http_valid';
    await seedActiveSchedule(engine, scheduleId);

    const response = await surface.handle(signedTrigger({ scheduleId, messageId: 'msg-valid-1' }));

    expect(response.status).toBe(202);
    const body = response.body as TriggerBody;
    expect(body.ok).toBe(true);
    expect(body.statusCode).toBe(202);
    expect(body.outcome).toBe('RUN_STARTED');
    expect(body.duplicate).toBe(false);
    expect(body.runId).not.toBeNull();
    expect(await countRows(engine, 'wf.trigger_inbox')).toBe(1);
    expect(await countRows(engine, 'wf.runs')).toBe(1);
  });

  it('refuses a forged signature with 401 and writes nothing', async () => {
    const scheduleId = 'wfs_http_forged';
    await seedActiveSchedule(engine, scheduleId);

    const response = await surface.handle(
      signedTrigger({ scheduleId, messageId: 'msg-forged-1', macSecret: 'a-different-secret' }),
    );

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('WF_SCHEDULER_SIGNATURE_INVALID');
    expect(await countRows(engine, 'wf.trigger_inbox')).toBe(0);
    expect(await countRows(engine, 'wf.runs')).toBe(0);
  });

  it('refuses an expired timestamp with 400 and writes nothing', async () => {
    const scheduleId = 'wfs_http_expired';
    await seedActiveSchedule(engine, scheduleId);

    const response = await surface.handle(
      signedTrigger({ scheduleId, messageId: 'msg-expired-1', deliveredAt: EXPIRED_AT }),
    );

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('WF_SCHEDULER_TIMESTAMP_OUT_OF_WINDOW');
    expect(await countRows(engine, 'wf.trigger_inbox')).toBe(0);
    expect(await countRows(engine, 'wf.runs')).toBe(0);
  });

  it('refuses a replayed envelope and never creates a second run', async () => {
    const scheduleId = 'wfs_http_replay';
    await seedActiveSchedule(engine, scheduleId);
    const request = signedTrigger({ scheduleId, messageId: 'msg-replay-1' });

    const first = await surface.handle(request);
    expect(first.status).toBe(202);

    const replayed = await surface.handle(request);
    expect(replayed.status).toBe(400);
    expect(errorCode(replayed)).toBe('WF_SCHEDULER_DELIVERY_REPLAYED');
    expect(await countRows(engine, 'wf.trigger_inbox')).toBe(1);
    expect(await countRows(engine, 'wf.runs')).toBe(1);
  });

  it('collapses a duplicate delivery in a fresh surface to a single run', async () => {
    const scheduleId = 'wfs_http_duplicate';
    await seedActiveSchedule(engine, scheduleId);
    const request = signedTrigger({ scheduleId, messageId: 'msg-duplicate-1' });

    const first = (await surface.handle(request)).body as TriggerBody;
    // A new surface has no in-process memory of the envelope: exactly the
    // post-restart redelivery that the durable inbox must collapse.
    const restarted = buildSurface();
    const second = await restarted.handle(request);

    expect(second.status).toBe(202);
    const body = second.body as TriggerBody;
    expect(body.duplicate).toBe(true);
    expect(body.outcome).toBe('DUPLICATE_COLLAPSED');
    expect(body.runId).toBe(first.runId);
    expect(await countRows(engine, 'wf.runs')).toBe(1);
  });

  it('requires an authenticated service credential', async () => {
    const scheduleId = 'wfs_http_auth';
    await seedActiveSchedule(engine, scheduleId);
    const valid = signedTrigger({ scheduleId, messageId: 'msg-auth-1' });
    const headers = { ...valid.headers } as Record<string, string>;
    delete headers.authorization;

    const missing = await surface.handle({ ...valid, headers });
    expect(missing.status).toBe(401);
    expect(errorCode(missing)).toBe('AUTHENTICATION_REFUSED');

    const malformed = await surface.handle({
      ...valid,
      headers: { ...valid.headers, authorization: 'Token not-a-bearer' },
    });
    expect(malformed.status).toBe(401);
    expect(errorCode(malformed)).toBe('AUTHENTICATION_REFUSED');

    const wrongSecret = await surface.handle(
      signedTrigger({ scheduleId, messageId: 'msg-auth-2', bearer: 'not-the-configured-secret' }),
    );
    expect(wrongSecret.status).toBe(401);
    expect(errorCode(wrongSecret)).toBe('AUTHORIZATION_REFUSED');

    expect(await countRows(engine, 'wf.trigger_inbox')).toBe(0);
    expect(await countRows(engine, 'wf.runs')).toBe(0);
  });

  it('returns 404 for unknown routes and 405 for unsupported methods', async () => {
    const unknown = await surface.handle(get('/api/v1/internal/not-a-route'));
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown)).toBe('INTERNAL_ROUTE_NOT_FOUND');

    const wrongMethod = await surface.handle({
      method: 'PUT',
      path: '/api/v1/internal/runs',
      headers: authedHeaders(),
    });
    expect(wrongMethod.status).toBe(405);
    expect(errorCode(wrongMethod)).toBe('INTERNAL_METHOD_NOT_ALLOWED');
    expect(wrongMethod.headers?.allow).toBe('GET');
  });

  it('dispatches control actions and refuses forecast-less enable and disabled run-now', async () => {
    const scheduleId = 'wfs_http_controls';
    const actionsPath = `/api/v1/internal/schedules/${scheduleId}/actions`;

    const created = await surface.handle(
      post(actionsPath, {
        action: 'CREATE',
        now: FIXED_NOW,
        config: {
          name: 'controls-scan',
          cron: '*/30 * * * *',
          timezone: 'UTC',
          destination: 'telegram:ops',
        },
      }),
    );
    expect(created.status).toBe(200);

    const forecastless = await surface.handle(
      post(actionsPath, { action: 'ENABLE', now: FIXED_NOW }),
    );
    expect(forecastless.status).toBe(400);
    expect(errorCode(forecastless)).toBe('WF_FORECAST_MISSING');

    const enabled = await surface.handle(
      post(actionsPath, { action: 'ENABLE', now: FIXED_NOW, forecast: freshForecast() }),
    );
    expect(enabled.status).toBe(200);
    expect((enabled.body as { result: { status: string } }).result.status).toBe('ACTIVE');

    const disabled = await surface.handle(post(actionsPath, { action: 'DISABLE', now: FIXED_NOW }));
    expect(disabled.status).toBe(200);

    const runNow = await surface.handle(post(actionsPath, { action: 'RUN_NOW', now: FIXED_NOW }));
    expect(runNow.status).toBe(409);
    expect(errorCode(runNow)).toBe('WF_SCHEDULE_DISABLED');
    expect(await countRows(engine, 'wf.runs')).toBe(0);
  });

  it('runs reconciliation and returns the persisted diff report', async () => {
    const scheduleId = 'wfs_http_reconcile';
    await seedActiveSchedule(engine, scheduleId);

    // An empty external scheduler makes the ACTIVE database schedule drift.
    const response = await surface.handle(post(RECONCILE_PATH, { now: FIXED_NOW, repair: false }));

    expect(response.status).toBe(200);
    const report = (
      response.body as {
        report: { skews: readonly { dimension: string }[]; repairRequested: boolean };
      }
    ).report;
    expect(report.repairRequested).toBe(false);
    expect(report.skews.length).toBeGreaterThan(0);
    expect(await countRows(engine, 'wf.reconciliation_reports')).toBe(1);
  });

  it('reads persisted run state without mutating any workflow table', async () => {
    const scheduleId = 'wfs_http_reads';
    await seedActiveSchedule(engine, scheduleId);
    const delivered = (
      await surface.handle(signedTrigger({ scheduleId, messageId: 'msg-reads-1' }))
    ).body as TriggerBody;
    const runId = delivered.runId ?? '';
    expect(runId.length).toBeGreaterThan(0);

    const before = await countAll(engine);

    const runs = await surface.handle(get('/api/v1/internal/runs'));
    expect(runs.status).toBe(200);
    const runList = (runs.body as { runs: readonly { runId: string }[] }).runs;
    expect(runList).toHaveLength(1);
    expect(runList[0]?.runId).toBe(runId);

    const run = await surface.handle(get(`/api/v1/internal/runs/${runId}`));
    expect(run.status).toBe(200);
    expect((run.body as { run: { runId: string } }).run.runId).toBe(runId);

    const missingRun = await surface.handle(get('/api/v1/internal/runs/wf_run_missing'));
    expect(missingRun.status).toBe(404);
    expect(errorCode(missingRun)).toBe('WF_RUN_NOT_FOUND');

    const steps = await surface.handle(get('/api/v1/internal/steps'));
    expect(steps.status).toBe(200);
    expect((steps.body as { steps: readonly unknown[] }).steps).toHaveLength(0);

    const deadLetters = await surface.handle(get('/api/v1/internal/dead-letters'));
    expect(deadLetters.status).toBe(200);
    expect((deadLetters.body as { deadLetters: readonly unknown[] }).deadLetters).toHaveLength(0);

    const outbox = await surface.handle(get('/api/v1/internal/outbox'));
    expect(outbox.status).toBe(200);
    expect((outbox.body as { outbox: readonly unknown[] }).outbox).toHaveLength(0);

    const after = await countAll(engine);
    expect(after).toEqual(before);
  });

  it('exposes verify-state diagnostics read-only from the outbox handler', async () => {
    const before = await countAll(engine);
    const response = await surface.handle(get('/api/v1/internal/outbox?checks=1'));
    expect(response.status).toBe(200);
    const checks = (response.body as { checks: readonly { check: string; ok: boolean }[] }).checks;
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((finding) => finding.ok)).toBe(true);
    expect(await countAll(engine)).toEqual(before);
  });

  it('uses an injected scheduler port for reconciliation', async () => {
    const scheduleId = 'wfs_http_injected_port';
    await seedActiveSchedule(engine, scheduleId);
    const port = new LocalSchedulerAdapter();
    await port.create({
      scheduleId,
      cron: '*/15 * * * *',
      timezone: 'UTC',
      paused: false,
      destination: 'telegram:ops',
    });
    const injected = buildSurface(port);

    const response = await injected.handle(post(RECONCILE_PATH, { now: FIXED_NOW }));
    expect(response.status).toBe(200);
    expect((response.body as { report: { skews: readonly unknown[] } }).report.skews).toHaveLength(
      0,
    );
  });
});
