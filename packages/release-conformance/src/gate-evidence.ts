import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import {
  TRACE_GATE_KINDS,
  type TraceGateEvidencePayload as GateEvidencePayload,
  type TraceGateEvidenceRecord as GateEvidenceRecord,
} from '@foresift/shared-schemas';
export type { GateEvidencePayload, GateEvidenceRecord };

const sha = (payload: GateEvidencePayload) =>
  createHash('sha256').update(canonicalJson(payload)).digest('hex');
const hmac = (payload: GateEvidencePayload, pepper: string) =>
  createHmac('sha256', pepper).update(canonicalJson(payload)).digest('hex');
const equalHex = (a: string, b: string) =>
  /^[0-9a-f]{64}$/.test(a) &&
  /^[0-9a-f]{64}$/.test(b) &&
  timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export function createGateEvidence(
  payload: GateEvidencePayload,
  pepper: string,
  overrides: Partial<GateEvidenceRecord> = {},
): GateEvidenceRecord {
  if (!pepper) throw new TypeError('server-side evidence pepper is required');
  const payloadSha256 = sha(payload);
  return {
    evidenceId: `ev-${payloadSha256.slice(0, 16)}`,
    payload,
    payloadSha256,
    signature: hmac(payload, pepper),
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
function assertRecord(record: unknown): asserts record is GateEvidenceRecord {
  if (typeof record === 'boolean')
    throw new TypeError('invalid evidence record: cannot evaluate boolean');
  if (!record || typeof record !== 'object') throw new TypeError('invalid evidence record');
  const r = record as Record<string, unknown>;
  for (const key of [
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
  ])
    if (r[key] === undefined)
      throw new TypeError(`invalid evidence record: missing required fields (${key})`);
}
export const verifyPayloadHash = (record: GateEvidenceRecord) =>
  equalHex(record.payloadSha256, sha(record.payload));
export const verifyEvidenceSignature = (record: GateEvidenceRecord, pepper: string) =>
  equalHex(record.signature, hmac(record.payload, pepper));
export function evaluateGateEvidence(input: {
  record: GateEvidenceRecord;
  pepper: string;
  requiredScope: string;
  currentTime?: string;
}) {
  assertRecord(input.record);
  const { record } = input;
  if (!TRACE_GATE_KINDS.includes(record.gateKind))
    return { isValid: false as const, reason: 'GATE_KIND_INVALID' };
  if (!verifyPayloadHash(record)) return { isValid: false as const, reason: 'HASH_MISMATCH' };
  if (!verifyEvidenceSignature(record, input.pepper))
    return { isValid: false as const, reason: 'SIGNATURE_INVALID' };
  if (record.revokedAt || record.payload.revocationRef)
    return { isValid: false as const, reason: 'EVIDENCE_REVOKED' };
  const now = Date.parse(input.currentTime ?? new Date().toISOString());
  if (!Number.isFinite(now) || now >= Date.parse(record.expiresAt))
    return { isValid: false as const, reason: 'EVIDENCE_EXPIRED' };
  if (now < Date.parse(record.issuedAt))
    return { isValid: false as const, reason: 'EVIDENCE_NOT_YET_VALID' };
  if (!record.scopeRefs.includes(input.requiredScope))
    return { isValid: false as const, reason: 'SCOPE_MISMATCH' };
  return {
    isValid: true as const,
    gateKind: record.gateKind,
    approver: record.approver,
    evidenceId: record.evidenceId,
  };
}
export async function recordGateEvidence(engine: DatabaseEngine, record: GateEvidenceRecord) {
  assertRecord(record);
  await engine.query(
    `INSERT INTO trace.gate_evidence (evidence_id,payload,payload_sha256,signature,gate_kind,scope_refs,approver,issued_at,expires_at,revocation_ref,revoked_at,recorded_at) VALUES ($1,$2::jsonb,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
    [
      record.evidenceId,
      JSON.stringify(record.payload),
      record.payloadSha256,
      record.signature,
      record.gateKind,
      JSON.stringify(record.scopeRefs),
      record.approver,
      record.issuedAt,
      record.expiresAt,
      record.payload.revocationRef ?? null,
      record.revokedAt ?? null,
      record.recordedAt,
    ],
  );
}
