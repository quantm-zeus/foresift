/**
 * Inert forbidden corpus — malicious-response CLASS SAMPLES (T125, FR-PROV-008).
 *
 * Each entry is an INERT skeleton of exactly one malicious-response class:
 * the hazardous FIELD NAMES / shape markers that trip the scanner, paired
 * with constant dummy values ('REDACTED', 'AAAA…'). No executable content,
 * no real key material, no imports — declarative data only. These are the
 * negative controls for AC-271; the positive controls are clean-responses.ts.
 */

export interface ForbiddenSample {
  /** The single malicious-response class this sample represents. */
  readonly detectedClass:
    | 'TRANSACTION_PAYLOAD'
    | 'SIGNING_REQUEST'
    | 'EXECUTABLE_INSTRUCTION'
    | 'PRIVATE_KEY_FIELD'
    | 'UNEXPECTED_WRITE_CAPABILITY';
  readonly label: string;
  readonly bodyText: string;
}

export const PRIVATE_KEY_FIELD_SAMPLE: ForbiddenSample = {
  detectedClass: 'PRIVATE_KEY_FIELD',
  label: 'fake private-key marker (constant dummy value — NOT key material)',
  bodyText: JSON.stringify({
    wallet: { private_key: 'REDACTED-NOT-A-REAL-KEY' },
  }),
};

export const TRANSACTION_PAYLOAD_SKELETON: ForbiddenSample = {
  detectedClass: 'TRANSACTION_PAYLOAD',
  label: 'transaction-payload skeleton',
  bodyText: JSON.stringify({
    quote: { serializedTransaction: 'AAAA', lastValidBlockHeight: 1 },
  }),
};

export const SIGNING_REQUEST_SKELETON: ForbiddenSample = {
  detectedClass: 'SIGNING_REQUEST',
  label: 'signing-request skeleton (RPC method invitation)',
  bodyText: JSON.stringify({
    instructions: [{ method: 'personal_sign', params: ['REDACTED'] }],
  }),
};

export const EXECUTABLE_INSTRUCTION_SAMPLE: ForbiddenSample = {
  detectedClass: 'EXECUTABLE_INSTRUCTION',
  label: 'executable-instruction sample (shebang marker)',
  bodyText: JSON.stringify({
    note: '#!/bin/sh echo REDACTED',
  }),
};

export const WRITE_CAPABILITY_INDICATOR: ForbiddenSample = {
  detectedClass: 'UNEXPECTED_WRITE_CAPABILITY',
  label: 'write-capability indicator (submit endpoint invitation)',
  bodyText: JSON.stringify({
    followup: { submit_endpoint: 'https://example.invalid/tx' },
  }),
};

/** All five classes — the AC-271 negative sweep iterates these. */
export const ALL_FORBIDDEN_SAMPLES: readonly ForbiddenSample[] = [
  PRIVATE_KEY_FIELD_SAMPLE,
  TRANSACTION_PAYLOAD_SKELETON,
  SIGNING_REQUEST_SKELETON,
  EXECUTABLE_INSTRUCTION_SAMPLE,
  WRITE_CAPABILITY_INDICATOR,
];
