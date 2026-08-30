/**
 * Versioned MCP surface schemas (FR-MCP-003, PRD §17.4).
 *
 * This module describes what crosses the MCP presentation boundary.  It does
 * not interpret a refusal reason or authorize a cursor: the security and
 * transport layers own those decisions.  Keeping their values as typed,
 * non-empty passthroughs ensures that a precise upstream refusal cannot be
 * collapsed into an unhelpful generic error at the MCP boundary.
 */
import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

/** Bumped only for breaking changes to the MCP surface contract. */
export const MCP_SCHEMA_REGISTRY_VERSION = 1;

const NonEmptyStringSchema = z.string().min(1);

/** Typed only for presence: security layers retain their exact reason code. */
export const McpRefusalReasonSchema = NonEmptyStringSchema;
export type McpRefusalReason = z.infer<typeof McpRefusalReasonSchema>;

/**
 * Claims that bind an established MCP session to a single authenticated
 * principal, profile, Origin, and protocol revision.  A resumable cursor must
 * carry this session id so consumers cannot accidentally treat it as global.
 */
export const McpSessionBindingSchema = z
  .object({
    sessionId: NonEmptyStringSchema,
    actor: NonEmptyStringSchema,
    profileId: NonEmptyStringSchema,
    origin: NonEmptyStringSchema,
    protocolRevision: NonEmptyStringSchema,
  })
  .strict();
export type McpSessionBinding = z.infer<typeof McpSessionBindingSchema>;

/**
 * Opaque continuation token with the binding required to resume it safely.
 * `sortKey` records the final item of a deterministically ordered page; it is
 * descriptive rather than executable and lets adapters make ordering explicit.
 */
export const McpCursorSchema = z
  .object({
    cursor: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema,
    sortKey: NonEmptyStringSchema,
    issuedAt: UtcTimestampSchema,
  })
  .strict();
export type McpCursor = z.infer<typeof McpCursorSchema>;

/** Explicit ordering declaration required whenever a page is returned. */
export const McpOrderingSchema = z
  .object({
    fields: z.array(NonEmptyStringSchema).min(1),
    direction: z.enum(['ASC', 'DESC']),
  })
  .strict();
export type McpOrdering = z.infer<typeof McpOrderingSchema>;

/** One concise evidence/resource link in place of oversized raw payloads. */
export const McpResourceLinkSchema = z
  .object({
    uri: NonEmptyStringSchema,
    title: NonEmptyStringSchema.optional(),
    mimeType: NonEmptyStringSchema.optional(),
  })
  .strict();
export type McpResourceLink = z.infer<typeof McpResourceLinkSchema>;

/**
 * The §17.4 metadata companion to structured content.  These fields remain
 * intentionally descriptive: domain-specific capability, rights, cost, and
 * source-dependence vocabularies evolve independently of MCP transport.
 */
export const McpOutputMetadataSchema = z
  .object({
    qualityCodes: z.array(NonEmptyStringSchema),
    freshnessSeconds: z.number().nonnegative().nullable(),
    capability: z.array(NonEmptyStringSchema),
    rights: z.array(NonEmptyStringSchema),
    cost: z.record(z.string(), z.unknown()),
    sourceDependence: z.array(NonEmptyStringSchema),
    partial: z.boolean(),
    abstention: z.enum(['NONE', 'ABSTAINED', 'INSUFFICIENT_DATA']),
  })
  .strict();
export type McpOutputMetadata = z.infer<typeof McpOutputMetadataSchema>;

/**
 * Successful MCP tool output.  `structuredContent` is validated by the
 * tool's declared JSON `outputSchema`; this envelope supplies the common
 * transport and metadata shape around that tool-specific payload.
 */
export const McpOutputEnvelopeSchema = z
  .object({
    structuredContent: z.unknown(),
    humanReadableContent: NonEmptyStringSchema,
    resourceLinks: z.array(McpResourceLinkSchema),
    metadata: McpOutputMetadataSchema,
    ordering: McpOrderingSchema,
    nextCursor: McpCursorSchema.nullable(),
  })
  .strict();
export type McpOutputEnvelope = z.infer<typeof McpOutputEnvelopeSchema>;

/**
 * Refusals preserve the source-layer reason verbatim as a non-empty string.
 * MCP may add a safe human message, but must never replace the machine reason.
 */
export const McpRefusalSchema = z
  .object({
    refused: z.literal(true),
    reason: NonEmptyStringSchema,
    humanReadableContent: NonEmptyStringSchema,
  })
  .strict();
export type McpRefusal = z.infer<typeof McpRefusalSchema>;

/** A tool-call result is either an output envelope or a passthrough refusal. */
export const McpToolResultSchema = z.union([McpOutputEnvelopeSchema, McpRefusalSchema]);
export type McpToolResult = z.infer<typeof McpToolResultSchema>;

// Uppercase MCP aliases keep surface naming consistent for consumers that use
// the protocol acronym as a single initialism.
export const MCPOutputEnvelopeSchema = McpOutputEnvelopeSchema;
export const MCPSessionBindingSchema = McpSessionBindingSchema;
export const MCPCursorSchema = McpCursorSchema;
export const MCPRefusalSchema = McpRefusalSchema;
export const MCPOutputMetadataSchema = McpOutputMetadataSchema;
export const MCPRefusalReasonSchema = McpRefusalReasonSchema;
export const McpOutputMetaSchema = McpOutputMetadataSchema;
export const McpPaginationCursorSchema = McpCursorSchema;

/** Versioned registry used by generic schema-boundary consumers. */
export const MCP_SCHEMAS = {
  McpSessionBinding: McpSessionBindingSchema,
  McpCursor: McpCursorSchema,
  McpOrdering: McpOrderingSchema,
  McpResourceLink: McpResourceLinkSchema,
  McpOutputMetadata: McpOutputMetadataSchema,
  McpOutputEnvelope: McpOutputEnvelopeSchema,
  McpRefusal: McpRefusalSchema,
  McpRefusalReason: McpRefusalReasonSchema,
  McpToolResult: McpToolResultSchema,
} as const;
export type McpSchemaName = keyof typeof MCP_SCHEMAS;

/** Parse-by-name entrypoint for generic boundary code. */
export function parseMcpSchema<T extends McpSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof MCP_SCHEMAS)[T]> {
  return MCP_SCHEMAS[name].parse(payload) as z.infer<(typeof MCP_SCHEMAS)[T]>;
}
