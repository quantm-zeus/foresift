/**
 * Webhook / callback integrity (FR-SEC-005; AC-051 forged-scheduler
 * battery). Every inbound callback passes:
 *
 *   malformed-payload refusal → timestamp maximum-age check → injectable
 *   cryptographic signature verification → replay prevention via an
 *   event-ID + payload-hash cache.
 *
 * REPLAY-CACHE SCOPE CONTRACT (M6): the dedupe cache is deliberately
 * IN-MEMORY and PER-PROCESS. It bounds replays within one process lifetime;
 * it does NOT survive restarts, span replicas, or outlive capacity eviction.
 * Deployments running multiple replicas or requiring cross-restart replay
 * immunity MUST back the dedupe key with shared durable state at the wiring
 * layer (recorded as an explicit pre-wiring task — the key format emitted by
 * `verifyCallback` is the persistence contract).
 *
 * The FIXED-ENDPOINT rule lives here too: reconnect/backfill URLs come from
 * CONFIGURATION only — a URL carried inside an event payload is refused as
 * a source, no matter how valid the event looks. Malformed events can never
 * advance a checkpoint (`guardCheckpointAdvance`).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SecErrorCode, WebhookIntegrityError } from './errors.ts';
import { numericIncludes, snapshotCallerInput } from './shadow-safe.ts';

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

export interface WebhookGuardOptions {
  readonly verifier: SignatureVerifier;
  /** Callbacks older than this (seconds) are refused as stale. */
  readonly maxAgeSeconds: number;
  /** Injected clock in epoch ms — deterministic tests, honest production. */
  readonly nowMs: () => number;
  readonly replayCacheCapacity?: number;
}

export type DedupeKey = string;

export class WebhookGuard {
  private readonly verifier: SignatureVerifier;
  private readonly maxAgeSeconds: number;
  private readonly nowMs: () => number;
  private readonly seen: Map<DedupeKey, true>;
  private readonly capacity: number;

  constructor(options: WebhookGuardOptions) {
    // Fail-closed at construction (L12): a non-finite or non-positive window
    // would silently disable staleness checks for JS callers (NaN compares
    // false), so it never constructs a guard at all.
    //
    // H4 single-read binding: `maxAgeSeconds` was read once per validation
    // clause and once more for the stored field, so an accessor could present
    // a finite positive value to the checks and a divergent (e.g. Infinity)
    // value to enforcement. Bind it ONCE and enforce that exact local.
    const maxAgeSeconds = options.maxAgeSeconds;
    const replayCacheCapacity = options.replayCacheCapacity;
    if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
      throw new WebhookIntegrityError(
        'maxAgeSeconds must be a positive finite number',
        { maxAgeSeconds },
        SecErrorCode.SEC_WEBHOOK_TIMESTAMP_STALE,
      );
    }
    this.verifier = options.verifier;
    this.maxAgeSeconds = maxAgeSeconds;
    this.nowMs = options.nowMs;
    this.capacity = replayCacheCapacity ?? 10_000;
    this.seen = new Map();
  }

  /**
   * Verify one callback. Returns the dedupe key on success; raises typed
   * WebhookIntegrityError otherwise.
   */
  async verifyCallback(rawInput: CallbackInput): Promise<DedupeKey> {
    // Single-read binding (V7 accessor class): the timestamp check, the
    // signature verification over the received bytes, and the dedupe key must
    // all observe the SAME delivery — a getter could otherwise present a fresh
    // timestamp/bytes to the check and different bytes to the replay key.
    const input = snapshotCallerInput(rawInput);
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
    //    H5 fail-closed instant binding: an ABSENT, NaN, or non-finite
    //    `signatureTimestamp` (or a NaN injected clock) makes every
    //    `Math.abs(now - ts) > window` comparison false, which silently
    //    disables staleness. Require a real finite instant on BOTH sides and
    //    bind each exactly once.
    const signatureTimestamp = input.signatureTimestamp;
    const nowMs = this.nowMs();
    if (
      typeof signatureTimestamp !== 'number' ||
      !Number.isFinite(signatureTimestamp) ||
      typeof nowMs !== 'number' ||
      !Number.isFinite(nowMs) ||
      Math.abs(nowMs - signatureTimestamp) > this.maxAgeSeconds * 1000
    ) {
      throw new WebhookIntegrityError(
        'callback timestamp missing or outside the maximum age',
        {},
        SecErrorCode.SEC_WEBHOOK_TIMESTAMP_STALE,
      );
    }

    // 3. Cryptographic verification over the exact received bytes.
    const signature = input.signature;
    if (signature === undefined || !(await this.verifier(input.payloadBytes, signature))) {
      throw new WebhookIntegrityError('callback signature verification failed');
    }

    // 4. Replay prevention: event-ID + payload-hash pair, LRU-bounded.
    const dedupeKey = `${input.eventId}:${createHash('sha256').update(input.payloadBytes).digest('hex')}`;
    if (this.seen.has(dedupeKey)) {
      throw new WebhookIntegrityError(
        'callback is a replay of an already-processed delivery',
        { dedupeKey },
        SecErrorCode.SEC_WEBHOOK_REPLAY_DETECTED,
      );
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
    rawConfiguredEndpoints: readonly string[],
  ): void {
    // Single-read binding (V7 accessor class): the allowlist is read once.
    const configuredEndpoints = snapshotCallerInput(rawConfiguredEndpoints);
    if (!numericIncludes(configuredEndpoints, candidateUrl)) {
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
  guardCheckpointAdvance(rawEvent: unknown): boolean {
    if (typeof rawEvent !== 'object' || rawEvent === null) return false;
    // Single-read binding (V7 accessor class): the id check and the
    // serialization proof must observe the same read. A non-plain carrier
    // (class instance, boxed primitive, Proxy) is not provably plain data, so
    // the documented fail-closed `false` contract covers it too.
    let event: unknown;
    try {
      event = snapshotCallerInput(rawEvent);
    } catch {
      return false;
    }
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
