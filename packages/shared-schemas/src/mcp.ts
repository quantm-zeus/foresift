/**
 * Strict MCP output contracts for FR-MCP-003 / §17.4.
 *
 * The transport layer owns authentication and execution; this family owns the
 * public response boundary.  In particular it makes pagination deterministic,
 * keeps a response bound to the session that produced it, and ensures that
 * important returned fields carry quality, time, provenance, and evidence.
 */
import { z } from 'zod';
import { QualityCodeSchema, UtcTimestampSchema } from './data.ts';

/** Bumped only for breaking contract changes. */
export const MCP_SCHEMA_REGISTRY_VERSION = 1;

const NonEmptyStringsSchema = z.array(z.string().min(1)).min(1);

/**
 * The immutable identity dimensions established when a Streamable HTTP MCP
 * session is created.  Callers compare these values on every request; a
 * request must never be rebound to another actor, profile, origin, or
 * protocol revision.
 */
export const McpSessionBindingSchema = z
  .object({
    sessionId: z.string().min(1),
    clientId: z.string().min(1),
    actor: z.string().min(1),
    profileId: z.string().min(1),
    origin: z.string().min(1),
    protocolRevision: z.string().min(1),
  })
  .strict();
export type McpSessionBinding = z.infer<typeof McpSessionBindingSchema>;

/**
 * An opaque cursor and the stable ordering that gives it meaning.  Cursor
 * values deliberately have no prescribed encoding: callers may sign or
 * encrypt them, but cannot omit the ordering used to resume a page.
 */
export const McpCursorSchema = z
  .object({
    cursor: z.string().min(1),
    orderBy: NonEmptyStringsSchema,
  })
  .strict();
export type McpCursor = z.infer<typeof McpCursorSchema>;

/** Pagination metadata attached to every list-shaped result. */
export const McpPaginationSchema = z
  .object({
    pageSize: z.number().int().positive(),
    orderBy: NonEmptyStringsSchema,
    cursor: z.string().min(1).nullable(),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export type McpPagination = z.infer<typeof McpPaginationSchema>;

/** Quality and timing information for one important returned field. */
export const McpImportantFieldMetadataSchema = z
  .object({
    field: z.string().min(1),
    quality: z.array(QualityCodeSchema).min(1),
    observedAt: UtcTimestampSchema,
    provenanceRefs: NonEmptyStringsSchema,
    evidenceRefs: NonEmptyStringsSchema,
  })
  .strict();
export type McpImportantFieldMetadata = z.infer<typeof McpImportantFieldMetadataSchema>;

/** Freshness is explicit so stale-but-usable values cannot look current. */
export const McpFreshnessMetadataSchema = z
  .object({
    asOf: UtcTimestampSchema,
    freshUntil: UtcTimestampSchema.nullable(),
    stale: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.freshUntil === null || Date.parse(value.freshUntil) >= Date.parse(value.asOf),
    { message: 'freshUntil cannot precede asOf' },
  );
export type McpFreshnessMetadata = z.infer<typeof McpFreshnessMetadataSchema>;

export const McpCapabilityMetadataSchema = z
  .object({
    state: z.enum(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE']),
    reasons: z.array(z.string().min(1)),
  })
  .strict()
  .refine((value) => value.state === 'AVAILABLE' || value.reasons.length > 0, {
    message: 'degraded and unavailable capability states require reasons',
  });
export type McpCapabilityMetadata = z.infer<typeof McpCapabilityMetadataSchema>;

export const McpRightsMetadataSchema = z
  .object({
    state: z.enum(['PERMITTED', 'LIMITED', 'BLOCKED']),
    policyRef: z.string().min(1),
    reasons: z.array(z.string().min(1)),
  })
  .strict()
  .refine((value) => value.state === 'PERMITTED' || value.reasons.length > 0, {
    message: 'limited and blocked rights states require reasons',
  });
export type McpRightsMetadata = z.infer<typeof McpRightsMetadataSchema>;

export const McpCostMetadataSchema = z
  .object({
    state: z.enum(['WITHIN_BUDGET', 'QUOTA_LIMITED', 'COST_BLOCKED', 'UNKNOWN']),
    costRefs: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
  })
  .strict()
  .refine((value) => value.state === 'WITHIN_BUDGET' || value.reasons.length > 0, {
    message: 'non-ready cost states require reasons',
  });
export type McpCostMetadata = z.infer<typeof McpCostMetadataSchema>;

export const McpSourceDependenceMetadataSchema = z
  .object({
    sourceRefs: NonEmptyStringsSchema,
    independenceGroupRefs: z.array(z.string().min(1)),
    dependenceKnown: z.boolean(),
  })
  .strict()
  .refine((value) => value.dependenceKnown || value.independenceGroupRefs.length === 0, {
    message: 'unknown dependence cannot claim independence groups',
  });
export type McpSourceDependenceMetadata = z.infer<typeof McpSourceDependenceMetadataSchema>;

/** Every §17.4 metadata dimension carried by a tool result. */
export const McpOutputMetadataSchema = z
  .object({
    importantFields: z.array(McpImportantFieldMetadataSchema).min(1),
    freshness: McpFreshnessMetadataSchema,
    capability: McpCapabilityMetadataSchema,
    rights: McpRightsMetadataSchema,
    cost: McpCostMetadataSchema,
    sourceDependence: McpSourceDependenceMetadataSchema,
    partialResult: z.boolean(),
  })
  .strict();
export type McpOutputMetadata = z.infer<typeof McpOutputMetadataSchema>;

/**
 * Refusal reasons are intentionally an open, non-empty string passthrough.
 * Security, rights, provider, and capability layers each own their reason
 * vocabularies; this boundary must preserve them rather than collapse them to
 * an incomplete MCP-local enum.
 */
export const McpRefusalReasonSchema = z.string().min(1);
export type McpRefusalReason = z.infer<typeof McpRefusalReasonSchema>;

const forbiddenOutputFieldNames = new Set([
  'transaction',
  'transactionpayload',
  'privatekey',
  'signaturerequest',
  'seedphrase',
  'routetransaction',
  'executablefinancialinstruction',
]);

function containsForbiddenOutputField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenOutputField);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      forbiddenOutputFieldNames.has(key.replace(/[^a-z]/gi, '').toLowerCase()) ||
      containsForbiddenOutputField(nested),
  );
}

/** Structured output remains flexible but cannot carry prohibited capabilities. */
export const McpStructuredContentSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, context) => {
    if (containsForbiddenOutputField(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'structured content contains a prohibited financial or secret field',
      });
    }
  });
export type McpStructuredContent = z.infer<typeof McpStructuredContentSchema>;

const McpResponseBaseSchema = z.object({
  session: McpSessionBindingSchema,
  humanReadableContent: z.string().min(1).max(4_000),
  structuredContent: McpStructuredContentSchema,
  resourceLinks: z.array(z.string().min(1)),
  pagination: McpPaginationSchema.nullable(),
  metadata: McpOutputMetadataSchema,
});

/**
 * MCP tool result.  Refusals preserve their upstream reasons; abstentions and
 * insufficient-data outcomes remain explicit rather than being rendered as
 * successful empty results.
 */
export const McpOutputEnvelopeSchema = z.union([
  McpResponseBaseSchema.extend({
    outcome: z.enum(['SUCCESS', 'PARTIAL', 'ABSTAINED', 'INSUFFICIENT_DATA']),
    refusalReasons: z.array(McpRefusalReasonSchema),
  })
    .strict()
    .refine((value) => value.outcome !== 'PARTIAL' || value.metadata.partialResult, {
      message: 'PARTIAL output requires partialResult metadata',
    })
    .refine((value) => value.outcome === 'PARTIAL' || !value.metadata.partialResult, {
      message: 'partialResult metadata requires PARTIAL output',
    }),
  McpResponseBaseSchema.extend({
    outcome: z.literal('REFUSED'),
    refusalReasons: z.array(McpRefusalReasonSchema).min(1),
  }).strict(),
]);
export type McpOutputEnvelope = z.infer<typeof McpOutputEnvelopeSchema>;

/** Versioned registry for generic schema-boundary callers. */
export const MCP_SCHEMAS = {
  McpSessionBinding: McpSessionBindingSchema,
  McpCursor: McpCursorSchema,
  McpPagination: McpPaginationSchema,
  McpImportantFieldMetadata: McpImportantFieldMetadataSchema,
  McpFreshnessMetadata: McpFreshnessMetadataSchema,
  McpCapabilityMetadata: McpCapabilityMetadataSchema,
  McpRightsMetadata: McpRightsMetadataSchema,
  McpCostMetadata: McpCostMetadataSchema,
  McpSourceDependenceMetadata: McpSourceDependenceMetadataSchema,
  McpOutputMetadata: McpOutputMetadataSchema,
  McpRefusalReason: McpRefusalReasonSchema,
  McpOutputEnvelope: McpOutputEnvelopeSchema,
} as const;

export type McpSchemaName = keyof typeof MCP_SCHEMAS;

/** Parse by public registry name. Throws ZodError when a boundary is invalid. */
export function parseMcpSchema<T extends McpSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof MCP_SCHEMAS)[T]> {
  return MCP_SCHEMAS[name].parse(payload) as z.infer<(typeof MCP_SCHEMAS)[T]>;
}

// Acronym-preserving aliases support MCP-facing callers while keeping the
// PascalCase `Mcp` convention used by TypeScript identifiers in this package.
export const MCPOutputEnvelopeSchema = McpOutputEnvelopeSchema;
export const MCPSessionBindingSchema = McpSessionBindingSchema;
export const MCPCursorSchema = McpCursorSchema;
export const MCPOutputMetadataSchema = McpOutputMetadataSchema;
