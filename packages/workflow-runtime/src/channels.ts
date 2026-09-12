/**
 * Notification channel seam and the deterministic fake channel (T024,
 * FR-WF-006, AC-011; PRD §26.6/§26.9).
 *
 * `NotificationChannelPort` is the ONLY way the durable workflow hands a
 * rendered notification to a delivery channel (Telegram, admin inbox, a future
 * email adapter). The port contract carries one law the engine depends on:
 *
 * > `send` is IDEMPOTENT BY `idempotencyKey`. Replaying a key that already
 * > reached the channel MUST return the original acknowledgement and MUST NOT
 * > deliver a second time.
 *
 * That law is what makes the outbox delivery worker exactly-once across
 * crashes: a worker may send, die before marking the outbox row SENT, and a
 * recovery worker re-sends the same row — the channel collapses the replay.
 *
 * `FakeNotificationChannel` implements the law for tests and records every
 * attempt plus per-delivery enqueue/ack timestamps so §26.9 latency sampling is
 * measurable. It can be configured to fail transiently or to "crash" after a
 * configurable number of deliveries (recording the delivery first, so the
 * crash models a worker dying AFTER the channel accepted the send and BEFORE
 * the outbox row was marked SENT).
 *
 * No production credential handling exists here: this engine never reads,
 * stores, or logs channel credentials, and `send` payloads are opaque.
 *
 * Strictly read-only: this module delivers intelligence notifications; it can
 * never trade, custody, sign, handle keys, or submit a transaction.
 */
import { ErrorCode, ForesiftError } from '@foresift/domain';

/** The hash contract every channel request must satisfy. */
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** One idempotent send request handed to a channel adapter. */
export interface NotificationSendRequest {
  /**
   * Stable idempotency key. The outbox delivery worker uses the outbox row id,
   * so a replayed delivery across a crash collapses to one channel delivery.
   */
  readonly idempotencyKey: string;
  /** Destination channel identifier (e.g. `telegram`, `admin-inbox`). */
  readonly channel: string;
  /** Opaque rendered payload; the engine never inspects or logs it. */
  readonly payload: unknown;
  /** Content address of `payload` (`sha256:<64hex>`). */
  readonly payloadHash: string;
}

/** The channel's acknowledgement for an accepted (or deduplicated) send. */
export interface NotificationSendAck {
  /** The instant the channel acknowledged the delivery (ISO-8601 UTC). */
  readonly ackAt: string;
  /** The channel's own message identifier for tracing. */
  readonly channelMessageId: string;
}

/**
 * The delivery seam. Implementations MUST be idempotent by `idempotencyKey`
 * (see the module contract above) and MUST retain enqueue/ack timestamps per
 * §26.9. A rejection means the delivery did not complete; the outbox worker
 * decides whether that is transient (retry) or permanent (fail).
 */
export interface NotificationChannelPort {
  send(request: NotificationSendRequest): Promise<NotificationSendAck>;
}

/** Typed channel failure. `retryable` distinguishes retry from permanent fail. */
export class NotificationChannelError extends ForesiftError {
  readonly retryable: boolean;

  constructor(
    message: string,
    detail: Record<string, string | number | boolean | null> = {},
    retryable = true,
  ) {
    super(ErrorCode.WF_NOTIFICATION_CHANNEL_FAILED, message, detail);
    this.name = 'NotificationChannelError';
    this.retryable = retryable;
  }
}

/**
 * A simulated process death inside the channel boundary. The delivery is
 * recorded BEFORE this is thrown, modelling "the channel accepted the send,
 * then the worker died before it could mark the outbox row SENT". The outbox
 * worker rethrows it untouched (no retry bookkeeping), because a real crash
 * cannot run cleanup either.
 */
export class NotificationChannelCrashError extends ForesiftError {
  constructor(message: string, detail: Record<string, string | number | boolean | null> = {}) {
    super(ErrorCode.WF_NOTIFICATION_CHANNEL_CRASHED, message, detail);
    this.name = 'NotificationChannelCrashError';
  }
}

/** True when a channel rejection should be retried from the outbox. */
export function isTransientChannelError(error: unknown): boolean {
  if (error instanceof NotificationChannelError) return error.retryable;
  if (error instanceof NotificationChannelCrashError) return false;
  // An unrecognized channel failure is treated as TRANSIENT: fail-closed here
  // means never DROPPING a notification on an unknown error (§25.8
  // NOTIFICATION_TRANSIENT -> retry from outbox).
  return true;
}

function assertText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
      `notification send ${field} is required`,
      { field },
    );
  }
  return value;
}

/** Trust nothing handed to a channel adapter: validate the request shape. */
function assertSendRequest(request: NotificationSendRequest): void {
  assertText(request.idempotencyKey, 'idempotencyKey');
  assertText(request.channel, 'channel');
  if (typeof request.payloadHash !== 'string' || !HASH_PATTERN.test(request.payloadHash)) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
      'notification send payloadHash must be a sha256 content address',
      { field: 'payloadHash' },
    );
  }
  if (request.payload === undefined) {
    throw new ForesiftError(
      ErrorCode.WF_OUTBOX_PAYLOAD_INVALID,
      'notification send payload is required',
      { field: 'payload' },
    );
  }
}

/** One recorded channel delivery (unique per idempotency key). */
export interface NotificationDeliveryRecord {
  /** 1-based order of the unique delivery. */
  readonly sequence: number;
  readonly idempotencyKey: string;
  readonly channel: string;
  readonly payloadHash: string;
  /** §26.9 enqueue instant (when the worker handed the payload over). */
  readonly enqueuedAt: string;
  /** §26.9 acknowledgement instant returned to the worker. */
  readonly ackAt: string;
  readonly channelMessageId: string;
}

/** One attempted send, including deduplicated replays and failures. */
export interface NotificationSendAttempt {
  readonly idempotencyKey: string;
  readonly channel: string;
  readonly payloadHash: string;
  readonly attemptedAt: string;
  /** `ACKNOWLEDGED`, `DEDUPLICATED`, `TRANSIENT_FAILURE`, or `CRASHED`. */
  readonly outcome: 'ACKNOWLEDGED' | 'DEDUPLICATED' | 'TRANSIENT_FAILURE' | 'CRASHED';
}

export interface FakeNotificationChannelOptions {
  /** Injected clock; every recorded timestamp comes from it. */
  readonly now?: () => string;
  /** Message-id prefix; the sequence number is appended. */
  readonly messageIdPrefix?: string;
}

/**
 * Deterministic in-memory channel for crash/interleaving tests. Idempotent by
 * key: the first send records a delivery; every replay returns the SAME ack and
 * records no second delivery.
 */
export class FakeNotificationChannel implements NotificationChannelPort {
  private readonly now: () => string;
  private readonly messageIdPrefix: string;
  private readonly recordsByKey = new Map<string, NotificationDeliveryRecord>();
  private transientFailuresRemaining = 0;
  private crashAtDeliveryCount: number | null = null;
  private crashFired = false;

  /** Every attempted send, in order (replays and failures included). */
  readonly attempts: NotificationSendAttempt[] = [];

  constructor(options: FakeNotificationChannelOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.messageIdPrefix = options.messageIdPrefix ?? 'fake-msg';
  }

  /**
   * Configure the next `times` sends to reject with a transient channel error
   * (the outbox should schedule a retry). Non-positive counts are a no-op.
   */
  failTransiently(times: number): void {
    this.transientFailuresRemaining = Math.max(0, Math.trunc(times));
  }

  /**
   * Configure a one-time crash: once `deliveries` unique deliveries have been
   * recorded, the send that reaches that count is RECORDED and then throws
   * `NotificationChannelCrashError`. A `deliveries` of 1 therefore means
   * "record the first delivery, then crash".
   */
  crashAfter(deliveries: number): void {
    this.crashAtDeliveryCount = Math.max(0, Math.trunc(deliveries));
    this.crashFired = false;
  }

  /** Unique deliveries (the exactly-once ledger). */
  get deliveries(): readonly NotificationDeliveryRecord[] {
    return [...this.recordsByKey.values()];
  }

  /** Count of unique deliveries — the exactly-once assertion surface. */
  get deliveryCount(): number {
    return this.recordsByKey.size;
  }

  /** Count of every send call, including replays and failures. */
  get callCount(): number {
    return this.attempts.length;
  }

  /** Count of idempotent replays that produced no new delivery. */
  get deduplicatedCount(): number {
    return this.attempts.filter((a) => a.outcome === 'DEDUPLICATED').length;
  }

  /** §26.9 latency samples: enqueue/ack pairs for every unique delivery. */
  latencySamples(): readonly { readonly enqueuedAt: string; readonly ackAt: string }[] {
    return this.deliveries.map((d) => ({ enqueuedAt: d.enqueuedAt, ackAt: d.ackAt }));
  }

  send(request: NotificationSendRequest): Promise<NotificationSendAck> {
    assertSendRequest(request);
    const attemptedAt = this.now();

    if (this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining -= 1;
      this.attempts.push({
        idempotencyKey: request.idempotencyKey,
        channel: request.channel,
        payloadHash: request.payloadHash,
        attemptedAt,
        outcome: 'TRANSIENT_FAILURE',
      });
      throw new NotificationChannelError('simulated transient channel failure', {
        idempotencyKey: request.idempotencyKey,
        channel: request.channel,
      });
    }

    const existing = this.recordsByKey.get(request.idempotencyKey);
    if (existing !== undefined) {
      this.attempts.push({
        idempotencyKey: request.idempotencyKey,
        channel: request.channel,
        payloadHash: request.payloadHash,
        attemptedAt,
        outcome: 'DEDUPLICATED',
      });
      return Promise.resolve({
        ackAt: existing.ackAt,
        channelMessageId: existing.channelMessageId,
      });
    }

    const record: NotificationDeliveryRecord = {
      sequence: this.recordsByKey.size + 1,
      idempotencyKey: request.idempotencyKey,
      channel: request.channel,
      payloadHash: request.payloadHash,
      enqueuedAt: attemptedAt,
      ackAt: this.now(),
      channelMessageId: `${this.messageIdPrefix}-${this.recordsByKey.size + 1}`,
    };
    this.recordsByKey.set(request.idempotencyKey, record);

    if (
      this.crashAtDeliveryCount !== null &&
      !this.crashFired &&
      this.recordsByKey.size >= this.crashAtDeliveryCount
    ) {
      this.crashFired = true;
      this.attempts.push({
        idempotencyKey: request.idempotencyKey,
        channel: request.channel,
        payloadHash: request.payloadHash,
        attemptedAt,
        outcome: 'CRASHED',
      });
      throw new NotificationChannelCrashError('simulated channel crash after delivery', {
        idempotencyKey: request.idempotencyKey,
        channelMessageId: record.channelMessageId,
      });
    }

    this.attempts.push({
      idempotencyKey: request.idempotencyKey,
      channel: request.channel,
      payloadHash: request.payloadHash,
      attemptedAt,
      outcome: 'ACKNOWLEDGED',
    });
    return Promise.resolve({
      ackAt: record.ackAt,
      channelMessageId: record.channelMessageId,
    });
  }
}
