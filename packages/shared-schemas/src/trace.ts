/** Declarative trace telemetry contracts for FR-TRACE-001…006. */
import { z } from 'zod';

export const TRACE_SCHEMA_REGISTRY_VERSION = 1;
export const TraceGateKindSchema = z.enum([
  'MANUAL',
  'LEGAL',
  'RIGHTS',
  'STATISTICAL',
  'OWNER_APPROVAL',
]);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const ManifestIntegrityCheckedEventSchema = z
  .object({
    manifestSha256: Sha256Schema,
    documentSha256: Sha256Schema,
    normalizedDocumentSha256: Sha256Schema,
    verdict: z.enum(['PASS', 'FAIL']),
    checkedAt: TimestampSchema,
  })
  .strict();

export const IdSupersededEventSchema = z
  .object({
    replacedId: z.string().min(1),
    supersededById: z.string().min(1),
    namespace: z.string().min(1),
    reason: z.string().min(1),
    recordedAt: TimestampSchema,
  })
  .strict();

export const ConformanceFindingEventSchema = z
  .object({
    requirementId: z.string().min(1),
    rule: z.string().min(1),
    path: z.string().min(1),
    message: z.string().min(1),
    conformanceReleaseId: z.string().min(1),
    foundAt: TimestampSchema,
  })
  .strict();

export const GateEvidenceRecordedEventSchema = z
  .object({
    evidenceId: z.string().min(1),
    gateKind: TraceGateKindSchema,
    approver: z.string().min(1),
    scopeRefs: z.array(z.string().min(1)).min(1),
    expiresAt: TimestampSchema,
    payloadSha256: Sha256Schema,
    signature: z.string().min(1),
    recordedAt: TimestampSchema,
  })
  .strict();

export const GateEvidenceRefusedEventSchema = z
  .object({
    evidenceId: z.string().min(1),
    gateKind: TraceGateKindSchema,
    requiredScope: z.string().min(1),
    reason: z.string().min(1),
    refusedAt: TimestampSchema,
  })
  .strict();

export const DecisionTraceRecordedEventSchema = z
  .object({
    traceId: z.string().min(1),
    decisionRef: z.string().min(1),
    manifestSha256: Sha256Schema,
    releaseReportId: z.string().min(1),
    recordedAt: TimestampSchema,
  })
  .strict();

export const ReleaseReportEmittedEventSchema = z
  .object({
    reportId: z.string().min(1),
    documentSha256: Sha256Schema,
    manifestSha256: Sha256Schema,
    dependencySbomSha256: Sha256Schema,
    conformanceOverall: z.enum(['PASSED', 'FAILED']),
    activationStatus: z.enum(['ACTIVE', 'BLOCKED', 'PENDING']),
    rollbackReportId: z.string().min(1),
    emittedAt: TimestampSchema,
  })
  .strict();

export const TRACE_TELEMETRY_SCHEMAS = {
  'manifest.integrity_checked': ManifestIntegrityCheckedEventSchema,
  'ids.superseded': IdSupersededEventSchema,
  'conformance.finding': ConformanceFindingEventSchema,
  'gate.evidence_recorded': GateEvidenceRecordedEventSchema,
  'gate.evidence_refused': GateEvidenceRefusedEventSchema,
  'decision.trace_recorded': DecisionTraceRecordedEventSchema,
  'release.report_emitted': ReleaseReportEmittedEventSchema,
} as const;

/** Stable field inventory used by catalog-parity checks without inspecting Zod internals. */
export const TRACE_TELEMETRY_EVENT_FIELDS = {
  'manifest.integrity_checked': [
    'manifestSha256',
    'documentSha256',
    'normalizedDocumentSha256',
    'verdict',
    'checkedAt',
  ],
  'ids.superseded': ['replacedId', 'supersededById', 'namespace', 'reason', 'recordedAt'],
  'conformance.finding': [
    'requirementId',
    'rule',
    'path',
    'message',
    'conformanceReleaseId',
    'foundAt',
  ],
  'gate.evidence_recorded': [
    'evidenceId',
    'gateKind',
    'approver',
    'scopeRefs',
    'expiresAt',
    'payloadSha256',
    'signature',
    'recordedAt',
  ],
  'gate.evidence_refused': ['evidenceId', 'gateKind', 'requiredScope', 'reason', 'refusedAt'],
  'decision.trace_recorded': [
    'traceId',
    'decisionRef',
    'manifestSha256',
    'releaseReportId',
    'recordedAt',
  ],
  'release.report_emitted': [
    'reportId',
    'documentSha256',
    'manifestSha256',
    'dependencySbomSha256',
    'conformanceOverall',
    'activationStatus',
    'rollbackReportId',
    'emittedAt',
  ],
} as const;
