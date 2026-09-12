/**
 * Canonical trigger-envelope fixtures (T030, FR-WF-002, AC-010; PRD §25.3).
 *
 * Every envelope is inert data: a raw body, the delivery instant, the
 * scheduler message id, and the HMAC delivery MAC computed over that tuple.
 * The `WF_TEST_*` secret is an OBVIOUS placeholder for local/PGlite tests —
 * never a credential, never a production value, never logged.
 *
 * The fixtures cover the complete trust-boundary vocabulary the engine must
 * classify:
 * - `VALID`      — signature verifies, inside the replay window, unseen;
 * - `FORGED`     — a MAC that does not verify over the delivered tuple;
 * - `EXPIRED`    — a correctly signed delivery outside the replay window;
 * - `REPLAYED`   — a correctly signed, in-window delivery whose message id was
 *                  already processed;
 * - `DUPLICATE`  — a byte-identical redelivery of `VALID` (the at-least-once
 *                  redelivery AC-010 collapses to one logical run).
 *
 * Builders are pure and deterministic: the same input always yields the same
 * MAC, so two callers provably present the SAME identity.
 */
import { computeDeliveryMac } from '@foresift/workflow-runtime';

/** Obvious placeholder secret; NOT a credential (PGlite/local tests only). */
export const WF_TEST_DELIVERY_SECRET = 'wf-test-placeholder-delivery-mac-key';

/** The §25.3 replay window used by the fixtures (5 minutes). */
export const WF_TEST_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** Deterministic fixture instant; suites pin their injected clocks to it. */
export const WF_TEST_T0 = '2026-06-01T12:00:00.000Z';

/** The primary fixture schedule every trigger envelope addresses. */
export const WF_TEST_SCHEDULE_ID = 'wf-fixture-schedule-primary';

/** A literal-free `sha256:<64hex>` content address for the delivered body. */
export const WF_TEST_PAYLOAD_HASH_A = `sha256:${'a'.repeat(64)}`;
export const WF_TEST_PAYLOAD_HASH_B = `sha256:${'b'.repeat(64)}`;

/** The closed classification a trust-boundary fixture expects. */
export const WF_TRIGGER_VERDICT = {
  VERIFIED: 'VERIFIED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  TIMESTAMP_OUT_OF_WINDOW: 'TIMESTAMP_OUT_OF_WINDOW',
  DELIVERY_REPLAYED: 'DELIVERY_REPLAYED',
} as const;
export type WfTriggerVerdict = (typeof WF_TRIGGER_VERDICT)[keyof typeof WF_TRIGGER_VERDICT];

/** One canonical scheduler delivery, ready for `verifySchedulerDelivery`. */
export interface WfTriggerEnvelopeFixture {
  readonly name: string;
  /** The raw delivered body (string, so the MAC is over the exact bytes). */
  readonly payload: string;
  readonly scheduleId: string;
  readonly payloadHash: string;
  readonly messageId: string;
  readonly deliveredAt: string;
  readonly secret: string;
  /** HMAC-SHA256 lowercase hex of `messageId\ndeliveredAt\npayload`. */
  readonly signature: string;
  readonly now: string;
  readonly replayWindowMs: number;
  /** Message ids the verifier must treat as already processed. */
  readonly seenMessageIds: readonly string[];
  readonly expectedVerdict: WfTriggerVerdict;
  /** Human note; never an assertion source. */
  readonly note: string;
}

export interface BuildTriggerEnvelopeInput {
  readonly name?: string;
  readonly messageId: string;
  readonly payload?: string;
  readonly scheduleId?: string;
  readonly payloadHash?: string;
  readonly deliveredAt?: string;
  readonly now?: string;
  readonly secret?: string;
  readonly replayWindowMs?: number;
  readonly seenMessageIds?: readonly string[];
  /** Replace the computed MAC with a fixed forged value. */
  readonly forgeSignature?: boolean;
  readonly note?: string;
}

/** The exact payload body the canonical fixtures deliver. */
export const WF_TRIGGER_CANONICAL_PAYLOAD = JSON.stringify({
  scheduleId: WF_TEST_SCHEDULE_ID,
  triggeredAt: WF_TEST_T0,
});

/**
 * Build one deterministic trigger envelope. The MAC is computed over the
 * `(messageId, deliveredAt, payload)` tuple with the placeholder secret unless
 * `forgeSignature` replaces it; everything else is carried verbatim so a test
 * can reproduce the exact `verifySchedulerDelivery` call.
 */
export function buildTriggerEnvelope(input: BuildTriggerEnvelopeInput): WfTriggerEnvelopeFixture {
  const payload = input.payload ?? WF_TRIGGER_CANONICAL_PAYLOAD;
  const deliveredAt = input.deliveredAt ?? WF_TEST_T0;
  const now = input.now ?? deliveredAt;
  const secret = input.secret ?? WF_TEST_DELIVERY_SECRET;
  const computed = computeDeliveryMac({
    payload,
    secret,
    deliveredAt,
    messageId: input.messageId,
  });
  return {
    name: input.name ?? input.messageId,
    payload,
    scheduleId: input.scheduleId ?? WF_TEST_SCHEDULE_ID,
    payloadHash: input.payloadHash ?? WF_TEST_PAYLOAD_HASH_A,
    messageId: input.messageId,
    deliveredAt,
    secret,
    signature: input.forgeSignature === true ? 'f'.repeat(64) : computed,
    now,
    replayWindowMs: input.replayWindowMs ?? WF_TEST_REPLAY_WINDOW_MS,
    seenMessageIds: input.seenMessageIds ?? [],
    expectedVerdict: input.forgeSignature
      ? WF_TRIGGER_VERDICT.SIGNATURE_INVALID
      : input.seenMessageIds !== undefined && input.seenMessageIds.length > 0
        ? WF_TRIGGER_VERDICT.DELIVERY_REPLAYED
        : Math.abs(Date.parse(now) - Date.parse(deliveredAt)) >
            (input.replayWindowMs ?? WF_TEST_REPLAY_WINDOW_MS)
          ? WF_TRIGGER_VERDICT.TIMESTAMP_OUT_OF_WINDOW
          : WF_TRIGGER_VERDICT.VERIFIED,
    note: input.note ?? 'canonical trigger envelope fixture',
  };
}

/** The message id the canonical valid/duplicate pair shares. */
export const WF_TEST_VALID_MESSAGE_ID = 'wf-fixture-msg-valid-1';

const valid = buildTriggerEnvelope({
  name: 'VALID',
  messageId: WF_TEST_VALID_MESSAGE_ID,
  note: 'correctly signed, in window, unseen',
});

/**
 * The canonical trigger envelope set. `DUPLICATE` is byte-identical to
 * `VALID` (same message id and MAC) — the redelivery AC-010 must collapse.
 */
export const WF_TRIGGER_ENVELOPES: Readonly<
  Record<'VALID' | 'FORGED' | 'EXPIRED' | 'REPLAYED' | 'DUPLICATE', WfTriggerEnvelopeFixture>
> = Object.freeze({
  VALID: valid,
  FORGED: buildTriggerEnvelope({
    name: 'FORGED',
    messageId: 'wf-fixture-msg-forged-1',
    forgeSignature: true,
    note: 'MAC does not verify over the delivered tuple',
  }),
  EXPIRED: buildTriggerEnvelope({
    name: 'EXPIRED',
    messageId: 'wf-fixture-msg-expired-1',
    deliveredAt: '2026-06-01T11:00:00.000Z',
    now: WF_TEST_T0,
    note: 'correctly signed but an hour outside the five-minute window',
  }),
  REPLAYED: buildTriggerEnvelope({
    name: 'REPLAYED',
    messageId: 'wf-fixture-msg-replayed-1',
    seenMessageIds: ['wf-fixture-msg-replayed-1'],
    note: 'correctly signed and in window, but the id was already processed',
  }),
  DUPLICATE: { ...valid, name: 'DUPLICATE', note: 'byte-identical redelivery of VALID' },
});

/** Every fixture in a stable order (the classification matrix). */
export const ALL_WF_TRIGGER_ENVELOPES: readonly WfTriggerEnvelopeFixture[] = Object.freeze([
  WF_TRIGGER_ENVELOPES.VALID,
  WF_TRIGGER_ENVELOPES.FORGED,
  WF_TRIGGER_ENVELOPES.EXPIRED,
  WF_TRIGGER_ENVELOPES.REPLAYED,
  WF_TRIGGER_ENVELOPES.DUPLICATE,
]);

/**
 * Two envelopes that share an identity but legitimately target different
 * schedules — the cross-schedule reuse the inbox identity must refuse.
 */
export const WF_CROSS_SCHEDULE_MESSAGE_ID = 'wf-fixture-msg-cross-schedule-1';
export const WF_CROSS_SCHEDULE_SCHEDULE_A = 'wf-fixture-schedule-cross-a';
export const WF_CROSS_SCHEDULE_SCHEDULE_B = 'wf-fixture-schedule-cross-b';
