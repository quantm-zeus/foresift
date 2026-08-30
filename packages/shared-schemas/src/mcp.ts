/**
 * Versioned MCP presentation-boundary schemas (FR-MCP-003, PRD §17.4).
 *
 * Tool-specific structured data remains governed by a tool's outputSchema;
 * this module provides the common envelope, provenance metadata, resumable
 * cursor, and session-binding shapes shared by every MCP tool.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

/** Bumped only for breaking changes to the MCP surface contract. */
export const MCP_SCHEMA_REGISTRY_VERSION = 1;

const NonEmptyStringSchema = z.string().min(1);
const VisibleAsciiTokenSchema = z
  .string()
  .min(1)
  .regex(/^[\x21-\x7e]+$/, { message: 'must be a visible ASCII-safe token' });

/**
 * MCP owns no closed refusal vocabulary.  Admission, security, rights, and
 * provider layers retain ownership of their codes, which must pass through
 * without being collapsed at the response boundary.
 */
export const McpRefusalReasonSchema = NonEmptyStringSchema;
export type McpRefusalReason = z.infer<typeof McpRefusalReasonSchema>;

/** §17.7 dimensions to which a stateful MCP session is bound. */
export const McpSessionBindingSchema = z
  .object({
    sessionId: VisibleAsciiTokenSchema,
    actor: NonEmptyStringSchema,
    profileId: NonEmptyStringSchema,
    origin: z.string().url(),
    protocolRevision: NonEmptyStringSchema,
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    terminatedAt: UtcTimestampSchema.nullable(),
  })
  .strict()
  .refine((value) => Date.parse(value.expiresAt) > Date.parse(value.createdAt), {
    message: 'expiresAt must follow createdAt',
  });
export type McpSessionBinding = z.infer<typeof McpSessionBindingSchema>;

/**
 * Opaque resumable cursor.  Authorization is an explicit fact from the
 * transport/session guard, never inferred from the cursor token itself.
 */
export const McpCursorSchema = z
  .object({
    cursor: VisibleAsciiTokenSchema,
    sessionId: VisibleAsciiTokenSchema,
    sequence: z.number().int().nonnegative(),
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    authorized: z.boolean(),
  })
  .strict()
  .refine((value) => Date.parse(value.expiresAt) > Date.parse(value.issuedAt), {
    message: 'expiresAt must follow issuedAt',
  });
export type McpCursor = z.infer<typeof McpCursorSchema>;

/** Alias that makes the cursor's use at resumable-stream boundaries explicit. */
export const McpResumableCursorSchema = McpCursorSchema;
export type McpResumableCursor = McpCursor;

/** Deterministic ordering declaration required for paginated output. */
export const McpOrderingSchema = z
  .object({
    fields: z.array(NonEmptyStringSchema).min(1),
    direction: z.enum(['ASC', 'DESC']),
  })
  .strict();
export type McpOrdering = z.infer<typeof McpOrderingSchema>;

/** §17.3 resource URIs permitted in MCP output links. */
export const ALL_MCP_RESOURCE_SCHEMES = [
  'evidence',
  'run',
  'candidate',
  'snapshot',
  'report',
  'conflict',
  'capacity',
  'tradability',
] as const;
export type McpResourceScheme = (typeof ALL_MCP_RESOURCE_SCHEMES)[number];

export const McpResourceUriSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      const match = /^([a-z][a-z0-9+.-]*):\/\/.+$/i.exec(value);
      return (
        match !== null &&
        ALL_MCP_RESOURCE_SCHEMES.includes(match[1]!.toLowerCase() as McpResourceScheme)
      );
    },
    { message: 'must use an approved MCP resource URI scheme' },
  );

/** One link to derived/evidence content rather than an oversized raw payload. */
export const McpResourceLinkSchema = z
  .object({
    uri: McpResourceUriSchema,
    title: NonEmptyStringSchema.optional(),
    mimeType: NonEmptyStringSchema.optional(),
  })
  .strict();
export type McpResourceLink = z.infer<typeof McpResourceLinkSchema>;

/** Every required §17.4 output metadata dimension. */
export const McpOutputMetadataSchema = z
  .object({
    toolName: NonEmptyStringSchema,
    toolVersion: NonEmptyStringSchema,
    provider: NonEmptyStringSchema.optional(),
    operation: NonEmptyStringSchema.optional(),
    // An envelope can carry evidence links directly; metadata mirrors them
    // when a caller needs field-level provenance.
    evidenceUris: z.array(McpResourceUriSchema).default([]),
    observedAt: UtcTimestampSchema.optional(),
    availableAt: UtcTimestampSchema.optional(),
    fetchedAt: UtcTimestampSchema,
    freshnessSeconds: z.number().nonnegative().nullable(),
    qualityCodes: z.array(NonEmptyStringSchema),
    conflicts: z.array(z.string().min(1)).default([]),
    capability: z.array(NonEmptyStringSchema).default([]),
    rightsPolicy: NonEmptyStringSchema,
    cost: z.record(z.string(), z.unknown()).default({}),
    /** Retained for lightweight callers that report a scalar cost. */
    costUnits: z.number().nonnegative().optional(),
    sourceDependence: z.union([NonEmptyStringSchema, z.array(NonEmptyStringSchema).min(1)]),
    partial: z.boolean(),
    abstention: z.boolean().default(false),
    abstentionReason: NonEmptyStringSchema.nullable().default(null),
    nextCursor: VisibleAsciiTokenSchema.optional(),
  })
  .strict()
  .refine((value) => value.abstention || value.abstentionReason === null, {
    message: 'abstentionReason requires an explicit abstention',
  })
  .refine((value) => !value.abstention || value.abstentionReason !== null, {
    message: 'an explicit abstention requires a reason',
  });
export type McpOutputMetadata = z.infer<typeof McpOutputMetadataSchema>;

/** Compatibility name used by transport adapters. */
export const McpOutputMetaSchema = McpOutputMetadataSchema;
export type McpOutputMeta = McpOutputMetadata;

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

/** Flexible tool-specific data with structural prohibited-payload scrubbing. */
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

/** Structured output plus concise human content and deterministic pagination. */
export const McpOutputEnvelopeSchema = z
  .object({
    outputSchema: z.record(z.string(), z.unknown()),
    structuredContent: McpStructuredContentSchema,
    humanContent: z.string().min(1).max(4_000),
    resourceLinks: z.array(McpResourceUriSchema),
    cursor: McpCursorSchema.nullable(),
    nextCursor: VisibleAsciiTokenSchema.nullable(),
    hasMore: z.boolean(),
    meta: McpOutputMetadataSchema,
  })
  .strict()
  .refine((value) => !value.hasMore || value.nextCursor !== null, {
    message: 'hasMore requires nextCursor',
  });
export type McpOutputEnvelope = z.infer<typeof McpOutputEnvelopeSchema>;

/** A complete deterministic admission refusal preserving its upstream code. */
export const McpAdmissionRefusalSchema = z
  .object({
    refusalCode: McpRefusalReasonSchema,
    stage: z.enum([
      'ORIGIN_GATE',
      'PROTOCOL_GATE',
      'AUTH_GATE',
      'SESSION_GATE',
      'RATE_GATE',
      'POLICY_GATE',
      'RESOURCE_GATE',
    ]),
    detail: z.string().min(1).max(500),
    occurredAt: UtcTimestampSchema,
  })
  .strict();
export type McpAdmissionRefusal = z.infer<typeof McpAdmissionRefusalSchema>;

/** §17.3 prompt vocabulary. */
export const ALL_MCP_PROMPT_NAMES = [
  'analyze-token',
  'investigate-alert',
  'compare-candidates',
  'audit-security',
  'explain-original-decision',
  're-evaluate-current',
  'analyze-wallet-cluster',
  'challenge-opportunity-thesis',
] as const;
export const McpPromptNameSchema = z.enum(ALL_MCP_PROMPT_NAMES);
export type McpPromptName = z.infer<typeof McpPromptNameSchema>;

/** Client constraints represented without credential material. */
export const McpClientContextSchema = z
  .object({
    clientId: NonEmptyStringSchema,
    actor: NonEmptyStringSchema,
    profileId: NonEmptyStringSchema,
    allowedScopes: z.array(NonEmptyStringSchema).min(1),
    allowedOrigins: z.array(z.string().url()).min(1),
    rateLimitRps: z.number().nonnegative(),
    concurrencyLimit: z.number().int().positive(),
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    revokedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type McpClientContext = z.infer<typeof McpClientContextSchema>;

/** Versioned registry used by generic schema-boundary consumers. */
export const MCP_SCHEMAS = {
  McpSessionBinding: McpSessionBindingSchema,
  McpCursor: McpCursorSchema,
  McpResumableCursor: McpResumableCursorSchema,
  McpOrdering: McpOrderingSchema,
  McpResourceLink: McpResourceLinkSchema,
  McpOutputMetadata: McpOutputMetadataSchema,
  McpOutputMeta: McpOutputMetaSchema,
  McpOutputEnvelope: McpOutputEnvelopeSchema,
  McpAdmissionRefusal: McpAdmissionRefusalSchema,
  McpRefusalReason: McpRefusalReasonSchema,
  McpClientContext: McpClientContextSchema,
} as const;
export type McpSchemaName = keyof typeof MCP_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. */
export function parseMcpSchema<T extends McpSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof MCP_SCHEMAS)[T]> {
  return MCP_SCHEMAS[name].parse(payload) as z.infer<(typeof MCP_SCHEMAS)[T]>;
}

// Acronym-preserving aliases support consumers that use MCP as one initialism.
export const MCPOutputEnvelopeSchema = McpOutputEnvelopeSchema;
export const MCPSessionBindingSchema = McpSessionBindingSchema;
export const MCPCursorSchema = McpCursorSchema;
export const MCPOutputMetadataSchema = McpOutputMetadataSchema;
export const MCPRefusalReasonSchema = McpRefusalReasonSchema;
