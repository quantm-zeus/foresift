/**
 * Internal schedule surface (T027/T028, FR-WF-002/004/005/006/007/008;
 * PRD §25.3/§25.10/§25.11).
 *
 * `apps/api` is an MCP server, not a REST router, so this module is a
 * self-contained, transport-agnostic internal surface: the host maps its own
 * HTTP layer onto `handle(request)` and renders the returned
 * `InternalResponse`. Nothing here imports MCP or a web framework.
 *
 * Route table (all routes are authenticated service surface, §9.3/§25.3):
 *
 * | Method | Path                                              | Backing engine call |
 * |--------|---------------------------------------------------|---------------------|
 * | POST   | `/api/v1/internal/schedules/trigger`              | `verifySchedulerDelivery` → `recordTriggerDelivery` (202) |
 * | POST   | `/api/v1/internal/schedules/:scheduleId/actions`  | `applyScheduleControl` |
 * | POST   | `/api/v1/internal/schedules/reconcile`            | `reconcileSchedules` |
 * | GET    | `/api/v1/internal/runs`                           | read-only `wf.runs` listing |
 * | GET    | `/api/v1/internal/runs/:runId`                    | read-only `wf.runs` lookup |
 * | GET    | `/api/v1/internal/steps`                          | read-only `wf.steps` listing |
 * | GET    | `/api/v1/internal/dead-letters`                   | `listDeadLetters` (read-only) |
 * | GET    | `/api/v1/internal/outbox`                         | read-only `wf.notification_outbox` listing (+ `runAllWfStateChecks` when `?checks=1`) |
 *
 * Trust boundary (§9.3, §25.3 steps 1-2): a scheduler delivery is verified —
 * HMAC signature, timestamp/replay window, message-id replay — BEFORE any
 * state write. A forged, expired, or replayed delivery returns 401/400 with a
 * typed `code` and writes nothing. Cross-process redelivery of an envelope the
 * surface has not seen in-process still returns 202 and is collapsed durably
 * by `recordTriggerDelivery` (`duplicate: true`), so the surface never turns a
 * scheduler retry into a second run.
 *
 * Read handlers issue `SELECT`-only statements (or `verify-state` queries,
 * which are documented read-only). They never mutate workflow state.
 *
 * Strictly read-only software: this surface schedules reads and
 * notifications. It can never trade, custody, sign, hold keys, or submit a
 * transaction.
 */
import { timingSafeEqual } from 'node:crypto';
import {
  ErrorCode,
  ForesiftError,
  parseScheduleControlAction,
  type DeadLetterStatus,
  type WorkflowWorkloadKind,
} from '@foresift/domain';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  LocalSchedulerAdapter,
  applyScheduleControl,
  listDeadLetters,
  reconcileSchedules,
  recordTriggerDelivery,
  runAllWfStateChecks,
  verifySchedulerDelivery,
  type ScheduleConfigPatch,
  type ScheduleControlInput,
  type SchedulerPort,
} from '@foresift/workflow-runtime';

/** Scheduler delivery headers the host must forward verbatim. */
export const SCHEDULER_MESSAGE_ID_HEADER = 'x-foresift-scheduler-message-id';
export const SCHEDULER_DELIVERED_AT_HEADER = 'x-foresift-scheduler-delivered-at';
export const SCHEDULER_SIGNATURE_HEADER = 'x-foresift-scheduler-signature';

/** Route literals, exported so the host router and tests cannot drift. */
export const INTERNAL_SURFACE_ROUTES = Object.freeze({
  trigger: '/api/v1/internal/schedules/trigger',
  reconcile: '/api/v1/internal/schedules/reconcile',
  actions: '/api/v1/internal/schedules/:scheduleId/actions',
  runs: '/api/v1/internal/runs',
  run: '/api/v1/internal/runs/:runId',
  steps: '/api/v1/internal/steps',
  deadLetters: '/api/v1/internal/dead-letters',
  outbox: '/api/v1/internal/outbox',
});

/** Surface-local typed codes for transport refusals (never product state). */
export const InternalSurfaceCode = {
  ROUTE_NOT_FOUND: 'INTERNAL_ROUTE_NOT_FOUND',
  METHOD_NOT_ALLOWED: 'INTERNAL_METHOD_NOT_ALLOWED',
  REQUEST_INVALID: 'INTERNAL_REQUEST_INVALID',
  SURFACE_FAILURE: 'INTERNAL_SURFACE_FAILURE',
} as const;
export type InternalSurfaceCode = (typeof InternalSurfaceCode)[keyof typeof InternalSurfaceCode];

export interface InternalRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  /** Parsed JSON envelope (the scheduler delivery payload for the trigger route). */
  readonly body?: unknown;
}

export interface InternalResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface InternalScheduleSurface {
  handle(request: InternalRequest): Promise<InternalResponse>;
}

export interface CreateInternalScheduleSurfaceOptions {
  readonly engine: DatabaseEngine;
  /** Shared scheduler secret: bearer credential AND delivery-MAC key. */
  readonly schedulerSecret: string;
  /** Injected clock; a fixed value makes replay windows deterministic in tests. */
  readonly now?: string | (() => string);
  /** §9.3 delivery replay window (default 5 minutes). */
  readonly replayWindowMs?: number;
  /** Inject the scheduler seam; defaults to the deterministic local adapter. */
  readonly schedulerPort?: SchedulerPort;
  /** Seed the in-process replay guard (for example from durable inbox state). */
  readonly seenMessageIds?: ReadonlySet<string> | readonly string[];
}

/** Documented §9.3 default replay window. */
export const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** Read-listing cap; a larger request is refused rather than silently truncated. */
export const INTERNAL_READ_LIMIT_MAX = 500;
const INTERNAL_READ_LIMIT_DEFAULT = 100;

const ACTION_PATH_PATTERN = /^\/api\/v1\/internal\/schedules\/([^/]+)\/actions$/;
const RUN_PATH_PATTERN = /^\/api\/v1\/internal\/runs\/([^/]+)$/;
const BEARER_PATTERN = /^Bearer\s+(\S+)$/;

/** A transport-level refusal carrying its own HTTP status and typed code. */
export class InternalSurfaceError extends Error {
  constructor(
    readonly code: InternalSurfaceCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'InternalSurfaceError';
  }
}

// --- transport helpers -----------------------------------------------------

function parsePath(path: string): { pathname: string; query: URLSearchParams } | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const separator = path.indexOf('?');
  const raw = separator === -1 ? path : path.slice(0, separator);
  const query = new URLSearchParams(separator === -1 ? '' : path.slice(separator + 1));
  const pathname = raw.length > 1 && raw.endsWith('/') ? raw.replace(/\/+$/, '') : raw;
  return { pathname, query };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Percent-decode one path segment, failing closed on malformed encoding. */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InternalSurfaceError(
      InternalSurfaceCode.REQUEST_INVALID,
      400,
      'path parameter is not valid percent-encoding',
    );
  }
}

/** Lowercased header lookup so transports that normalize case cannot bypass auth. */
function headerMap(
  headers: Readonly<Record<string, string | undefined>> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') map.set(name.toLowerCase(), value);
  }
  return map;
}

function constantTimeEquals(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): InternalResponse {
  return {
    status,
    body,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  };
}

/** Strip the `CODE: ` prefix ForesiftError adds so the body carries one code. */
function errorMessage(code: string, message: string): string {
  const prefix = `${code}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

/**
 * HTTP status for an engine refusal. Unknown engine codes fail closed to 400
 * (client-visible refusal) rather than 500 — the engine refused, by contract.
 */
const ENGINE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  [ErrorCode.AUTHENTICATION_REFUSED]: 401,
  [ErrorCode.AUTHORIZATION_REFUSED]: 401,
  [ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID]: 401,
  [ErrorCode.WF_SCHEDULER_TIMESTAMP_INVALID]: 400,
  [ErrorCode.WF_SCHEDULER_TIMESTAMP_OUT_OF_WINDOW]: 400,
  [ErrorCode.WF_SCHEDULER_DELIVERY_REPLAYED]: 400,
  [ErrorCode.WF_TRIGGER_IDENTITY_INVALID]: 400,
  [ErrorCode.WF_TRIGGER_PAYLOAD_HASH_INVALID]: 400,
  [ErrorCode.WF_FORECAST_MISSING]: 400,
  [ErrorCode.WF_FORECAST_STALE]: 400,
  [ErrorCode.WF_SCHEDULE_CRON_INVALID]: 400,
  [ErrorCode.WF_SCHEDULE_TIMEZONE_INVALID]: 400,
  [ErrorCode.WF_SCHEDULE_CONFIG_INVALID]: 400,
  [ErrorCode.WF_SCHEDULE_ACTION_UNKNOWN]: 400,
  [ErrorCode.WF_STATE_CHECK_UNKNOWN]: 400,
  [ErrorCode.WF_SCHEDULE_NOT_FOUND]: 404,
  [ErrorCode.WF_RUN_NOT_FOUND]: 404,
  [ErrorCode.WF_DEAD_LETTER_NOT_FOUND]: 404,
  [ErrorCode.WF_OUTBOX_NOT_FOUND]: 404,
  [ErrorCode.WF_SCHEDULE_TRANSITION_INVALID]: 409,
  [ErrorCode.WF_SCHEDULE_DISABLED]: 409,
  [ErrorCode.WF_SCHEDULE_PAUSED]: 409,
  [ErrorCode.WF_SCHEDULE_NOT_ACTIVE]: 409,
  [ErrorCode.WF_SCHEDULE_VERSION_IMMUTABLE]: 409,
  [ErrorCode.WF_TRIGGER_DELIVERY_REJECTED]: 409,
});

function toErrorResponse(error: unknown): InternalResponse {
  if (error instanceof InternalSurfaceError) {
    return jsonResponse(error.status, {
      ok: false,
      error: { code: error.code, message: error.message },
    });
  }
  if (error instanceof ForesiftError) {
    const status = ENGINE_STATUS[error.code] ?? 400;
    return jsonResponse(status, {
      ok: false,
      error: { code: error.code, message: errorMessage(error.code, error.message) },
    });
  }
  // Fail closed without leaking internal error text or a stack trace.
  return jsonResponse(500, {
    ok: false,
    error: { code: InternalSurfaceCode.SURFACE_FAILURE, message: 'internal surface failure' },
  });
}

function requireRecord(body: unknown, route: string): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new InternalSurfaceError(
      InternalSurfaceCode.REQUEST_INVALID,
      400,
      `${route} requires a JSON object body`,
    );
  }
  return body;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InternalSurfaceError(
      InternalSurfaceCode.REQUEST_INVALID,
      400,
      `${field} is required`,
    );
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw.trim().length === 0) return INTERNAL_READ_LIMIT_DEFAULT;
  if (!/^\d+$/.test(raw.trim())) {
    throw new InternalSurfaceError(
      InternalSurfaceCode.REQUEST_INVALID,
      400,
      'limit must be a positive integer',
    );
  }
  const limit = Number(raw.trim());
  if (limit < 1 || limit > INTERNAL_READ_LIMIT_MAX) {
    throw new InternalSurfaceError(
      InternalSurfaceCode.REQUEST_INVALID,
      400,
      `limit must be between 1 and ${INTERNAL_READ_LIMIT_MAX}`,
    );
  }
  return limit;
}

function nullableParam(value: string | null): string | null {
  return value === null || value.trim().length === 0 ? null : value;
}

function isWorkloadKind(value: unknown): value is WorkflowWorkloadKind {
  return value === 'BROAD_SCAN' || value === 'CANDIDATE_RECHECK';
}

// --- read-row mapping ------------------------------------------------------

interface RunRow {
  readonly run_id: string;
  readonly schedule_id: string;
  readonly resolved_schedule_version: string;
  readonly inbox_id: string;
  readonly trigger_source: string;
  readonly trigger_external_message_id: string;
  readonly trigger_canonical_external_message_id: string;
  readonly concurrency_policy: string;
  readonly concurrency_outcome: string;
  readonly shadow: boolean;
  readonly status: string;
  readonly deadline: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
}

interface StepRow {
  readonly step_id: string;
  readonly run_id: string;
  readonly step_type: string;
  readonly idempotency_key: string;
  readonly attempt: number;
  readonly input_hash: string | null;
  readonly output_hash: string | null;
  readonly status: string;
  readonly lease_owner: string | null;
  readonly lease_version: number;
  readonly lease_expires_at: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly error_class: string | null;
  readonly retryable: boolean | null;
}

interface OutboxRow {
  readonly outbox_id: string;
  readonly decision_ref: string;
  readonly alert_ref: string | null;
  readonly channel: string;
  readonly payload_hash: string;
  readonly status: string;
  readonly claim_owner: string | null;
  readonly claim_fencing_token: number | string | null;
  readonly claim_expires_at: string | null;
  readonly attempts: number;
  readonly enqueued_at: string;
  readonly claimed_at: string | null;
  readonly sent_at: string | null;
  readonly last_error: string | null;
}

const RUN_COLUMNS = `run_id, schedule_id, resolved_schedule_version, inbox_id,
  trigger_source, trigger_external_message_id, trigger_canonical_external_message_id,
  concurrency_policy, concurrency_outcome, shadow, status, deadline, started_at, completed_at`;

const STEP_COLUMNS = `step_id, run_id, step_type, idempotency_key, attempt,
  input_hash, output_hash, status, lease_owner, lease_version, lease_expires_at,
  started_at, completed_at, error_class, retryable`;

const OUTBOX_COLUMNS = `outbox_id, decision_ref, alert_ref, channel, payload_hash, status,
  claim_owner, claim_fencing_token, claim_expires_at, attempts, enqueued_at,
  claimed_at, sent_at, last_error`;

function mapRun(row: RunRow): Record<string, unknown> {
  return {
    runId: row.run_id,
    scheduleId: row.schedule_id,
    resolvedScheduleVersion: row.resolved_schedule_version,
    inboxId: row.inbox_id,
    triggerSource: row.trigger_source,
    triggerExternalMessageId: row.trigger_external_message_id,
    triggerCanonicalExternalMessageId: row.trigger_canonical_external_message_id,
    concurrencyPolicy: row.concurrency_policy,
    concurrencyOutcome: row.concurrency_outcome,
    shadow: row.shadow,
    status: row.status,
    deadline: row.deadline,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapStep(row: StepRow): Record<string, unknown> {
  return {
    stepId: row.step_id,
    runId: row.run_id,
    stepType: row.step_type,
    idempotencyKey: row.idempotency_key,
    attempt: row.attempt,
    inputHash: row.input_hash,
    outputHash: row.output_hash,
    status: row.status,
    leaseOwner: row.lease_owner,
    leaseVersion: row.lease_version,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorClass: row.error_class,
    retryable: row.retryable,
  };
}

function mapOutbox(row: OutboxRow): Record<string, unknown> {
  return {
    outboxId: row.outbox_id,
    decisionRef: row.decision_ref,
    alertRef: row.alert_ref,
    channel: row.channel,
    payloadHash: row.payload_hash,
    status: row.status,
    claimOwner: row.claim_owner,
    claimFencingToken: row.claim_fencing_token === null ? null : Number(row.claim_fencing_token),
    claimExpiresAt: row.claim_expires_at,
    attempts: row.attempts,
    enqueuedAt: row.enqueued_at,
    claimedAt: row.claimed_at,
    sentAt: row.sent_at,
    lastError: row.last_error,
  };
}

/**
 * The exact byte string a `SchedulerPort` adapter must MAC for a delivery
 * whose parsed envelope is `body` (canonical JSON: recursively key-sorted,
 * byte-stable). The signature itself lives in a header, so it is never part of
 * the signed content.
 */
export function schedulerDeliveryPayload(body: unknown): string {
  return canonicalJson(body);
}

// --- the surface -----------------------------------------------------------

class InternalScheduleSurfaceImpl implements InternalScheduleSurface {
  private readonly engine: DatabaseEngine;
  private readonly schedulerSecret: string;
  private readonly now: string | (() => string) | undefined;
  private readonly replayWindowMs: number;
  private readonly schedulerPort: SchedulerPort;
  private readonly seenMessageIds: Set<string>;

  constructor(options: CreateInternalScheduleSurfaceOptions) {
    if (typeof options.schedulerSecret !== 'string' || options.schedulerSecret.length === 0) {
      throw new ForesiftError(
        ErrorCode.AUTHENTICATION_REFUSED,
        'internal surface requires a non-empty scheduler secret',
      );
    }
    this.engine = options.engine;
    this.schedulerSecret = options.schedulerSecret;
    this.now = options.now;
    this.replayWindowMs = options.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;
    if (!Number.isFinite(this.replayWindowMs) || this.replayWindowMs < 0) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULER_TIMESTAMP_INVALID,
        'replayWindowMs must be a non-negative finite duration',
        { replayWindowMs: options.replayWindowMs ?? null },
      );
    }
    this.schedulerPort = options.schedulerPort ?? new LocalSchedulerAdapter();
    this.seenMessageIds = new Set(options.seenMessageIds ?? []);
  }

  private resolveNow(): string {
    const candidate =
      typeof this.now === 'function' ? this.now() : (this.now ?? new Date().toISOString());
    if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULER_TIMESTAMP_INVALID,
        'internal surface clock is not a timestamp',
      );
    }
    return candidate;
  }

  /**
   * Fail-closed service authentication: every route requires a well-formed
   * bearer credential, and the presented credential must equal the configured
   * scheduler secret (constant-time). The trigger route additionally proves the
   * delivery itself with an HMAC over the payload.
   */
  private authenticate(headers: Map<string, string>): void {
    const authorization = headers.get('authorization');
    if (authorization === undefined) {
      throw new ForesiftError(ErrorCode.AUTHENTICATION_REFUSED, 'authorization header is required');
    }
    const match = BEARER_PATTERN.exec(authorization);
    const presented = match?.[1];
    if (presented === undefined) {
      throw new ForesiftError(
        ErrorCode.AUTHENTICATION_REFUSED,
        'authorization header must be a well-formed bearer credential',
      );
    }
    if (!constantTimeEquals(presented, this.schedulerSecret)) {
      throw new ForesiftError(
        ErrorCode.AUTHORIZATION_REFUSED,
        'presented credential is not authorized for the internal surface',
      );
    }
  }

  private notFound(pathname: string): InternalResponse {
    return jsonResponse(404, {
      ok: false,
      error: { code: InternalSurfaceCode.ROUTE_NOT_FOUND, message: `unknown route ${pathname}` },
    });
  }

  private methodNotAllowed(allowed: string): InternalResponse {
    return jsonResponse(
      405,
      {
        ok: false,
        error: {
          code: InternalSurfaceCode.METHOD_NOT_ALLOWED,
          message: `method not allowed; use ${allowed}`,
        },
      },
      { allow: allowed },
    );
  }

  async handle(request: InternalRequest): Promise<InternalResponse> {
    try {
      const parsedPath = parsePath(request.path);
      if (parsedPath === null) {
        throw new InternalSurfaceError(
          InternalSurfaceCode.REQUEST_INVALID,
          400,
          'request path must be an absolute path',
        );
      }
      const headers = headerMap(request.headers);
      this.authenticate(headers);
      const method = request.method.toUpperCase();
      const { pathname, query } = parsedPath;

      if (pathname === INTERNAL_SURFACE_ROUTES.trigger) {
        if (method !== 'POST') return this.methodNotAllowed('POST');
        return await this.handleTrigger(request, headers);
      }
      if (pathname === INTERNAL_SURFACE_ROUTES.reconcile) {
        if (method !== 'POST') return this.methodNotAllowed('POST');
        return await this.handleReconcile(request);
      }
      const actionMatch = ACTION_PATH_PATTERN.exec(pathname);
      if (actionMatch !== null) {
        if (method !== 'POST') return this.methodNotAllowed('POST');
        return await this.handleAction(decodeSegment(actionMatch[1] ?? ''), request);
      }
      if (pathname === INTERNAL_SURFACE_ROUTES.runs) {
        if (method !== 'GET') return this.methodNotAllowed('GET');
        return await this.handleRuns(query);
      }
      const runMatch = RUN_PATH_PATTERN.exec(pathname);
      if (runMatch !== null) {
        if (method !== 'GET') return this.methodNotAllowed('GET');
        return await this.handleRun(decodeSegment(runMatch[1] ?? ''));
      }
      if (pathname === INTERNAL_SURFACE_ROUTES.steps) {
        if (method !== 'GET') return this.methodNotAllowed('GET');
        return await this.handleSteps(query);
      }
      if (pathname === INTERNAL_SURFACE_ROUTES.deadLetters) {
        if (method !== 'GET') return this.methodNotAllowed('GET');
        return await this.handleDeadLetters(query);
      }
      if (pathname === INTERNAL_SURFACE_ROUTES.outbox) {
        if (method !== 'GET') return this.methodNotAllowed('GET');
        return await this.handleOutbox(query);
      }
      return this.notFound(pathname);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  // --- §25.3 trigger -------------------------------------------------------

  private async handleTrigger(
    request: InternalRequest,
    headers: Map<string, string>,
  ): Promise<InternalResponse> {
    const body = requireRecord(request.body, INTERNAL_SURFACE_ROUTES.trigger);
    const scheduleId = requireString(body.scheduleId, 'scheduleId');
    const messageId = headers.get(SCHEDULER_MESSAGE_ID_HEADER) ?? '';
    const deliveredAt = headers.get(SCHEDULER_DELIVERED_AT_HEADER) ?? '';
    const signature = headers.get(SCHEDULER_SIGNATURE_HEADER) ?? '';
    const now = this.resolveNow();
    const payload = schedulerDeliveryPayload(body);
    const scheduledFor = optionalString(body.scheduledFor) ?? deliveredAt;
    const source = optionalString(body.source) ?? 'scheduler';
    const workloadKind = isWorkloadKind(body.workloadKind) ? body.workloadKind : undefined;

    // §25.3 steps 1-2: trust boundary BEFORE any state write.
    verifySchedulerDelivery({
      payload,
      secret: this.schedulerSecret,
      deliveredAt,
      messageId,
      signature,
      now,
      replayWindowMs: this.replayWindowMs,
      seenMessageIds: this.seenMessageIds,
    });

    const result = await recordTriggerDelivery(this.engine, {
      source,
      externalMessageId: messageId,
      scheduleId,
      scheduledFor,
      payloadHash: sha256Text(payload),
      receivedAt: now,
      verifiedAt: now,
      ...(workloadKind === undefined ? {} : { workloadKind }),
    });
    // Only a delivery that reached durable state joins the in-process replay
    // guard; a cross-process redelivery stays the engine's idempotent collapse.
    this.seenMessageIds.add(messageId);
    return jsonResponse(202, { ok: true, ...result });
  }

  // --- §25.11 control actions ---------------------------------------------

  private async handleAction(
    scheduleId: string,
    request: InternalRequest,
  ): Promise<InternalResponse> {
    if (scheduleId.length === 0) {
      throw new InternalSurfaceError(
        InternalSurfaceCode.REQUEST_INVALID,
        400,
        'scheduleId path parameter is required',
      );
    }
    const body = requireRecord(request.body, INTERNAL_SURFACE_ROUTES.actions);
    const action = parseScheduleControlAction(body.action);
    const config = body.config;
    const now = optionalString(body.now);
    const versionId = optionalString(body.versionId);
    const forecastId = optionalString(body.forecastId);
    const requestId = optionalString(body.requestId);
    const newScheduleId = optionalString(body.newScheduleId);
    const input: ScheduleControlInput = {
      action,
      scheduleId,
      ...(now === undefined ? {} : { now }),
      ...(isRecord(config) ? { config: config as ScheduleConfigPatch } : {}),
      ...('forecast' in body ? { forecast: body.forecast } : {}),
      ...(isWorkloadKind(body.workloadKind) ? { workloadKind: body.workloadKind } : {}),
      ...(versionId === undefined ? {} : { versionId }),
      ...(forecastId === undefined ? {} : { forecastId }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(newScheduleId === undefined ? {} : { newScheduleId }),
    };
    const result = await applyScheduleControl(this.engine, input);
    return jsonResponse(200, { ok: true, result });
  }

  // --- §25.10 reconciliation ----------------------------------------------

  private async handleReconcile(request: InternalRequest): Promise<InternalResponse> {
    const body =
      request.body === undefined
        ? {}
        : requireRecord(request.body, INTERNAL_SURFACE_ROUTES.reconcile);
    const repair = body.repair === true;
    const now = optionalString(body.now);
    const report = await reconcileSchedules(this.engine, this.schedulerPort, {
      repair,
      ...(now === undefined ? {} : { now }),
    });
    return jsonResponse(200, { ok: true, report });
  }

  // --- read handlers (SELECT-only) ----------------------------------------

  private async handleRuns(query: URLSearchParams): Promise<InternalResponse> {
    const scheduleId = nullableParam(query.get('scheduleId'));
    const status = nullableParam(query.get('status'));
    const limit = parseLimit(query.get('limit'));
    const result = await this.engine.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM wf.runs
        WHERE ($1::text IS NULL OR schedule_id = $1)
          AND ($2::text IS NULL OR status = $2)
        ORDER BY run_id
        LIMIT $3`,
      [scheduleId, status, limit],
    );
    return jsonResponse(200, { ok: true, runs: result.rows.map(mapRun) });
  }

  private async handleRun(runId: string): Promise<InternalResponse> {
    if (runId.length === 0) {
      throw new InternalSurfaceError(
        InternalSurfaceCode.REQUEST_INVALID,
        400,
        'runId path parameter is required',
      );
    }
    const result = await this.engine.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM wf.runs WHERE run_id = $1`,
      [runId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ForesiftError(ErrorCode.WF_RUN_NOT_FOUND, 'unknown run', { runId });
    }
    return jsonResponse(200, { ok: true, run: mapRun(row) });
  }

  private async handleSteps(query: URLSearchParams): Promise<InternalResponse> {
    const runId = nullableParam(query.get('runId'));
    const limit = parseLimit(query.get('limit'));
    const result = await this.engine.query<StepRow>(
      `SELECT ${STEP_COLUMNS} FROM wf.steps
        WHERE ($1::text IS NULL OR run_id = $1)
        ORDER BY run_id, step_id
        LIMIT $2`,
      [runId, limit],
    );
    return jsonResponse(200, { ok: true, steps: result.rows.map(mapStep) });
  }

  private async handleDeadLetters(query: URLSearchParams): Promise<InternalResponse> {
    const status = nullableParam(query.get('status'));
    const records = await listDeadLetters(
      this.engine,
      status === null ? {} : { status: status as DeadLetterStatus },
    );
    return jsonResponse(200, { ok: true, deadLetters: records });
  }

  private async handleOutbox(query: URLSearchParams): Promise<InternalResponse> {
    const status = nullableParam(query.get('status'));
    const limit = parseLimit(query.get('limit'));
    const result = await this.engine.query<OutboxRow>(
      `SELECT ${OUTBOX_COLUMNS} FROM wf.notification_outbox
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY enqueued_at, outbox_id
        LIMIT $2`,
      [status, limit],
    );
    const checks = query.get('checks') === '1' ? await runAllWfStateChecks(this.engine) : undefined;
    return jsonResponse(200, {
      ok: true,
      outbox: result.rows.map(mapOutbox),
      ...(checks === undefined ? {} : { checks }),
    });
  }
}

/**
 * Build the internal schedule surface. The scheduler secret is injected, never
 * inlined; the surface never logs it or any payload.
 */
export function createInternalScheduleSurface(
  options: CreateInternalScheduleSurfaceOptions,
): InternalScheduleSurface {
  return new InternalScheduleSurfaceImpl(options);
}
