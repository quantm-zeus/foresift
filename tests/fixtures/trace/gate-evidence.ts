/**
 * Gate evidence fixtures and HMAC signing helpers for FR-TRACE-004 / AC-268 testing.
 */
import { createHmac, createHash } from 'node:crypto';

export const TEST_GATE_PEPPER = 'trace-pepper-fixed-0123456789abcdef0123456789abcdef';
export const ALT_GATE_PEPPER = 'alt-pepper-mismatch-fedcba9876543210fedcba9876543210';

export const GATE_KINDS = ['MANUAL', 'LEGAL', 'RIGHTS', 'STATISTICAL', 'OWNER_APPROVAL'] as const;

export type GateKind = (typeof GATE_KINDS)[number];

export interface GateEvidencePayload {
  readonly gateKind: GateKind;
  readonly approver: string;
  readonly scopeRefs: readonly string[];
  readonly subject: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly reason?: string;
  readonly revocationRef?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface GateEvidenceRecord {
  readonly evidenceId: string;
  readonly payload: GateEvidencePayload;
  readonly payloadSha256: string;
  readonly signature: string;
  readonly gateKind: GateKind;
  readonly scopeRefs: readonly string[];
  readonly approver: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string | null;
  readonly recordedAt: string;
}

/**
 * Deterministic canonical JSON stringifier (sorted object keys).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]),
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute SHA256 of canonical JSON payload.
 */
export function computePayloadSha256(payload: GateEvidencePayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * Compute HMAC-SHA256 signature using injected pepper.
 */
export function computeEvidenceSignature(
  payload: GateEvidencePayload,
  pepper: string = TEST_GATE_PEPPER,
): string {
  return createHmac('sha256', pepper).update(canonicalJson(payload)).digest('hex');
}

/**
 * Creates a valid, complete GateEvidenceRecord from a payload.
 */
export function createSignedGateEvidence(
  payload: GateEvidencePayload,
  pepper: string = TEST_GATE_PEPPER,
  overrides?: Partial<GateEvidenceRecord>,
): GateEvidenceRecord {
  const payloadSha256 = computePayloadSha256(payload);
  const signature = computeEvidenceSignature(payload, pepper);
  const evidenceId = `ev-${payloadSha256.slice(0, 16)}`;
  return {
    evidenceId,
    payload,
    payloadSha256,
    signature,
    gateKind: payload.gateKind,
    scopeRefs: payload.scopeRefs,
    approver: payload.approver,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    revokedAt: payload.revocationRef ? payload.issuedAt : null,
    recordedAt: payload.issuedAt,
    ...overrides,
  };
}

export const VALID_GATE_PAYLOADS: Record<GateKind, GateEvidencePayload> = {
  MANUAL: {
    gateKind: 'MANUAL',
    approver: 'release-lead@foresift.io',
    scopeRefs: ['dependency-group:G0', 'release:v6.0.0'],
    subject: 'G0 milestone manual readiness signoff',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-12-31T23:59:59.999Z',
    reason: 'Manual gate verified per Section 40 checklist',
  },
  LEGAL: {
    gateKind: 'LEGAL',
    approver: 'legal-counsel@foresift.io',
    scopeRefs: ['compliance:eu-ai-act', 'disclaimers:v6.0'],
    subject: 'EU regulatory and legal compliance gate approval',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-12-31T23:59:59.999Z',
    reason: 'Legal review passed with standard disclaimer language',
  },
  RIGHTS: {
    gateKind: 'RIGHTS',
    approver: 'data-rights@foresift.io',
    scopeRefs: ['provider:solana-rpc', 'provider:pump-portal', 'dataset:discovery'],
    subject: 'Data redistribution and terms of service approval',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-12-31T23:59:59.999Z',
    reason: 'Provider terms permit caching and non-commercial derivation',
  },
  STATISTICAL: {
    gateKind: 'STATISTICAL',
    approver: 'quant-lead@foresift.io',
    scopeRefs: ['eval:champion-challenger', 'metric:precision-recall'],
    subject: 'Signal precision calibration threshold review',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-12-31T23:59:59.999Z',
    reason: 'Statistical calibration passed on 5000 golden fixtures',
  },
  OWNER_APPROVAL: {
    gateKind: 'OWNER_APPROVAL',
    approver: 'product-owner@foresift.io',
    scopeRefs: ['package:requirement-manifest', 'package:release-conformance'],
    subject: 'Owner approval for production activation',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-12-31T23:59:59.999Z',
    reason: 'All acceptance criteria validated and proven',
  },
};

export const VALID_GATE_RECORDS: Record<GateKind, GateEvidenceRecord> = {
  MANUAL: createSignedGateEvidence(VALID_GATE_PAYLOADS.MANUAL),
  LEGAL: createSignedGateEvidence(VALID_GATE_PAYLOADS.LEGAL),
  RIGHTS: createSignedGateEvidence(VALID_GATE_PAYLOADS.RIGHTS),
  STATISTICAL: createSignedGateEvidence(VALID_GATE_PAYLOADS.STATISTICAL),
  OWNER_APPROVAL: createSignedGateEvidence(VALID_GATE_PAYLOADS.OWNER_APPROVAL),
};
