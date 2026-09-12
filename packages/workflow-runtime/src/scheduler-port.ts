/**
 * `SchedulerPort` — the only external-scheduler seam (ADR-G2WF-2, FR-WF-002,
 * FR-WF-005; PRD §25.1/§25.3/§25.10).
 *
 * All schedule <-> scheduler interaction (create/update/delete/get/list) passes
 * through this interface, so QStash specifics — signed delivery, replay
 * windows, external IDs — live only in the adapter and tests can prove the
 * engine without any vendor access or network I/O. Two adapters ship here:
 *
 * - `LocalSchedulerAdapter`: deterministic in-process implementation for
 *   development and PGlite tests.
 * - `QStashSchedulerAdapter`: a thin adapter over an INJECTED transport. No
 *   vendor SDK dependency and no network access in tests.
 *
 * Delivery trust boundary (§9.3): an inbound scheduler callback is untrusted
 * until its HMAC-SHA256 delivery MAC verifies, its timestamp is inside the
 * replay window, and its message id has not been seen before. Every refusal is
 * a typed `ForesiftError` — a forged delivery never reaches state.
 *
 * Strictly read-only: this module can schedule reads and notifications; it can
 * never trade, custody, sign, handle keys, or submit a transaction.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErrorCode, ForesiftError } from '@foresift/domain';

/** The scheduler's view of one recurring trigger. */
export interface SchedulerSchedule {
  readonly externalId: string;
  readonly scheduleId: string;
  readonly cron: string;
  readonly timezone: string;
  readonly paused: boolean;
  readonly destination: string;
}

/** Fields a caller may set when creating or updating an external schedule. */
export interface SchedulerScheduleInput {
  readonly scheduleId: string;
  readonly cron: string;
  readonly timezone: string;
  readonly paused: boolean;
  readonly destination: string;
}

/**
 * The scheduler seam (ADR-G2WF-2). Implementations MUST be pure ports: no
 * product policy inside, only transport plus the delivery trust boundary.
 */
export interface SchedulerPort {
  create(input: SchedulerScheduleInput): Promise<SchedulerSchedule>;
  update(externalId: string, input: SchedulerScheduleInput): Promise<SchedulerSchedule>;
  delete(externalId: string): Promise<void>;
  get(externalId: string): Promise<SchedulerSchedule | null>;
  list(): Promise<readonly SchedulerSchedule[]>;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULER_NOT_FOUND, `scheduler ${field} is required`, {
      field,
    });
  }
  return value;
}

/** Trust nothing from the wire: validate the field set before using a schedule. */
function parseSchedulerSchedule(value: unknown): SchedulerSchedule {
  if (value === null || typeof value !== 'object') {
    throw new ForesiftError(ErrorCode.WF_SCHEDULER_NOT_FOUND, 'scheduler returned no schedule');
  }
  const record = value as Record<string, unknown>;
  const paused = record.paused;
  if (typeof paused !== 'boolean') {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_NOT_FOUND,
      'scheduler schedule is missing a boolean paused flag',
    );
  }
  return {
    externalId: requireNonEmpty(record.externalId, 'externalId'),
    scheduleId: requireNonEmpty(record.scheduleId, 'scheduleId'),
    cron: requireNonEmpty(record.cron, 'cron'),
    timezone: requireNonEmpty(record.timezone, 'timezone'),
    paused,
    destination: requireNonEmpty(record.destination, 'destination'),
  };
}

function cloneSchedule(schedule: SchedulerSchedule): SchedulerSchedule {
  return { ...schedule };
}

/** Deterministic external id for the local adapter: `local:<scheduleId>`. */
export function localExternalId(scheduleId: string): string {
  return `local:${requireNonEmpty(scheduleId, 'scheduleId')}`;
}

/**
 * Deterministic in-process scheduler (dev + PGlite tests). `create` is an
 * idempotent upsert keyed by the deterministic external id, so a repeated
 * create (a reconciliation repair) converges instead of duplicating.
 */
export class LocalSchedulerAdapter implements SchedulerPort {
  private readonly schedules = new Map<string, SchedulerSchedule>();

  create(input: SchedulerScheduleInput): Promise<SchedulerSchedule> {
    const externalId = localExternalId(input.scheduleId);
    const schedule: SchedulerSchedule = {
      externalId,
      scheduleId: input.scheduleId,
      cron: input.cron,
      timezone: input.timezone,
      paused: input.paused,
      destination: input.destination,
    };
    this.schedules.set(externalId, schedule);
    return Promise.resolve(cloneSchedule(schedule));
  }

  update(externalId: string, input: SchedulerScheduleInput): Promise<SchedulerSchedule> {
    if (!this.schedules.has(externalId)) {
      throw new ForesiftError(ErrorCode.WF_SCHEDULER_NOT_FOUND, 'unknown external schedule', {
        externalId,
      });
    }
    const schedule: SchedulerSchedule = {
      externalId,
      scheduleId: input.scheduleId,
      cron: input.cron,
      timezone: input.timezone,
      paused: input.paused,
      destination: input.destination,
    };
    this.schedules.set(externalId, schedule);
    return Promise.resolve(cloneSchedule(schedule));
  }

  delete(externalId: string): Promise<void> {
    if (!this.schedules.has(externalId)) {
      throw new ForesiftError(ErrorCode.WF_SCHEDULER_NOT_FOUND, 'unknown external schedule', {
        externalId,
      });
    }
    this.schedules.delete(externalId);
    return Promise.resolve();
  }

  get(externalId: string): Promise<SchedulerSchedule | null> {
    const found = this.schedules.get(externalId);
    return Promise.resolve(found === undefined ? null : cloneSchedule(found));
  }

  list(): Promise<readonly SchedulerSchedule[]> {
    return Promise.resolve(
      [...this.schedules.values()]
        .map(cloneSchedule)
        .sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0)),
    );
  }

  /** Test/dev inspection only: number of known external schedules. */
  get size(): number {
    return this.schedules.size;
  }
}

// --- QStash adapter over an injected transport -----------------------------

export interface SchedulerTransportRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
}

export interface SchedulerTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

/** The vendor transport seam. Tests inject a fake; production injects fetch. */
export interface SchedulerTransport {
  request(input: SchedulerTransportRequest): Promise<SchedulerTransportResponse>;
}

export interface QStashSchedulerAdapterOptions {
  readonly transport: SchedulerTransport;
  /** Base path for the schedule collection. */
  readonly basePath?: string;
}

/**
 * Thin QStash-shaped adapter (ADR-G2WF-2). It carries no product logic: each
 * method is one transport call plus trust-nothing response validation. A
 * non-2xx response or a transport throw refuses with
 * `WF_SCHEDULER_TRANSPORT_FAILED`; a 404 on `get` is the only tolerated miss.
 */
export class QStashSchedulerAdapter implements SchedulerPort {
  private readonly transport: SchedulerTransport;
  private readonly basePath: string;

  constructor(options: QStashSchedulerAdapterOptions) {
    this.transport = options.transport;
    this.basePath = options.basePath ?? '/v2/schedules';
  }

  private async call(
    method: SchedulerTransportRequest['method'],
    path: string,
    body?: unknown,
  ): Promise<SchedulerTransportResponse> {
    try {
      return await this.transport.request(
        body === undefined ? { method, path } : { method, path, body },
      );
    } catch (error) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULER_TRANSPORT_FAILED,
        'scheduler transport threw',
        { method, path, cause: error instanceof Error ? error.name : 'unknown' },
      );
    }
  }

  private async callSchedule(
    method: SchedulerTransportRequest['method'],
    path: string,
    body?: unknown,
  ): Promise<SchedulerSchedule> {
    const response = await this.call(method, path, body);
    if (response.status < 200 || response.status >= 300) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULER_TRANSPORT_FAILED,
        'scheduler rejected request',
        {
          method,
          path,
          status: response.status,
        },
      );
    }
    return parseSchedulerSchedule(response.body);
  }

  create(input: SchedulerScheduleInput): Promise<SchedulerSchedule> {
    return this.callSchedule('POST', this.basePath, input);
  }

  update(externalId: string, input: SchedulerScheduleInput): Promise<SchedulerSchedule> {
    return this.callSchedule('PATCH', `${this.basePath}/${encodeURIComponent(externalId)}`, input);
  }

  async delete(externalId: string): Promise<void> {
    const response = await this.call(
      'DELETE',
      `${this.basePath}/${encodeURIComponent(externalId)}`,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULER_TRANSPORT_FAILED,
        'scheduler rejected delete',
        {
          externalId,
          status: response.status,
        },
      );
    }
  }

  async get(externalId: string): Promise<SchedulerSchedule | null> {
    const response = await this.call('GET', `${this.basePath}/${encodeURIComponent(externalId)}`);
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) {
      throw new ForesiftError(ErrorCode.WF_SCHEDULER_TRANSPORT_FAILED, 'scheduler rejected get', {
        externalId,
        status: response.status,
      });
    }
    return parseSchedulerSchedule(response.body);
  }

  async list(): Promise<readonly SchedulerSchedule[]> {
    const response = await this.call('GET', this.basePath);
    if (response.status < 200 || response.status >= 300) {
      throw new ForesiftError(ErrorCode.WF_SCHEDULER_TRANSPORT_FAILED, 'scheduler rejected list', {
        status: response.status,
      });
    }
    const body = response.body;
    const rows = Array.isArray(body)
      ? body
      : body !== null &&
          typeof body === 'object' &&
          Array.isArray((body as { schedules?: unknown }).schedules)
        ? (body as { schedules: unknown[] }).schedules
        : null;
    if (rows === null) {
      throw new ForesiftError(
        ErrorCode.WF_SCHEDULER_TRANSPORT_FAILED,
        'scheduler list response is not an array of schedules',
      );
    }
    return rows.map(parseSchedulerSchedule);
  }
}

// --- Delivery trust boundary (§9.3 / §25.3 step 1-2) -----------------------

export interface SchedulerDeliveryMacInput {
  readonly payload: string;
  readonly secret: string;
  readonly deliveredAt: string;
  readonly messageId: string;
}

export interface SchedulerDeliveryVerificationInput extends SchedulerDeliveryMacInput {
  readonly signature: string;
  readonly now: string;
  readonly replayWindowMs: number;
  /** Message ids already recorded as processed. */
  readonly seenMessageIds?: readonly string[] | ReadonlySet<string>;
}

export interface SchedulerDeliveryVerification {
  readonly verified: true;
  readonly messageId: string;
  readonly deliveredAt: string;
  readonly mac: string;
}

/** Canonical signing string: message id, delivery instant, then the raw body. */
function deliveryMacMessage(input: SchedulerDeliveryMacInput): string {
  return `${input.messageId}\n${input.deliveredAt}\n${input.payload}`;
}

/** HMAC-SHA256 over the canonical delivery message, lowercase hex. */
export function computeDeliveryMac(input: SchedulerDeliveryMacInput): string {
  return createHmac('sha256', input.secret).update(deliveryMacMessage(input), 'utf8').digest('hex');
}

function normalizeSignature(signature: string): string {
  const value = signature.trim().toLowerCase();
  return value.startsWith('sha256=') ? value.slice('sha256='.length) : value;
}

function parseInstant(value: unknown, field: string): number {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ForesiftError(ErrorCode.WF_SCHEDULER_TIMESTAMP_INVALID, `${field} is required`, {
      field,
    });
  }
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_TIMESTAMP_INVALID,
      `${field} is not a timestamp`,
      {
        field,
        value,
      },
    );
  }
  return millis;
}

function wasSeen(
  seen: readonly string[] | ReadonlySet<string> | undefined,
  messageId: string,
): boolean {
  if (seen === undefined) return false;
  if (Array.isArray(seen)) return (seen as readonly string[]).includes(messageId);
  return (seen as ReadonlySet<string>).has(messageId);
}

/**
 * Verify an inbound scheduler delivery BEFORE any state write (§25.3 steps
 * 1-2). Fail-closed order: MAC first (a forged delivery must never be
 * classified as something else), then the replay window, then message-id
 * replay. Any failure is a typed refusal.
 */
export function verifySchedulerDelivery(
  input: SchedulerDeliveryVerificationInput,
): SchedulerDeliveryVerification {
  if (typeof input.payload !== 'string' || input.payload.length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
      'delivery payload is required',
    );
  }
  if (typeof input.secret !== 'string' || input.secret.length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
      'delivery secret is required',
    );
  }
  if (typeof input.messageId !== 'string' || input.messageId.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
      'delivery message id is required',
    );
  }
  if (typeof input.signature !== 'string' || input.signature.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
      'delivery signature is required',
    );
  }
  if (!Number.isFinite(input.replayWindowMs) || input.replayWindowMs < 0) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_TIMESTAMP_INVALID,
      'replay window must be a non-negative finite duration',
      { replayWindowMs: input.replayWindowMs },
    );
  }

  const deliveredAtMs = parseInstant(input.deliveredAt, 'deliveredAt');
  const nowMs = parseInstant(input.now, 'now');

  const expected = Buffer.from(
    computeDeliveryMac({
      payload: input.payload,
      secret: input.secret,
      deliveredAt: input.deliveredAt,
      messageId: input.messageId,
    }),
    'utf8',
  );
  const presented = Buffer.from(normalizeSignature(input.signature ?? ''), 'utf8');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_SIGNATURE_INVALID,
      'delivery signature does not verify',
      { messageId: input.messageId },
    );
  }

  if (Math.abs(nowMs - deliveredAtMs) > input.replayWindowMs) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_TIMESTAMP_OUT_OF_WINDOW,
      'delivery timestamp is outside the replay window',
      {
        messageId: input.messageId,
        deliveredAt: input.deliveredAt,
        now: input.now,
        replayWindowMs: input.replayWindowMs,
      },
    );
  }

  if (wasSeen(input.seenMessageIds, input.messageId)) {
    throw new ForesiftError(
      ErrorCode.WF_SCHEDULER_DELIVERY_REPLAYED,
      'delivery message id has already been processed',
      { messageId: input.messageId },
    );
  }

  return {
    verified: true,
    messageId: input.messageId,
    deliveredAt: input.deliveredAt,
    mac: expected.toString('utf8'),
  };
}
