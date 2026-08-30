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
import { MCP_PROTOCOL_BASELINE_REVISION } from './sec.ts';

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
    sessionId: VisibleAsciiSchema,
    actor: z.string().min(1),
    profileId: z.string().min(1),
    origin: z.string().min(1),
    protocolRevision: z.string().min(1).default(MCP_PROTOCOL_BASELINE_REVISION),
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
    profileId: z.string().min(1),
    protocolRevision: z.string().min(1),
    expiresAt: UtcTimestampSchema,
  })
  .strict();
export type McpCursor = z.infer<typeof McpCursorSchema>;

/**
 * Refusal reasons are intentionally opaque at this boundary. Security and
 * authorization families already own their closed enums; retaining the exact
 * non-empty reason prevents the MCP layer from collapsing them to prose.
 */
export const McpRefusalReasonSchema = z.string().min(1);
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
    outputSchema: z.record(z.string(), z.unknown()),
    structuredContent: z.unknown(),
    humanContent: z.string().min(1),
    evidenceLinks: z.array(z.string().min(1)),
    resourceLinks: z.array(z.string().min(1)),
    nextCursor: McpCursorSchema.nullable(),
    metadata: McpOutputMetadataSchema,
    outcome: McpOutputOutcomeSchema,
    refusalReason: McpRefusalReasonSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'REFUSED' && value.refusalReason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refusalReason'],
        message: 'REFUSED output requires the typed refusal reason',
      });
    }
    if (value.outcome !== 'REFUSED' && value.refusalReason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refusalReason'],
        message: 'only REFUSED output may include a refusal reason',
      });
    }
  });
export type McpOutputEnvelope = z.infer<typeof McpOutputEnvelopeSchema>;

/** Versioned MCP schema registry for manifest and transport consumers. */
export const MCP_SCHEMAS = {
  McpSessionBinding: McpSessionBindingSchema,
  McpCursor: McpCursorSchema,
  McpRefusalReason: McpRefusalReasonSchema,
  McpOutputMetadata: McpOutputMetadataSchema,
  McpOutputOutcome: McpOutputOutcomeSchema,
  McpOutputEnvelope: McpOutputEnvelopeSchema,
} as const;
export type McpSchemaName = keyof typeof MCP_SCHEMAS;

export function parseMcpSchema<T extends McpSchemaName>(
  name: T,
  payload: unknown,
): z.infer<(typeof MCP_SCHEMAS)[T]> {
  return MCP_SCHEMAS[name].parse(payload) as z.infer<(typeof MCP_SCHEMAS)[T]>;
}
