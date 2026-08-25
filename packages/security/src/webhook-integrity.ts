/**
 * Webhook / callback integrity (FR-SEC-005; AC-051 forged-scheduler
 * battery). Every inbound callback passes:
 *
 *   malformed-payload refusal → timestamp maximum-age check → injectable
 *   cryptographic signature verification → replay prevention via an
 *   event-ID + payload-hash cache.
 *
 * REPLAY-CACHE SCOPE CONTRACT (M6): the built-in dedupe cache is
 * deliberately IN-MEMORY and PER-PROCESS. It bounds replays within one
 * process lifetime; it does NOT survive restarts, span replicas, or outlive
 * capacity eviction. Deployments running multiple replicas or requiring
 * cross-restart replay immunity MUST wire a {@link WebhookDedupeStore}
 * (R4/M6 seam): the guard then consults shared durable state before
 * accepting and persists the dedupe key BEFORE returning success, so no
 * delivery is acknowledged on an unpersisted key. The key format emitted by
 * `verifyCallback` — `eventId:sha256(payloadBytes)` — is the persistence
 * contract in both modes.
 *
 * The FIXED-ENDPOINT rule lives here too: reconnect/backfill URLs come from
 * CONFIGURATION only — a URL carried inside an event payload is refused as
 * a source, no matter how valid the event looks. Malformed events can never
 * advance a checkpoint (`guardCheckpointAdvance`).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SecErrorCode, WebhookIntegrityError } from './errors.ts';

/** Injectable verifier: returns true when signature is valid for the material. */
export type SignatureVerifier = (
  payloadBytes: Uint8Array,
  signature: string,
) => Promise<boolean> | boolean;

/** Standard HMAC-SHA256 verifier for `sha256=<hex>` style headers. */
export function hmacSha256Verifier(secret: string): SignatureVerifier {
  return (payloadBytes, signature) => {
    const expected = createHmac('sha256', secret).update(payloadBytes).digest('hex');
    const provided = signature.startsWith('sha256=')
      ? signature.slice('sha256='.length)
      : signature;
    if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided.toLowerCase(), 'hex'),
    );
  };
}

export interface CallbackInput {
  readonly eventId: string;
  /** Raw body bytes exactly as received (verification binds to THESE). */
  readonly payloadBytes: Uint8Array;
  readonly signature?: string | undefined;
  readonly signatureTimestamp?: number | undefined;
}

export type DedupeKey = string;

/**
 * Durable dedupe backing store (R4/M6 seam). Implementations back the
 * per-process replay cache with SHARED durable state so replay immunity
 * survives restarts and spans replicas. `has` must answer for every key any
 * replica persisted; `put` must make the key durable before the delivery is
 * acknowledged — the guard refuses to return success on an unpersisted key,
 * so `put` failures propagate and nothing is remembered locally.
 */
export interface WebhookDedupeStore {
  readonly has: (key: DedupeKey) => Promise<boolean> | boolean;
  readonly put: (key: DedupeKey) => Promise<void> | void;
}

export interface WebhookGuardOptions {
  readonly verifier: SignatureVerifier;
  /** Callbacks older than this (seconds) are refused as stale. */
  readonly maxAgeSeconds: number;
  /** Injected clock in epoch ms — deterministic tests, honest production. */
  readonly nowMs: () => number;
  readonly replayCacheCapacity?: number;
  /**
   * Optional durable dedupe backing (M6). When wired, replay checks consult
   * it in addition to the local cache; an unavailable backing store refuses
   * fail-closed (SEC_WEBHOOK_DEDUPE_STATE_UNAVAILABLE) instead of trusting
   * unprovable freshness.
   */
  readonly dedupeStore?: WebhookDedupeStore | undefined;
}

export class WebhookGuard {
  private readonly verifier: SignatureVerifier;
  private readonly maxAgeSeconds: number;
  private readonly nowMs: () => number;
  private readonly seen: Map<DedupeKey, true>;
  private readonly capacity: number;
  private readonly dedupeStore: WebhookDedupeStore | undefined;

  constructor(options: WebhookGuardOptions) {
    // Fail-closed at construction (L12): a non-finite or non-positive window
    // would silently disable staleness checks for JS callers (NaN compares
    // false), so it never constructs a guard at all.
    if (!Number.isFinite(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
      throw new WebhookIntegrityError(
        'maxAgeSeconds must be a positive finite number',
        { maxAgeSeconds: options.maxAgeSeconds },
        SecErrorCode.SEC_WEBHOOK_TIMESTAMP_STALE,
      );
    }
    this.verifier = options.verifier;
    this.maxAgeSeconds = options.maxAgeSeconds;
    this.nowMs = options.nowMs;
    this.capacity = options.replayCacheCapacity ?? 10_000;
    this.seen = new Map();
    this.dedupeStore = options.dedupeStore;
  }

  /**
   * Verify one callback. Returns the dedupe key on success; raises typed
   * WebhookIntegrityError otherwise.
   */
  async verifyCallback(input: CallbackInput): Promise<DedupeKey> {
    // 1. Malformed refusal — empty or non-parseable bodies die here.
    let text: string;
    try {
      text = new TextDecoder().decode(input.payloadBytes);
    } catch {
      throw new WebhookIntegrityError(
        'callback payload is not decodable',
        {},
        SecErrorCode.SEC_WEBHOOK_SIGNATURE_INVALID,
      );
    }
    if (text.trim() === '' || !isValidJson(text)) {
      throw new WebhookIntegrityError(
        'callback payload is not valid JSON',
        {},
        SecErrorCode.SEC_WEBHOOK_SIGNATURE_INVALID,
      );
    }

    // 2. Timestamp maximum age — stale deliveries are refused outright.
    if (
      input.signatureTimestamp === undefined ||
      Math.abs(this.nowMs() - input.signatureTimestamp) > this.maxAgeSeconds * 1000
    ) {
      throw new WebhookIntegrityError(
        'callback timestamp missing or outside the maximum age',
        {},
        SecErrorCode.SEC_WEBHOOK_TIMESTAMP_STALE,
      );
    }

    // 3. Cryptographic verification over the exact received bytes.
    if (
      input.signature === undefined ||
      !(await this.verifier(input.payloadBytes, input.signature))
    ) {
      throw new WebhookIntegrityError('callback signature verification failed');
    }

    // 4. Replay prevention: event-ID + payload-hash pair, LRU-bounded
    // locally and — when a durable store is wired (M6) — checked against
    // shared state spanning restarts and replicas.
    const dedupeKey = `${input.eventId}:${createHash('sha256').update(input.payloadBytes).digest('hex')}`;
    let durablySeen = false;
    if (!this.seen.has(dedupeKey) && this.dedupeStore !== undefined) {
      try {
        durablySeen = await this.dedupeStore.has(dedupeKey);
      } catch (cause) {
        // Fail-closed: an unanswerable dedupe backing cannot prove the
        // delivery fresh, so it is refused, never processed on faith.
        throw new WebhookIntegrityError(
          'dedupe backing store is unavailable; delivery freshness cannot be proven',
          { dedupeKey },
          SecErrorCode.SEC_WEBHOOK_DEDUPE_STATE_UNAVAILABLE,
          { cause: cause instanceof Error ? cause.message : String(cause) },
        );
      }
    }
    if (this.seen.has(dedupeKey) || durablySeen) {
      throw new WebhookIntegrityError(
        'callback is a replay of an already-processed delivery',
        { dedupeKey },
        SecErrorCode.SEC_WEBHOOK_REPLAY_DETECTED,
      );
    }
    if (this.dedupeStore !== undefined) {
      // Durable-before-ack: persist first, THEN remember locally. A failing
      // put propagates with nothing remembered, so the sender's retry is
      // re-verified cleanly instead of being misread as an in-process replay.
      await this.dedupeStore.put(dedupeKey);
    }
    this.remember(dedupeKey);
    return dedupeKey;
  }

  private remember(key: DedupeKey): void {
    if (this.seen.size >= this.capacity) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(key, true);
  }

  /**
   * FIXED-ENDPOINT rule: reconnect/backfill endpoints may ONLY come from
   * configuration. Any URL sourced from an event payload is structurally
   * refused as a source — this function exists so call sites can prove it.
   */
  assertEndpointFromConfiguration(
    candidateUrl: string,
    configuredEndpoints: readonly string[],
  ): void {
    if (!configuredEndpoints.includes(candidateUrl)) {
      throw new WebhookIntegrityError(
        'endpoint is not part of configured callback URLs; payload-sourced endpoints are refused',
        {},
        SecErrorCode.SEC_WEBHOOK_ENDPOINT_SOURCE_REFUSED,
      );
    }
  }

  /**
   * Contract hook: a malformed event must NEVER advance a checkpoint.
   * Returns FALSE for anything but a well-formed, JSON-serializable object
   * carrying its id — callers treat `false` as "stop processing, advance
   * nothing". Serialization failures (circular structures, BigInt) are part
   * of the documented `false` contract, never thrown.
   */
  guardCheckpointAdvance(event: unknown): boolean {
    if (typeof event !== 'object' || event === null) return false;
    const candidate = event as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false;
    try {
      JSON.stringify(event);
      return true;
    } catch {
      return false;
    }
  }
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
