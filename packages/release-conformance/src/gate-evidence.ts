/** Signed, hashed, scoped, expiring, and revocable gate evidence (FR-TRACE-004). */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';

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
  readonly metadata?: Readonly<Record<string, unknown>>;
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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function computeGatePayloadHash(payload: GateEvidencePayload): string {
  return sha256Hex(canonicalJson(payload));
}

export function computeGateEvidenceSignature(payload: GateEvidencePayload, pepper: string): string {
  if (typeof pepper !== 'string' || pepper.length === 0) {
    throw new TypeError('gate evidence pepper must be a non-empty server-side secret');
  }
  return createHmac('sha256', pepper).update(canonicalJson(payload), 'utf8').digest('hex');
}

function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function assertPayload(payload: unknown): asserts payload is GateEvidencePayload {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('invalid gate evidence payload');
  }
  const value = payload as Partial<GateEvidencePayload>;
  if (!GATE_KINDS.includes(value.gateKind as GateKind)) {
    throw new TypeError('invalid gate evidence payload: gateKind is required');
  }
  for (const field of ['approver', 'subject'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new TypeError(`invalid gate evidence payload: ${field} is required`);
    }
  }
  if (
    !Array.isArray(value.scopeRefs) ||
    value.scopeRefs.length === 0 ||
    value.scopeRefs.some((scope) => typeof scope !== 'string' || scope.trim().length === 0)
  ) {
    throw new TypeError('invalid gate evidence payload: non-empty scopeRefs are required');
  }
  if (!isIsoInstant(value.issuedAt) || !isIsoInstant(value.expiresAt)) {
    throw new TypeError('invalid gate evidence payload: issuedAt and expiresAt are required');
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    throw new TypeError('invalid gate evidence payload: expiresAt must follow issuedAt');
  }
  if (
    value.reason !== undefined &&
    (typeof value.reason !== 'string' || value.reason.trim().length === 0)
  ) {
    throw new TypeError('invalid gate evidence payload: reason must be non-empty when supplied');
  }
  if (
    value.revocationRef !== undefined &&
    value.revocationRef !== null &&
    (typeof value.revocationRef !== 'string' || value.revocationRef.trim().length === 0)
  ) {
    throw new TypeError(
      'invalid gate evidence payload: revocationRef must be non-empty when supplied',
    );
  }
  if (
    value.metadata !== undefined &&
    (value.metadata === null || typeof value.metadata !== 'object' || Array.isArray(value.metadata))
  ) {
    throw new TypeError('invalid gate evidence payload: metadata must be an object when supplied');
  }
}

export interface CreateGateEvidenceOptions {
  readonly recordedAt?: string;
  readonly revokedAt?: string | null;
}

export function createGateEvidence(
  payload: GateEvidencePayload,
  pepper: string,
  options: CreateGateEvidenceOptions = {},
): GateEvidenceRecord {
  assertPayload(payload);
  const payloadSha256 = computeGatePayloadHash(payload);
  const recordedAt = options.recordedAt ?? payload.issuedAt;
  if (!isIsoInstant(recordedAt)) throw new TypeError('recordedAt must be an ISO UTC instant');
  if (
    options.revokedAt !== undefined &&
    options.revokedAt !== null &&
    !isIsoInstant(options.revokedAt)
  ) {
    throw new TypeError('revokedAt must be null or an ISO UTC instant');
  }
  return {
    evidenceId: `ev-${payloadSha256.slice(0, 16)}`,
    payload,
    payloadSha256,
    signature: computeGateEvidenceSignature(payload, pepper),
    gateKind: payload.gateKind,
    scopeRefs: [...payload.scopeRefs],
    approver: payload.approver,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    revokedAt: options.revokedAt ?? null,
    recordedAt,
  };
}

function isHexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function safeDigestEqual(actual: string, expected: string): boolean {
  if (!isHexDigest(actual) || !isHexDigest(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function verifyPayloadHash(record: GateEvidenceRecord): boolean {
  try {
    return safeDigestEqual(record.payloadSha256, computeGatePayloadHash(record.payload));
  } catch {
    return false;
  }
}

export function verifyEvidenceSignature(record: GateEvidenceRecord, pepper: string): boolean {
  try {
    return safeDigestEqual(record.signature, computeGateEvidenceSignature(record.payload, pepper));
  } catch {
    return false;
  }
}

function assertEvidenceRecord(record: unknown): asserts record is GateEvidenceRecord {
  if (typeof record === 'boolean') {
    throw new TypeError('cannot evaluate boolean: invalid evidence record');
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('invalid evidence record');
  }
  const value = record as Partial<GateEvidenceRecord>;
  try {
    assertPayload(value.payload);
  } catch (cause) {
    throw new TypeError('invalid evidence record: missing required fields', { cause });
  }
  if (
    typeof value.evidenceId !== 'string' ||
    value.evidenceId.trim().length === 0 ||
    !isHexDigest(value.payloadSha256) ||
    !isHexDigest(value.signature) ||
    !GATE_KINDS.includes(value.gateKind as GateKind) ||
    !Array.isArray(value.scopeRefs) ||
    value.scopeRefs.length === 0 ||
    value.scopeRefs.some((scope) => typeof scope !== 'string' || scope.trim().length === 0) ||
    typeof value.approver !== 'string' ||
    value.approver.trim().length === 0 ||
    !isIsoInstant(value.issuedAt) ||
    !isIsoInstant(value.expiresAt) ||
    !isIsoInstant(value.recordedAt) ||
    (value.revokedAt !== undefined && value.revokedAt !== null && !isIsoInstant(value.revokedAt))
  ) {
    throw new TypeError('invalid evidence record: missing required fields');
  }
}

function payloadRecordMatches(record: GateEvidenceRecord): boolean {
  return (
    record.gateKind === record.payload.gateKind &&
    record.approver === record.payload.approver &&
    record.issuedAt === record.payload.issuedAt &&
    record.expiresAt === record.payload.expiresAt &&
    canonicalJson(record.scopeRefs) === canonicalJson(record.payload.scopeRefs)
  );
}

export type GateEvidenceFailureReason =
  | 'HASH_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'EVIDENCE_REVOKED'
  | 'EVIDENCE_NOT_YET_VALID'
  | 'EVIDENCE_EXPIRED'
  | 'SCOPE_MISMATCH'
  | 'PAYLOAD_RECORD_MISMATCH';

export type GateEvidenceEvaluation =
  | {
      readonly isValid: true;
      readonly gateKind: string;
      readonly approver: string;
      readonly evidenceId: string;
      readonly reason?: undefined;
    }
  | {
      readonly isValid: false;
      readonly reason: GateEvidenceFailureReason;
      readonly gateKind?: string;
      readonly approver?: string;
      readonly evidenceId?: string;
    };

export interface EvaluateGateEvidenceOptions {
  readonly record: GateEvidenceRecord;
  readonly pepper: string;
  readonly requiredScope: string;
  readonly currentTime?: string | Date;
  readonly clock?: () => string | Date;
}

function refusal(
  record: GateEvidenceRecord,
  reason: GateEvidenceFailureReason,
): GateEvidenceEvaluation {
  return {
    isValid: false,
    reason,
    gateKind: record.gateKind,
    approver: record.approver,
    evidenceId: record.evidenceId,
  };
}

export function evaluateGateEvidence(options: EvaluateGateEvidenceOptions): GateEvidenceEvaluation {
  assertEvidenceRecord(options.record);
  const { record } = options;
  if (!verifyPayloadHash(record)) return refusal(record, 'HASH_MISMATCH');
  if (!verifyEvidenceSignature(record, options.pepper)) return refusal(record, 'SIGNATURE_INVALID');
  if (!payloadRecordMatches(record)) {
    return refusal(record, 'PAYLOAD_RECORD_MISMATCH');
  }
  if (record.revokedAt !== undefined && record.revokedAt !== null) {
    return refusal(record, 'EVIDENCE_REVOKED');
  }
  const clockValue = options.currentTime ?? options.clock?.();
  if (clockValue === undefined) {
    throw new TypeError('evaluateGateEvidence requires an injected currentTime or clock');
  }
  const now = clockValue instanceof Date ? clockValue.getTime() : Date.parse(clockValue);
  if (Number.isNaN(now))
    throw new TypeError('injected gate evidence clock returned an invalid time');
  if (now < Date.parse(record.issuedAt)) return refusal(record, 'EVIDENCE_NOT_YET_VALID');
  if (now >= Date.parse(record.expiresAt)) return refusal(record, 'EVIDENCE_EXPIRED');
  if (!record.scopeRefs.includes(options.requiredScope)) return refusal(record, 'SCOPE_MISMATCH');
  return {
    isValid: true,
    gateKind: record.gateKind,
    approver: record.approver,
    evidenceId: record.evidenceId,
  };
}

export async function recordGateEvidence(
  engine: DatabaseEngine,
  record: GateEvidenceRecord,
): Promise<void> {
  assertEvidenceRecord(record);
  if (!verifyPayloadHash(record)) {
    throw new TypeError('cannot persist gate evidence: payload hash mismatch');
  }
  if (!payloadRecordMatches(record)) {
    throw new TypeError('cannot persist gate evidence: payload and indexed fields mismatch');
  }
  await engine.query(
    `INSERT INTO trace.gate_evidence
       (evidence_id, payload, payload_sha256, signature, gate_kind, approver,
        issued_at, expires_at, revoked_at, recorded_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz,
             $9::timestamptz, $10::timestamptz)`,
    [
      record.evidenceId,
      canonicalJson(record.payload),
      record.payloadSha256,
      record.signature,
      record.gateKind,
      record.approver,
      record.issuedAt,
      record.expiresAt,
      record.revokedAt ?? null,
      record.recordedAt,
    ],
  );
}

interface GateEvidenceRow {
  readonly evidence_id: string;
  readonly payload: GateEvidencePayload | string;
  readonly payload_sha256: string;
  readonly signature: string;
  readonly gate_kind: GateKind;
  readonly approver: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly recorded_at: string;
}

export async function fetchGateEvidenceById(
  engine: DatabaseEngine,
  evidenceId: string,
): Promise<GateEvidenceRecord | undefined> {
  const result = await engine.query<GateEvidenceRow>(
    `SELECT evidence_id, payload, payload_sha256, signature, gate_kind, approver,
            issued_at, expires_at, revoked_at, recorded_at
       FROM trace.gate_evidence WHERE evidence_id = $1`,
    [evidenceId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  const payload =
    typeof row.payload === 'string'
      ? (JSON.parse(row.payload) as GateEvidencePayload)
      : row.payload;
  return {
    evidenceId: row.evidence_id,
    payload,
    payloadSha256: row.payload_sha256,
    signature: row.signature,
    gateKind: row.gate_kind,
    scopeRefs: payload.scopeRefs,
    approver: row.approver,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    recordedAt: row.recorded_at,
  };
}
