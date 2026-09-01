/** @requirement FR-TRACE-004 @acceptance AC-268 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function hash(payload: any) { return createHash('sha256').update(canonical(payload)).digest('hex'); }
function sign(payload: any, pepper: string) { return createHmac('sha256', pepper).update(canonical(payload)).digest('hex'); }
function assertRecord(record: any) {
  if (typeof record === 'boolean') throw new TypeError('cannot evaluate boolean; invalid evidence record');
  if (!record || typeof record !== 'object' || !record.payload || !record.payloadSha256 || !record.signature) {
    throw new TypeError('invalid evidence record: missing required fields');
  }
}
export function createGateEvidence(payload: any, pepper: string, overrides: any = {}) {
  const payloadSha256 = hash(payload);
  return {
    evidenceId: `ev-${payloadSha256.slice(0, 16)}`, payload, payloadSha256,
    signature: sign(payload, pepper), gateKind: payload.gateKind, scopeRefs: payload.scopeRefs,
    approver: payload.approver, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt,
    revokedAt: null, recordedAt: payload.issuedAt, ...overrides,
  };
}
export function verifyPayloadHash(record: any): boolean {
  assertRecord(record); return hash(record.payload) === record.payloadSha256;
}
export function verifyEvidenceSignature(record: any, pepper: string): boolean {
  assertRecord(record);
  const expected = Buffer.from(sign(record.payload, pepper));
  const actual = Buffer.from(String(record.signature));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function evaluateGateEvidence(options: any) {
  assertRecord(options.record);
  const record = options.record;
  const base = { gateKind: record.gateKind, approver: record.approver };
  if (!verifyPayloadHash(record)) return { ...base, isValid: false, reason: 'HASH_MISMATCH: payload altered' };
  if (!verifyEvidenceSignature(record, options.pepper)) return { ...base, isValid: false, reason: 'SIGNATURE_INVALID: signature mismatch' };
  if (record.revokedAt || record.payload.revocationRef) return { ...base, isValid: false, reason: 'EVIDENCE_REVOKED' };
  const now = new Date(options.currentTime ?? new Date()).getTime();
  if (now > new Date(record.expiresAt).getTime()) return { ...base, isValid: false, reason: 'EVIDENCE_EXPIRED' };
  if (!(record.scopeRefs ?? []).includes(options.requiredScope)) return { ...base, isValid: false, reason: 'SCOPE_MISMATCH: scope not covered' };
  return { ...base, isValid: true };
}
