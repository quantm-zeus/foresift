/** Versioned traceability contracts. @requirement FR-TRACE-001 FR-TRACE-002 FR-TRACE-004 FR-TRACE-005 FR-TRACE-006 */
import { z } from 'zod';

export const TRACE_SCHEMA_REGISTRY_VERSION = 1;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const PrefixedSha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const RequirementRefSchema = z.string().regex(
  /^(?:FR-[A-Z][A-Z0-9]*-\d{3}|AC-\d{3}|INV-\d{3}|ADR-\d{3,4})$/,
);
export const TraceIdPatternSchema = z.string().trim().min(1);

export const SupersessionLinkSchema = z.object({
  replacedId: z.string().min(1),
  supersededById: z.string().min(1),
  namespace: z.enum(['requirement', 'acceptance', 'invariant', 'adr', 'feature', 'schema', 'api', 'tool', 'policy', 'artifact', 'test']),
  recordedAt: TimestampSchema,
  reason: z.string().trim().min(1),
}).strict();

export const GateKindSchema = z.enum(['MANUAL', 'LEGAL', 'RIGHTS', 'STATISTICAL', 'OWNER_APPROVAL']);
export const GateEvidencePayloadSchema = z.object({
  gateKind: GateKindSchema,
  approver: z.string().min(1),
  scopeRefs: z.array(z.string().min(1)).min(1),
  subject: z.string().min(1),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  reason: z.string().min(1).optional(),
  revocationRef: z.string().min(1).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const GateEvidenceRecordSchema = z.object({
  evidenceId: z.string().min(1),
  payload: GateEvidencePayloadSchema,
  payloadSha256: Sha256Schema,
  signature: Sha256Schema,
  gateKind: GateKindSchema,
  scopeRefs: z.array(z.string().min(1)).min(1),
  approver: z.string().min(1),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  revokedAt: TimestampSchema.nullable().optional(),
  recordedAt: TimestampSchema,
}).strict();

const VersionMapSchema = z.record(z.string().min(1), z.string().min(1));
export const DecisionTraceRecordSchema = z.object({
  traceId: z.string().min(1),
  decisionRef: z.string().min(1),
  requirementIds: z.array(RequirementRefSchema).min(1),
  policyVersions: VersionMapSchema,
  featureVersions: VersionMapSchema,
  modelVersions: VersionMapSchema,
  toolVersions: VersionMapSchema,
  providerVersions: VersionMapSchema,
  adapterVersions: VersionMapSchema,
  artifactVersions: VersionMapSchema,
  testReleaseId: z.string().min(1),
  conformanceReleaseId: z.string().min(1),
  manifestSha256: Sha256Schema,
  releaseReportId: z.string().min(1),
  recordedAt: TimestampSchema,
}).strict();

const FindingSchema = z.object({
  requirementId: z.string().min(1), rule: z.string().min(1), path: z.string(), message: z.string().min(1),
}).strict();
export const ReleaseReportRecordSchema = z.object({
  reportId: z.string().min(1),
  documentHash: Sha256Schema,
  manifestHash: Sha256Schema,
  normalizedHash: Sha256Schema,
  migrationHashes: z.record(z.string(), PrefixedSha256Schema),
  schemaHashes: z.record(z.string(), PrefixedSha256Schema),
  dependencySbomHash: Sha256Schema,
  conformanceResults: z.object({
    overall: z.enum(['PASSED', 'FAILED']),
    totalRulesEvaluated: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    findings: z.array(FindingSchema),
  }).strict(),
  unresolvedDeviations: z.array(z.object({
    id: z.string().min(1), rule: z.string().min(1), path: z.string(), justification: z.string().min(1),
    expiryDate: z.string().optional(),
  }).strict()),
  activationState: z.object({
    milestone: z.string().min(1), status: z.enum(['ACTIVE', 'BLOCKED', 'PENDING']),
    activeGroups: z.array(z.string()), gatesPassed: z.array(z.string()),
  }).strict(),
  rollbackTarget: z.object({
    previousReportId: z.string().min(1), previousDocumentHash: Sha256Schema, previousManifestHash: Sha256Schema,
  }).strict(),
  generatedAt: TimestampSchema,
}).strict();

export const TRACE_SCHEMAS = {
  RequirementRef: RequirementRefSchema,
  TraceIdPattern: TraceIdPatternSchema,
  SupersessionLink: SupersessionLinkSchema,
  GateEvidenceRecord: GateEvidenceRecordSchema,
  DecisionTraceRecord: DecisionTraceRecordSchema,
  ReleaseReportRecord: ReleaseReportRecordSchema,
} as const;
export type TraceSchemaName = keyof typeof TRACE_SCHEMAS;
export function parseTraceSchema<Name extends TraceSchemaName>(name: Name, input: unknown): z.infer<(typeof TRACE_SCHEMAS)[Name]> {
  return TRACE_SCHEMAS[name].parse(input) as z.infer<(typeof TRACE_SCHEMAS)[Name]>;
}

/** Field inventory consumed by telemetry-catalog parity checks. */
export const TRACE_TELEMETRY_FIELDS = {
  'manifest.integrity_checked': ['manifestSha256', 'documentSha256', 'normalizedSha256', 'verdict', 'findingCount'],
  'ids.superseded': ['replacedId', 'supersededById', 'namespace', 'recordedAt', 'reason'],
  'conformance.finding': ['requirementId', 'rule', 'path', 'message'],
  'gate.evidence_recorded': ['evidenceId', 'payloadSha256', 'gateKind', 'approver', 'scopeRefs', 'issuedAt', 'expiresAt', 'recordedAt'],
  'gate.evidence_refused': ['evidenceId', 'gateKind', 'requiredScope', 'reason', 'evaluatedAt'],
  'decision.trace_recorded': ['traceId', 'decisionRef', 'requirementIds', 'manifestSha256', 'releaseReportId', 'recordedAt'],
  'release.report_emitted': ['reportId', 'documentHash', 'manifestHash', 'normalizedHash', 'dependencySbomHash', 'activationState', 'rollbackTarget', 'generatedAt'],
} as const;
