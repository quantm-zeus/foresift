/** Signed/hashed evidence evaluator: booleans can never open a gate. @requirement FR-TRACE-004 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

type Payload = {
  gateKind: 'MANUAL' | 'LEGAL' | 'RIGHTS' | 'STATISTICAL' | 'OWNER_APPROVAL';
  approver: string;
  scopeRefs: readonly string[];
  subject: string;
  issuedAt: string;
  expiresAt: string;
  [key: string]: unknown;
};

type EvidenceRecord = {
  evidenceId: string;
  payload: Payload;
  payloadSha256: string;
  signature: string;
  gateKind: Payload['gateKind'];
  scopeRefs: readonly string[];
  approver: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  recordedAt: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

const payloadHash = (payload: Payload): string =>
  createHash('sha256').update(canonicalJson(payload)).digest('hex');
const signatureFor = (payload: Payload, pepper: string): string =>
  createHmac('sha256', pepper).update(canonicalJson(payload)).digest('hex');

export function createGateEvidence(payload: Payload, pepper: string): EvidenceRecord {
  const payloadSha256 = payloadHash(payload);
  return {
    evidenceId: `ev-${payloadSha256.slice(0, 16)}`,
    payload,
    payloadSha256,
    signature: signatureFor(payload, pepper),
    gateKind: payload.gateKind,
    scopeRefs: payload.scopeRefs,
    approver: payload.approver,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    revokedAt: null,
    recordedAt: payload.issuedAt,
  };
}

export const verifyPayloadHash = (record: EvidenceRecord): boolean =>
  payloadHash(record.payload) === record.payloadSha256;

export function verifyEvidenceSignature(record: EvidenceRecord, pepper: string): boolean {
  const expected = Buffer.from(signatureFor(record.payload, pepper), 'hex');
  const actual = Buffer.from(record.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function evaluateGateEvidence(options: {
  record: EvidenceRecord;
  pepper: string;
  requiredScope: string;
  currentTime?: string;
}) {
  const { record } = options;
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new Error('invalid evidence record; cannot evaluate boolean or primitive');
  for (const field of [
    'evidenceId',
    'payload',
    'payloadSha256',
    'signature',
    'gateKind',
    'scopeRefs',
    'approver',
    'issuedAt',
    'expiresAt',
    'recordedAt',
  ] as const) {
    if (record[field] === undefined)
      throw new Error(`invalid evidence record: missing required fields (${field})`);
  }
  const refusal = (reason: string) => ({
    isValid: false as const,
    reason,
    gateKind: record.gateKind,
    approver: record.approver,
  });
  if (!verifyPayloadHash(record)) return refusal('HASH_MISMATCH: payload altered');
  if (!verifyEvidenceSignature(record, options.pepper)) return refusal('SIGNATURE_INVALID');
  if (record.revokedAt) return refusal('EVIDENCE_REVOKED');
  const now = Date.parse(options.currentTime ?? new Date().toISOString());
  if (!Number.isFinite(now) || now >= Date.parse(record.expiresAt))
    return refusal('EVIDENCE_EXPIRED');
  if (now < Date.parse(record.issuedAt)) return refusal('EVIDENCE_NOT_YET_VALID');
  if (!record.scopeRefs.includes(options.requiredScope)) return refusal('SCOPE_MISMATCH');
  if (
    record.gateKind !== record.payload.gateKind ||
    record.approver !== record.payload.approver ||
    record.issuedAt !== record.payload.issuedAt ||
    record.expiresAt !== record.payload.expiresAt
  )
    return refusal('RECORD_PAYLOAD_MISMATCH');
  return { isValid: true as const, gateKind: record.gateKind, approver: record.approver };
}
