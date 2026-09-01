/** Strict, versioned traceability and release-conformance boundary schemas. */
import { z } from 'zod';

export const TRACE_SCHEMA_REGISTRY_VERSION = 1;

const UtcTimestampSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA-256 digest');
const Sha256RefSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'must be a sha256:<lowercase digest> reference');
const NonEmptyStringSchema = z.string().trim().min(1);

/** PRD normative identifier namespaces. */
export const RequirementRefSchema = z.string().regex(
  /^(?:FR-[A-Z0-9]+-[0-9]{3,}|AC-[0-9]{3,}|INV-[0-9]{3,}|ADR-[0-9]{4})$/,
  'invalid requirement, acceptance, invariant, or ADR reference',
);
export type RequirementRef = z.infer<typeof RequirementRefSchema>;

/** Runtime identifiers mapped by FR-TRACE-002. */
export const TraceIdPatternSchema = z
  .string()
  .regex(/^(?:feature|schema|api|tool|policy|artifact|test):\S+$/, 'invalid trace ID');
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
  .refine((link) => link.replacedId !== link.supersededById, {
    message: 'a trace ID cannot supersede itself',
    path: ['supersededById'],
  });
export type SupersessionLink = z.infer<typeof SupersessionLinkSchema>;

export const GATE_KINDS = [
  'MANUAL',
  'LEGAL',
  'RIGHTS',
  'STATISTICAL',
  'OWNER_APPROVAL',
] as const;

export const GateEvidencePayloadSchema = z
  .object({
    gateKind: z.enum(GATE_KINDS),
    approver: NonEmptyStringSchema,
    scopeRefs: z.array(NonEmptyStringSchema).min(1),
    subject: NonEmptyStringSchema,
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    reason: NonEmptyStringSchema.optional(),
    revocationRef: NonEmptyStringSchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const GateEvidenceRecordSchema = z
  .object({
    evidenceId: NonEmptyStringSchema,
    payload: GateEvidencePayloadSchema,
    payloadSha256: Sha256Schema,
    signature: Sha256Schema,
    gateKind: z.enum(GATE_KINDS),
    scopeRefs: z.array(NonEmptyStringSchema).min(1),
    approver: NonEmptyStringSchema,
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullable().optional(),
    recordedAt: UtcTimestampSchema,
  })
  .strict();
export type GateEvidenceRecord = z.infer<typeof GateEvidenceRecordSchema>;

const VersionMapSchema = z.record(NonEmptyStringSchema, NonEmptyStringSchema);

export const DecisionTraceRecordSchema = z
  .object({
    traceId: NonEmptyStringSchema,
    decisionRef: NonEmptyStringSchema,
    requirementIds: z.array(RequirementRefSchema).min(1),
    policyVersions: VersionMapSchema,
    featureVersions: VersionMapSchema,
    modelVersions: VersionMapSchema,
    toolVersions: VersionMapSchema,
    providerVersions: VersionMapSchema,
    adapterVersions: VersionMapSchema,
    artifactVersions: VersionMapSchema,
    testReleaseId: NonEmptyStringSchema,
    conformanceReleaseId: NonEmptyStringSchema,
    manifestSha256: Sha256Schema,
    releaseReportId: NonEmptyStringSchema,
    recordedAt: UtcTimestampSchema,
  })
  .strict();
export type DecisionTraceRecord = z.infer<typeof DecisionTraceRecordSchema>;

const ConformanceFindingSchema = z
  .object({
    requirementId: NonEmptyStringSchema,
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
  .strict();

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
    previousDocumentHash: Sha256Schema,
    previousManifestHash: Sha256Schema,
  })
  .strict();

export const ReleaseReportRecordSchema = z
  .object({
    reportId: NonEmptyStringSchema,
    documentHash: Sha256Schema,
    manifestHash: Sha256Schema,
    normalizedHash: Sha256Schema,
    migrationHashes: z.record(NonEmptyStringSchema, Sha256RefSchema),
    schemaHashes: z.record(NonEmptyStringSchema, Sha256RefSchema),
    dependencySbomHash: Sha256Schema,
    conformanceResults: ConformanceResultsSchema,
    unresolvedDeviations: z.array(DeviationSchema),
    activationState: ActivationStateSchema,
    rollbackTarget: RollbackTargetSchema,
    generatedAt: UtcTimestampSchema,
  })
  .strict();
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
