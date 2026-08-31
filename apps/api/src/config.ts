import { z } from 'zod';

export const MCP_PROTOCOL_BASELINE = '2025-11-25' as const;
export const MCP_MAXIMUM_REQUEST_BYTES = 262_144 as const;
export const MCP_MAXIMUM_RESPONSE_BYTES = 1_048_576 as const;
export const MCP_MAXIMUM_PAGE_RECORDS = 100 as const;

const BareOriginSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hostname.endsWith('.')
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a bare HTTP(S) origin' });
    }
  });

export const McpOriginPolicyConfigSchema = z
  .object({
    mode: z.literal('EXACT_ALLOWLIST'),
    allowed_origins: z.array(BareOriginSchema),
    allow_absent_origin_for_registered_non_browser_clients: z.boolean(),
    allow_null_origin: z.literal(false),
    local_mode: z
      .object({
        enabled: z.boolean(),
        allowed_origins: z.array(BareOriginSchema),
      })
      .strict()
      .optional(),
    trusted_proxy_addresses: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** The fail-closed G.13 MCP security block. Unknown keys are refused. */
export const McpSecurityConfigSchema = z
  .object({
    protocol_baseline: z.literal(MCP_PROTOCOL_BASELINE),
    mutually_tested_protocol_revisions: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}(?:-[a-z0-9.-]+)?$/))
      .min(1)
      .refine((revisions) => revisions.includes(MCP_PROTOCOL_BASELINE), {
        message: 'mutually tested revisions must include the protocol baseline',
      }),
    draft_protocol_revisions: z.array(z.string().min(1)).default([]),
    transport: z.literal('STREAMABLE_HTTP'),
    origin_policy: McpOriginPolicyConfigSchema,
    stateful_sessions_enabled: z.literal(false),
    maximum_request_bytes: z.literal(MCP_MAXIMUM_REQUEST_BYTES),
    maximum_structured_response_bytes: z.literal(MCP_MAXIMUM_RESPONSE_BYTES),
    maximum_page_records: z.literal(MCP_MAXIMUM_PAGE_RECORDS),
    prohibit_transaction_capabilities: z.literal(true),
  })
  .strict();

export type McpSecurityConfig = z.infer<typeof McpSecurityConfigSchema>;

export const DEFAULT_MCP_SECURITY_CONFIG: McpSecurityConfig = McpSecurityConfigSchema.parse({
  protocol_baseline: MCP_PROTOCOL_BASELINE,
  mutually_tested_protocol_revisions: [MCP_PROTOCOL_BASELINE],
  draft_protocol_revisions: [],
  transport: 'STREAMABLE_HTTP',
  origin_policy: {
    mode: 'EXACT_ALLOWLIST',
    allowed_origins: [],
    allow_absent_origin_for_registered_non_browser_clients: true,
    allow_null_origin: false,
    trusted_proxy_addresses: [],
  },
  stateful_sessions_enabled: false,
  maximum_request_bytes: MCP_MAXIMUM_REQUEST_BYTES,
  maximum_structured_response_bytes: MCP_MAXIMUM_RESPONSE_BYTES,
  maximum_page_records: MCP_MAXIMUM_PAGE_RECORDS,
  prohibit_transaction_capabilities: true,
});

export function parseMcpSecurityConfig(value: unknown): McpSecurityConfig {
  return McpSecurityConfigSchema.parse(value);
}

export const McpConfigSchema = McpSecurityConfigSchema;
export const DEFAULT_MCP_CONFIG = DEFAULT_MCP_SECURITY_CONFIG;
export const parseMcpConfig = parseMcpSecurityConfig;

/** Public transport-facing spelling retained for the G.13 API contract. */
export const McpServerConfigSchema = z
  .object({
    protocolBaseline: z.literal(MCP_PROTOCOL_BASELINE),
    allowedRevisions: z
      .array(z.string().min(1))
      .min(1)
      .refine(
        (revisions) =>
          revisions.includes(MCP_PROTOCOL_BASELINE) &&
          revisions.every(
            (revision) =>
              revision === MCP_PROTOCOL_BASELINE || /^\d{4}-draft-[a-z0-9.-]+$/i.test(revision),
          ),
        { message: 'allowed revisions must be mutually tested or explicitly opted-in drafts' },
      ),
    transport: z.literal('STREAMABLE_HTTP'),
    originPolicy: z.literal('EXACT_ALLOWLIST'),
    allowedOrigins: z.array(BareOriginSchema).min(1),
    absentOriginPolicy: z.enum(['PRODUCTION', 'NON_PRODUCTION']),
    statefulSessionsEnabled: z.literal(false),
    maximumRequestBytes: z.number().int().positive().max(MCP_MAXIMUM_REQUEST_BYTES),
    maximumResponseBytes: z.number().int().positive().max(MCP_MAXIMUM_RESPONSE_BYTES),
    maximumPageRecords: z.number().int().positive().max(MCP_MAXIMUM_PAGE_RECORDS),
  })
  .strict();

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export function validateMcpConfig(value: unknown): McpServerConfig {
  return McpServerConfigSchema.parse(value);
}
