/**
 * Webhook forgery corpus (AC-053/AC-277 supporting evidence): replayed,
 * stale, tampered, and misbound callback shapes that webhook verification
 * must refuse. Inert data — suites build real HMACs over these payloads via
 * packages/security webhook-guard primitives.
 */
import { createHash } from 'node:crypto';

export interface ForgedCallbackSample {
  readonly name: string;
  readonly eventId: string;
  readonly payloadUtf8: string;
  /** Signature computed over DIFFERENT bytes than payloadUtf8 (tamper). */
  readonly signatureOverDifferentBytes: string;
  /** Signature minted with the WRONG secret (forgery). */
  readonly foreignSecretSignature: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export const FORGED_CALLBACK_SAMPLES: readonly ForgedCallbackSample[] = [
  {
    name: 'collector-event-tampered-payload',
    eventId: 'evt_forgery_0001',
    payloadUtf8: '{"kind":"chain_event","slot":1}',
    signatureOverDifferentBytes: sha256Hex('{"kind":"chain_event","slot":999}'),
    foreignSecretSignature: sha256Hex('{"kind":"chain_event","slot":1}'),
  },
  {
    name: 'scheduler-callback-replayed-body',
    eventId: 'evt_forgery_0002',
    payloadUtf8: '{"kind":"schedule_tick","at":"2026-01-01T00:00:00Z"}',
    signatureOverDifferentBytes: sha256Hex('{}'),
    foreignSecretSignature: sha256Hex('{"kind":"schedule_tick"}'),
  },
];
