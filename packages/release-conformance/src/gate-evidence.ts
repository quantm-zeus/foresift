import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
import { canonicalJson } from '@foresift/persistence';
import type { GateEvidencePayload, GateEvidenceRecord } from '@foresift/shared-schemas';
import { GateEvidenceRecordSchema } from '@foresift/shared-schemas';
import { ConformanceError, ConformanceErrorCode } from './errors.ts';

const hashPayload = (payload: GateEvidencePayload): string =>
  `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
const signHash = (hash: string, pepper: string | Uint8Array): string =>
  `hmac-sha256:${createHmac('sha256', pepper).update(hash).digest('hex')}`;

export interface CreateGateEvidenceInput extends GateEvidencePayload {
  readonly evidenceId?: string;
  readonly revocationRef?: string | null;
}

export function createGateEvidence(
  input: CreateGateEvidenceInput,
  pepper: string | Uint8Array,
): GateEvidenceRecord {
  const payload: GateEvidencePayload = {
    approver: input.approver,
    gateKind: input.gateKind,
    scopeRefs: [...input.scopeRefs].sort(),
    subject: input.subject,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  const artifactSha256 = hashPayload(payload);
  const record = {
    ...payload,
    evidenceId: input.evidenceId ?? artifactSha256,
    artifactSha256,
    signature: signHash(artifactSha256, pepper),
    revocationRef: input.revocationRef ?? null,
  };
  const parsed = GateEvidenceRecordSchema.safeParse(record);
  if (!parsed.success)
    throw new ConformanceError(ConformanceErrorCode.EVIDENCE_MALFORMED, parsed.error.message);
  return parsed.data;
}

export interface EvaluateGateEvidenceOptions {
  readonly pepper: string | Uint8Array;
  readonly now: () => Date;
  readonly requiredScopeRefs?: readonly string[];
  readonly isRevoked?: (record: GateEvidenceRecord) => boolean | Promise<boolean>;
}

export interface AcceptedGateEvidence {
  readonly accepted: true;
  readonly record: GateEvidenceRecord;
}

export async function evaluateGateEvidence(
  record: GateEvidenceRecord,
  options: EvaluateGateEvidenceOptions,
): Promise<AcceptedGateEvidence> {
  const parsed = GateEvidenceRecordSchema.safeParse(record);
  if (!parsed.success)
    throw new ConformanceError(ConformanceErrorCode.EVIDENCE_MALFORMED, parsed.error.message);
  const payload: GateEvidencePayload = {
    approver: record.approver,
    gateKind: record.gateKind,
    scopeRefs: record.scopeRefs,
    subject: record.subject,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
  const expectedHash = hashPayload(payload);
  if (expectedHash !== record.artifactSha256)
    throw new ConformanceError(
      ConformanceErrorCode.EVIDENCE_HASH_MISMATCH,
      'canonical payload hash differs',
    );
  const expectedSignature = signHash(expectedHash, options.pepper);
  const actual = Buffer.from(record.signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new ConformanceError(
      ConformanceErrorCode.EVIDENCE_SIGNATURE_INVALID,
      'HMAC verification failed',
    );
  if (Date.parse(record.expiresAt) <= options.now().getTime())
    throw new ConformanceError(ConformanceErrorCode.EVIDENCE_EXPIRED, 'evidence has expired', {
      expiresAt: record.expiresAt,
    });
  if (record.revocationRef !== null || (await options.isRevoked?.(record)) === true)
    throw new ConformanceError(ConformanceErrorCode.EVIDENCE_REVOKED, 'evidence is revoked', {
      revocationRef: record.revocationRef,
    });
  const scopes = new Set(record.scopeRefs);
  const missing = (options.requiredScopeRefs ?? []).find((scope) => !scopes.has(scope));
  if (missing !== undefined)
    throw new ConformanceError(
      ConformanceErrorCode.EVIDENCE_SCOPE_INSUFFICIENT,
      `scope ${missing} is not covered`,
      { scope: missing },
    );
  return { accepted: true, record };
}

export async function persistGateEvidence(
  engine: DatabaseEngine,
  record: GateEvidenceRecord,
): Promise<void> {
  await engine.query(
    `INSERT INTO trace.gate_evidence
      (evidence_id, gate_kind, scope_refs, subject, approver, payload, artifact_sha256, signature, issued_at, expires_at, revocation_ref)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,
    [
      record.evidenceId,
      record.gateKind,
      JSON.stringify(record.scopeRefs),
      record.subject,
      record.approver,
      canonicalJson({
        approver: record.approver,
        gateKind: record.gateKind,
        scopeRefs: record.scopeRefs,
        subject: record.subject,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
      }),
      record.artifactSha256,
      record.signature,
      record.issuedAt,
      record.expiresAt,
      record.revocationRef,
    ],
  );
}

export { hashPayload as hashGateEvidencePayload };
