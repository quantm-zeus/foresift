/**
 * Strict, transport-neutral contracts for the MCP presentation surface.
 *
 * These schemas deliberately validate only the boundary representation. The
 * security package remains responsible for session authorization and cursor
 * ownership; this module makes the binding and the resulting output
 * inspectable without weakening the typed refusal supplied by that layer.
 */
import { z } from 'zod';
import { ToolResultMetaSchema } from './core.ts';
import { UtcTimestampSchema } from './data.ts';

/** Bumped only for a breaking MCP boundary-shape change. */
export const MCP_SCHEMA_REGISTRY_VERSION = 1;

const VisibleAsciiSchema = z
  .string()
  .min(1)
  .regex(/^[\x21-\x7e]+$/, { message: 'must contain visible ASCII characters only' });

/**
 * The immutable dimensions to which a stateful MCP session is bound (§17.7).
 * Session identifiers are intentionally opaque: randomness and non-secret
 * construction are issuance concerns, not properties inferable from a value.
 */
export const McpSessionBindingSchema = z
  .object({
    actor: z.string().min(1),
    profileId: z.string().min(1),
    origin: z.string().min(1),
    protocolRevision: z.string().min(1),
    expiresAt: UtcTimestampSchema,
  })
  .strict();
export type McpSessionBinding = z.infer<typeof McpSessionBindingSchema>;

/**
 * An opaque resumable cursor plus the binding that makes replay authorization
 * deterministic. Cursor ownership is checked by the protocol guard/store.
 */
export const McpCursorSchema = z
  .object({
    cursor: VisibleAsciiSchema,
    sessionId: VisibleAsciiSchema,
    actor: z.string().min(1),
    toolName: z.string().min(1),
    offset: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    issuedAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema,
    authorized: z.boolean(),
  })
  .strict();
export type McpCursor = z.infer<typeof McpCursorSchema>;

/**
 * Refusal reasons are intentionally opaque at this boundary. Security and
 * authorization families already own their closed enums; retaining the exact
 * non-empty reason prevents the MCP layer from collapsing them to prose.
 */
export const MCP_REFUSAL_REASONS = [
  'ORIGIN_NOT_ALLOWLISTED',
  'REVISION_UNSUPPORTED',
  'CONTENT_TYPE_INVALID',
  'METHOD_INVALID',
  'MESSAGE_OVERSIZE',
  'SESSION_BINDING_INVALID',
  'CURSOR_UNAUTHORIZED',
  'CREDENTIAL_REVOKED',
  'CREDENTIAL_EXPIRED',
  'CREDENTIAL_INVALID',
  'RATE_LIMIT_EXCEEDED',
  'CONCURRENCY_LIMIT_EXCEEDED',
  'PROHIBITED_PAYLOAD_DETECTED',
  'RESOURCE_UNAUTHORIZED',
  'RESOURCE_NOT_FOUND',
  'TOOL_NOT_IN_PROFILE',
] as const;
export const McpRefusalReasonSchema = z.enum(MCP_REFUSAL_REASONS);
export type McpRefusalReason = z.infer<typeof McpRefusalReasonSchema>;

/** §17.4 metadata, retaining every ToolCore result-meta field unchanged. */
export const McpOutputMetadataSchema = ToolResultMetaSchema.extend({
  /** Capability state/degradation detail supplied by the tool surface. */
  capability: z.unknown().optional(),
  /** Rights/retention decision detail supplied by the authorization surface. */
  rights: z.unknown().optional(),
  /** Additional cost declaration detail; quota remains required from ToolCore. */
  cost: z.unknown().optional(),
  /** Source/lineage dependencies needed to interpret the result. */
  sourceDependence: z.array(z.string().min(1)).optional(),
  /** §17.4 explicit-abstention posture on degraded results. */
  abstentionReason: z.string().min(1).optional(),
}).strict();
export type McpOutputMetadata = z.infer<typeof McpOutputMetadataSchema>;

export const McpOutputOutcomeSchema = z.enum([
  'SUCCESS',
  'PARTIAL',
  'ABSTAINED',
  'INSUFFICIENT_DATA',
  'REFUSED',
]);
export type McpOutputOutcome = z.infer<typeof McpOutputOutcomeSchema>;

/**
 * One MCP tool result. `outputSchema` advertises the structured payload;
 * concise human content complements rather than replaces that payload.
 */
export const McpOutputEnvelopeSchema = z
  .object({
    structuredContent: z.record(z.string(), z.unknown()),
    textContent: z.string().min(1),
    meta: McpOutputMetadataSchema,
    resourceLinks: z
      .array(z.object({ uri: z.string().min(1), title: z.string().min(1) }).strict())
      .min(1),
  })
  .strict();
export type McpOutputEnvelope = z.infer<typeof McpOutputEnvelopeSchema>;

/** Versioned MCP schema registry for manifest and transport consumers. */
/** Output metadata alias required by the boundary contract (FR-MCP-008). */
export const McpOutputMetaSchema = McpOutputMetadataSchema;

/**
 * Durable MCP session record (§17.7, INV-009): the binding dimensions plus
 * lifecycle timing. `terminatedAt` is null for ACTIVE/EXPIRED sessions and
 * set when the session is explicitly terminated.
 */
export const McpSessionRecordSchema = McpSessionBindingSchema.extend({
  sessionId: VisibleAsciiSchema,
  protocolRevision: z.string().min(1),
  expiresAt: UtcTimestampSchema,
  terminatedAt: UtcTimestampSchema.nullable(),
  createdAt: UtcTimestampSchema,
});

/**
 * Durable per-credential rate state (FR-MCP-009, INV-009): non-negative
 * token/in-flight counters against a rolling window (mirrors
 * migrations/g0_mcp_0002_rate_state.sql).
 */
export const McpRateStateRecordSchema = z
  .object({
    credentialId: z.string().min(1),
    rateClass: z.string().min(1),
    tokensRemaining: z.number().int().nonnegative(),
    inFlightCount: z.number().int().nonnegative(),
    windowStartedAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();

/**
 * G.13 MCP security block (FR-MCP-010): the transport/origin/session
 * posture a deployment advertises. Every field is explicit — no defaults —
 * so an absent policy fails closed instead of inheriting an implicit one.
 */
export const McpConfigSchema = z
  .object({
    protocolBaseline: z.string().min(1),
    allowedRevisions: z.array(z.string().min(1)).min(1),
    transport: z.enum(['STREAMABLE_HTTP']),
    originPolicy: z.enum(['EXACT_ALLOWLIST']),
    allowedOrigins: z.array(z.string().url()).min(1),
    absentOriginPolicy: z.enum(['PRODUCTION']),
    statefulSessionsEnabled: z.boolean(),
    maximumRequestBytes: z.number().int().positive(),
    maximumResponseBytes: z.number().int().positive(),
    maximumPageRecords: z.number().int().positive(),
  })
  .strict();

export const MCP_SCHEMAS = {
  McpSessionBinding: McpSessionBindingSchema,
  McpSessionRecord: McpSessionRecordSchema,
  McpCursor: McpCursorSchema,
  McpRefusalReason: McpRefusalReasonSchema,
  McpOutputMeta: McpOutputMetaSchema,
  McpOutputEnvelope: McpOutputEnvelopeSchema,
  McpRateStateRecord: McpRateStateRecordSchema,
  McpConfig: McpConfigSchema,
} as const;
export type McpSchemaName = keyof typeof MCP_SCHEMAS;

export function parseMcpSchema<T extends McpSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof MCP_SCHEMAS)[T]> {
  return MCP_SCHEMAS[name].parse(payload) as z.infer<(typeof MCP_SCHEMAS)[T]>;
}
