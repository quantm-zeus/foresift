/** Strict, versioned traceability and release-conformance boundary schemas. */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

export const TRACE_SCHEMA_REGISTRY_VERSION = 1;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, {
  message: 'must be a lowercase SHA-256 hex digest',
});
const PrefixedSha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/, {
  message: 'must be a sha256:<lowercase hex> digest',
});
const NonEmptyStringSchema = z.string().trim().min(1);
const NonEmptyVersionMapSchema = z
  .record(NonEmptyStringSchema, NonEmptyStringSchema)
  .refine((value) => Object.keys(value).length > 0, { message: 'version map must not be empty' });

/** Stable normative-document namespaces. */
export const RequirementRefSchema = z.string().regex(
  /^(?:FR-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}|AC-\d{3}|INV-\d{3}|ADR-\d{4})$/,
  { message: 'must be an FR, AC, INV, or ADR identifier' },
);
export type RequirementRef = z.infer<typeof RequirementRefSchema>;

/** Runtime identifiers that participate in global traceability. */
export const TraceIdPatternSchema = z.string().trim().min(1).regex(
  /^(?:feature|schema|api|tool|policy|artifact|test):\S+$/,
  { message: 'must use a registered trace ID namespace' },
);
export type TraceIdPattern = z.infer<typeof TraceIdPatternSchema>;

export const TRACE_ID_NAMESPACES = [
  'requirement',
  'acceptance',
  'invariant',
  'adr',
  'feature',
  'schema',
  'api',
  'tool',
  'policy',
  'artifact',
  'test',
] as const;

export const SupersessionLinkSchema = z
  .object({
    replacedId: NonEmptyStringSchema,
    supersededById: NonEmptyStringSchema,
    namespace: z.enum(TRACE_ID_NAMESPACES),
    recordedAt: UtcTimestampSchema,
    reason: NonEmptyStringSchema,
  })
  .strict()
  .refine((value) => value.replacedId !== value.supersededById, {
    message: 'an identifier cannot supersede itself',
  });
export type SupersessionLink = z.infer<typeof SupersessionLinkSchema>;

export const GATE_KINDS = [
  'MANUAL',
  'LEGAL',
  'RIGHTS',
  'STATISTICAL',
  'OWNER_APPROVAL',
] as const;
export const GateKindSchema = z.enum(GATE_KINDS);

export const GateEvidencePayloadSchema = z
  .object({
    gateKind: GateKindSchema,
    approver: NonEmptyStringSchema,
    scopeRefs: z.array(NonEmptyStringSchema).min(1),
    subject: NonEmptyStringSchema,
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    reason: NonEmptyStringSchema.optional(),
    revocationRef: NonEmptyStringSchema.nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const GateEvidenceRecordSchema = z
  .object({
    evidenceId: NonEmptyStringSchema,
    payload: GateEvidencePayloadSchema,
    payloadSha256: Sha256HexSchema,
    signature: Sha256HexSchema,
    gateKind: GateKindSchema,
    scopeRefs: z.array(NonEmptyStringSchema).min(1),
    approver: NonEmptyStringSchema,
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullish(),
    recordedAt: UtcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.gateKind !== value.payload.gateKind) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['gateKind'], message: 'must match payload' });
    }
    if (value.approver !== value.payload.approver) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['approver'], message: 'must match payload' });
    }
    if (new Date(value.expiresAt).getTime() <= new Date(value.issuedAt).getTime()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'must follow issuedAt' });
    }
  });
export type GateEvidenceRecord = z.infer<typeof GateEvidenceRecordSchema>;

export const DecisionTraceRecordSchema = z
  .object({
    traceId: z.string().regex(/^trc-[0-9a-f]{64}$/),
    decisionRef: NonEmptyStringSchema,
    requirementIds: z.array(RequirementRefSchema).min(1),
    policyVersions: NonEmptyVersionMapSchema,
    featureVersions: NonEmptyVersionMapSchema,
    modelVersions: NonEmptyVersionMapSchema,
    toolVersions: NonEmptyVersionMapSchema,
    providerVersions: NonEmptyVersionMapSchema,
    adapterVersions: NonEmptyVersionMapSchema,
    artifactVersions: NonEmptyVersionMapSchema,
    testReleaseId: NonEmptyStringSchema,
    conformanceReleaseId: NonEmptyStringSchema,
    manifestSha256: Sha256HexSchema,
    releaseReportId: NonEmptyStringSchema,
    recordedAt: UtcTimestampSchema,
  })
  .strict();
export type DecisionTraceRecord = z.infer<typeof DecisionTraceRecordSchema>;

const ConformanceFindingSchema = z
  .object({
    requirementId: RequirementRefSchema,
    rule: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
  })
  .strict();

const ConformanceResultsSchema = z
  .object({
    overall: z.enum(['PASSED', 'FAILED']),
    totalRulesEvaluated: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    findings: z.array(ConformanceFindingSchema),
  })
  .strict()
  .refine((value) => value.passedCount + value.failureCount === value.totalRulesEvaluated, {
    message: 'conformance result counts must balance',
  });

const DeviationSchema = z
  .object({
    id: NonEmptyStringSchema,
    rule: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    justification: NonEmptyStringSchema,
    expiryDate: UtcTimestampSchema.optional(),
  })
  .strict();

const ActivationStateSchema = z
  .object({
    milestone: NonEmptyStringSchema,
    status: z.enum(['ACTIVE', 'BLOCKED', 'PENDING']),
    activeGroups: z.array(NonEmptyStringSchema),
    gatesPassed: z.array(NonEmptyStringSchema),
  })
  .strict();

const RollbackTargetSchema = z
  .object({
    previousReportId: NonEmptyStringSchema,
    previousDocumentHash: Sha256HexSchema,
    previousManifestHash: Sha256HexSchema,
  })
  .strict();

export const ReleaseReportRecordSchema = z
  .object({
    reportId: NonEmptyStringSchema,
    documentHash: Sha256HexSchema,
    manifestHash: Sha256HexSchema,
    normalizedHash: Sha256HexSchema,
    migrationHashes: z.record(NonEmptyStringSchema, PrefixedSha256Schema),
    schemaHashes: z.record(NonEmptyStringSchema, PrefixedSha256Schema),
    dependencySbomHash: Sha256HexSchema,
    conformanceResults: ConformanceResultsSchema,
    unresolvedDeviations: z.array(DeviationSchema),
    activationState: ActivationStateSchema,
    rollbackTarget: RollbackTargetSchema,
    generatedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => Object.keys(value.migrationHashes).length > 0, {
    message: 'migrationHashes must not be empty',
  })
  .refine((value) => Object.keys(value.schemaHashes).length > 0, {
    message: 'schemaHashes must not be empty',
  });
export type ReleaseReportRecord = z.infer<typeof ReleaseReportRecordSchema>;

export const TRACE_SCHEMAS = {
  RequirementRef: RequirementRefSchema,
  TraceIdPattern: TraceIdPatternSchema,
  SupersessionLink: SupersessionLinkSchema,
  GateEvidenceRecord: GateEvidenceRecordSchema,
  DecisionTraceRecord: DecisionTraceRecordSchema,
  ReleaseReportRecord: ReleaseReportRecordSchema,
} as const;
export type TraceSchemaName = keyof typeof TRACE_SCHEMAS;

export function parseTraceSchema<T extends TraceSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof TRACE_SCHEMAS)[T]> {
  return TRACE_SCHEMAS[name].parse(payload) as z.infer<(typeof TRACE_SCHEMAS)[T]>;
}

/** Field inventory consumed by telemetry-catalog parity checks. */
export const TRACE_TELEMETRY_FIELDS = {
  'manifest.integrity_checked': [
    'manifestSha256',
    'documentSha256',
    'normalizedSha256',
    'verdict',
    'findingCount',
  ],
  'ids.superseded': ['replacedId', 'supersededById', 'namespace', 'recordedAt', 'reason'],
  'conformance.finding': ['requirementId', 'rule', 'path', 'message'],
  'gate.evidence_recorded': [
    'evidenceId',
    'payloadSha256',
    'gateKind',
    'approver',
    'scopeRefs',
    'issuedAt',
    'expiresAt',
    'recordedAt',
  ],
  'gate.evidence_refused': [
    'evidenceId',
    'gateKind',
    'requiredScope',
    'reason',
    'evaluatedAt',
  ],
  'decision.trace_recorded': [
    'traceId',
    'decisionRef',
    'requirementIds',
    'manifestSha256',
    'releaseReportId',
    'recordedAt',
  ],
  'release.report_emitted': [
    'reportId',
    'documentHash',
    'manifestHash',
    'normalizedHash',
    'dependencySbomHash',
    'activationState',
    'rollbackTarget',
    'generatedAt',
  ],
} as const;
