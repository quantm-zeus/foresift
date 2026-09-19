import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

export const TRACE_SCHEMA_REGISTRY_VERSION = 1;
export const TraceSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const TraceHmacSha256Schema = z.string().regex(/^hmac-sha256:[0-9a-f]{64}$/);
export const TraceGateKindSchema = z.enum([
  'MANUAL',
  'LEGAL',
  'RIGHTS',
  'STATISTICAL',
  'OWNER_APPROVAL',
]);

const GateEvidencePayloadObjectSchema = z
  .object({
    approver: z.string().min(1),
    gateKind: TraceGateKindSchema,
    scopeRefs: z.array(z.string().min(1)).min(1),
    subject: z.string().min(1),
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
  })
  .strict();
export const GateEvidencePayloadSchema = GateEvidencePayloadObjectSchema.refine(
  (value) => value.expiresAt > value.issuedAt,
  {
    message: 'expiresAt must follow issuedAt',
  },
);

export const GateEvidenceRecordSchema = GateEvidencePayloadObjectSchema.extend({
  evidenceId: z.string().min(1),
  artifactSha256: TraceSha256Schema,
  signature: TraceHmacSha256Schema,
  revocationRef: z.string().min(1).nullable(),
})
  .strict()
  .refine((value) => value.expiresAt > value.issuedAt, {
    message: 'expiresAt must follow issuedAt',
  });

export const DecisionTraceRecordSchema = z
  .object({
    traceId: TraceSha256Schema,
    decisionRef: z.string().min(1),
    recordedAt: UtcTimestampSchema,
    requirementIds: z.array(z.string().regex(/^FR-[A-Z][A-Z0-9]*-\d{3}$/)).min(1),
    policyVersions: z.record(z.string().min(1)),
    featureVersions: z.record(z.string().min(1)),
    modelVersions: z.record(z.string().min(1)),
    providerVersions: z.record(z.string().min(1)),
    adapterVersions: z.record(z.string().min(1)),
    artifactVersions: z.record(z.string().min(1)),
    toolName: z.string().min(1),
    toolVersion: z.string().min(1),
    manifestSha256: TraceSha256Schema,
    releaseReportId: z.string().min(1),
  })
  .strict();

export type TraceGateKind = z.infer<typeof TraceGateKindSchema>;
export type GateEvidencePayload = z.infer<typeof GateEvidencePayloadSchema>;
export type GateEvidenceRecord = z.infer<typeof GateEvidenceRecordSchema>;
export type DecisionTraceRecord = z.infer<typeof DecisionTraceRecordSchema>;

export const TraceManifestIntegrityCheckedEventSchema = z
  .object({
    manifestSha256: TraceSha256Schema,
    verdict: z.enum(['PASS', 'REFUSED']),
    checkedAt: UtcTimestampSchema,
  })
  .strict();
export const TraceIdsSupersededEventSchema = z
  .object({
    replacedId: z.string().min(1),
    replacementId: z.string().min(1),
    recordedAt: UtcTimestampSchema,
  })
  .strict();
export const TraceConformanceFindingEventSchema = z
  .object({
    requirementId: z.string().min(1),
    rule: z.string().min(1),
    path: z.string().min(1),
    foundAt: UtcTimestampSchema,
  })
  .strict();
export const TraceGateEvidenceRecordedEventSchema = z
  .object({
    evidenceId: z.string().min(1),
    artifactSha256: TraceSha256Schema,
    recordedAt: UtcTimestampSchema,
  })
  .strict();
export const TraceGateEvidenceRefusedEventSchema = z
  .object({
    evidenceId: z.string().min(1),
    reason: z.string().min(1),
    refusedAt: UtcTimestampSchema,
  })
  .strict();
export const TraceDecisionTraceRecordedEventSchema = z
  .object({
    traceId: TraceSha256Schema,
    decisionRef: z.string().min(1),
    recordedAt: UtcTimestampSchema,
  })
  .strict();
export const TraceReleaseReportEmittedEventSchema = z
  .object({
    reportId: z.string().min(1),
    reportSha256: TraceSha256Schema,
    emittedAt: UtcTimestampSchema,
  })
  .strict();
