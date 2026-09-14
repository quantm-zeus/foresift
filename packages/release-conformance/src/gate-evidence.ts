/** Signed, hashed, scoped, expiring, and revocable gate evidence (FR-TRACE-004). */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isOneOf } from '@foresift/domain';
import { canonicalJson, type DatabaseEngine } from '@foresift/persistence';
import { assertNoHostileArrayIndexShadow } from './shadow-safe.ts';

/**
 * The authoritative closed gate-kind vocabulary. The array is `Object.freeze`d
 * so an in-process caller cannot replace its contents at runtime: the
 * fourth-round R4 guard reads this exported set as its mandatory-gate
 * authority, and a mutable export would re-open the fabricated/truncated
 * self-attestation exploit (audit NEW-H1). `as const` alone is compile-time
 * only; the freeze is the runtime defence the guard comments claim.
 */
export const GATE_KINDS = Object.freeze([
  'MANUAL',
  'LEGAL',
  'RIGHTS',
  'STATISTICAL',
  'OWNER_APPROVAL',
] as const);

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

/**
 * Numeric-index copy of a string array (audit NEW-M5). Array spread and
 * `Array.prototype.slice/map` are shadowable in-process, so the indexed
 * `scopeRefs` a record carries must never be produced by an iteration primitive.
 */
function copyStringArray(values: readonly string[]): string[] {
  const copy: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    copy[copy.length] = values[index] as string;
  }
  return copy;
}

/** True iff every entry is a non-empty trimmed string (numeric scan, NEW-M5). */
function hasOnlyNonEmptyStrings(values: readonly unknown[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'string' || value.trim().length === 0) return false;
  }
  return true;
}

function assertPayload(payload: unknown): asserts payload is GateEvidencePayload {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('invalid gate evidence payload');
  }
  const value = payload as Partial<GateEvidencePayload>;
  // `Array.prototype.includes` is shadowable in-process; membership in the
  // frozen authority routes through the shadow-proof `isOneOf` (audit NEW-M4/M5).
  if (!isOneOf(value.gateKind, GATE_KINDS)) {
    throw new TypeError('invalid gate evidence payload: gateKind is required');
  }
  const requiredTextFields = ['approver', 'subject'] as const;
  for (let fieldIndex = 0; fieldIndex < requiredTextFields.length; fieldIndex += 1) {
    const field = requiredTextFields[fieldIndex] as (typeof requiredTextFields)[number];
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      throw new TypeError(`invalid gate evidence payload: ${field} is required`);
    }
  }
  if (
    !Array.isArray(value.scopeRefs) ||
    value.scopeRefs.length === 0 ||
    !hasOnlyNonEmptyStrings(value.scopeRefs)
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
    scopeRefs: copyStringArray(payload.scopeRefs),
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
    !isOneOf(value.gateKind, GATE_KINDS) ||
    !Array.isArray(value.scopeRefs) ||
    value.scopeRefs.length === 0 ||
    !hasOnlyNonEmptyStrings(value.scopeRefs) ||
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

/**
 * Materialize a JSON-ish value into frozen plain data, reading every property
 * exactly once (V7-D1). A `metadata` getter could otherwise return one value to
 * the payload-hash read and another to the HMAC read, splicing a genuine
 * signature onto an attacker payload. A cycle refuses closed.
 */
function snapshotJsonValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('invalid gate evidence metadata: cyclic value');
  // Track the current PATH only (removed in `finally`): a shared node reached
  // through two different keys is legal JSON (a DAG), while a node reached twice
  // on the SAME path is a cycle (V7-A3).
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        copy[copy.length] = snapshotJsonValue(value[index], seen);
      }
      return Object.freeze(copy);
    }
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    // Null prototype: an OWN `__proto__` metadata key must become a normal own
    // property, not mutate the snapshot's prototype and change its hash (V7-A3).
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index] as string;
      copy[key] = snapshotJsonValue(source[key], seen);
    }
    return Object.freeze(copy);
  } finally {
    seen.delete(value);
  }
}

/** Read every payload field exactly ONCE into a frozen plain snapshot. */
function snapshotGateEvidencePayload(payload: GateEvidencePayload): GateEvidencePayload {
  // `copyStringArray` reads scopeRefs by numeric index, never by iteration.
  const scopeRefs = Object.freeze(copyStringArray(payload.scopeRefs));
  const snapshot: Record<string, unknown> = {
    gateKind: payload.gateKind,
    approver: payload.approver,
    scopeRefs,
    subject: payload.subject,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  };
  if (payload.reason !== undefined) snapshot['reason'] = payload.reason;
  if (payload.revocationRef !== undefined) snapshot['revocationRef'] = payload.revocationRef;
  if (payload.metadata !== undefined) {
    snapshot['metadata'] = snapshotJsonValue(payload.metadata, new WeakSet<object>());
  }
  return Object.freeze(snapshot) as unknown as GateEvidencePayload;
}

/**
 * Read every field of a record exactly ONCE into a frozen plain snapshot
 * (V7-D1/D2). `evaluateGateEvidence` verifies this snapshot and
 * `verifyGateEvidence` brands it, so an accessor-property record cannot present
 * one payload to the hash check, another to the HMAC check, and a third to the
 * record-match check — nor a different scope/expiry to the caller than the one
 * that was actually signed.
 */
export function snapshotGateEvidenceRecord(record: GateEvidenceRecord): GateEvidenceRecord {
  assertNoHostileArrayIndexShadow();
  const payload = snapshotGateEvidencePayload(record.payload);
  // Read each indexed field once, in a fixed order.
  const evidenceId = record.evidenceId;
  const payloadSha256 = record.payloadSha256;
  const signature = record.signature;
  const gateKind = record.gateKind;
  const scopeRefs = Object.freeze(copyStringArray(record.scopeRefs));
  const approver = record.approver;
  const issuedAt = record.issuedAt;
  const expiresAt = record.expiresAt;
  const revokedAt = record.revokedAt;
  const recordedAt = record.recordedAt;
  const snapshot: Record<string, unknown> = {
    evidenceId,
    payload,
    payloadSha256,
    signature,
    gateKind,
    scopeRefs,
    approver,
    issuedAt,
    expiresAt,
    recordedAt,
  };
  if (revokedAt !== undefined) snapshot['revokedAt'] = revokedAt;
  return Object.freeze(snapshot) as unknown as GateEvidenceRecord;
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
  // Snapshot the record ONCE before any authority check (V7-D1). Reading
  // `record.payload` afresh in the hash, HMAC and record-match checks let an
  // accessor property present a different payload to each, splicing a genuine
  // signature onto an attacker payload. Every check below reads this frozen
  // snapshot, so the verified bytes and the branded fields are the same read.
  let record: GateEvidenceRecord;
  try {
    record = snapshotGateEvidenceRecord(options.record);
  } catch {
    return refusal(options.record, 'PAYLOAD_RECORD_MISMATCH');
  }
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
  // `Array.prototype.includes` is shadowable in-process; a shadowed `true`
  // would accept a record whose scope does not cover the required release,
  // turning SCOPE_MISMATCH into a PASS (audit NEW-M5).
  if (!isOneOf(options.requiredScope, record.scopeRefs)) return refusal(record, 'SCOPE_MISMATCH');
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
  // Persist the single-read snapshot, never the caller's live object (V7-D1):
  // an accessor could otherwise change fields between the hash check and the
  // INSERT.
  const snapshot = snapshotGateEvidenceRecord(record);
  if (!verifyPayloadHash(snapshot)) {
    throw new TypeError('cannot persist gate evidence: payload hash mismatch');
  }
  if (!payloadRecordMatches(snapshot)) {
    throw new TypeError('cannot persist gate evidence: payload and indexed fields mismatch');
  }
  await engine.query(
    `INSERT INTO trace.gate_evidence
       (evidence_id, payload, payload_sha256, signature, gate_kind, approver,
        issued_at, expires_at, revoked_at, recorded_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz,
             $9::timestamptz, $10::timestamptz)`,
    [
      snapshot.evidenceId,
      canonicalJson(snapshot.payload),
      snapshot.payloadSha256,
      snapshot.signature,
      snapshot.gateKind,
      snapshot.approver,
      snapshot.issuedAt,
      snapshot.expiresAt,
      snapshot.revokedAt ?? null,
      snapshot.recordedAt,
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
