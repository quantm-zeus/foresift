/**
 * MCP Credential fixtures (FR-MCP-004, FR-MCP-005, AC-052, AC-053, AC-250).
 *
 * Provides credential seeds, known HMAC test peppers, prefix-only identification,
 * per-client profile bindings, rate limits, and revocation/expiry fixtures.
 */

/**
 * Fixed test pepper used for HMAC-SHA256 credential hashing in tests.
 * NEVER used in production; exactly 32 bytes (256 bits).
 */
export const MCP_TEST_PEPPER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface McpCredentialSeed {
  readonly actor: string;
  readonly keyPrefix: string;
  readonly rawSecret: string;
  readonly profileId: string;
  readonly allowedScopes: readonly string[];
  readonly originPolicy: 'EXACT_ALLOWLIST' | 'NON_PRODUCTION';
  readonly allowedOrigins: readonly string[];
  readonly quotaTier: 'STRICT_FREE' | 'COMMERCIAL';
  readonly rateLimitPerMinute: number;
  readonly concurrencyCap: number;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

/** Standard valid discovery profile client credential seed. */
export const CREDENTIAL_DISCOVERY_CLIENT: McpCredentialSeed = {
  actor: 'actor_discovery_01@foresift.internal',
  keyPrefix: 'fs_live_disc01',
  rawSecret: 'fs_live_disc01_secret_99999999999999999999999999999999',
  profileId: 'discovery',
  allowedScopes: ['tools:read', 'tools:execute', 'resources:read'],
  originPolicy: 'EXACT_ALLOWLIST',
  allowedOrigins: ['https://mcp.foresift.internal'],
  quotaTier: 'STRICT_FREE',
  rateLimitPerMinute: 60,
  concurrencyCap: 4,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-12-31T23:59:59Z',
};

/** Market research profile client credential seed. */
export const CREDENTIAL_RESEARCH_CLIENT: McpCredentialSeed = {
  actor: 'actor_research_01@foresift.internal',
  keyPrefix: 'fs_live_res01',
  rawSecret: 'fs_live_res01_secret_88888888888888888888888888888888',
  profileId: 'market-research',
  allowedScopes: ['tools:read', 'tools:execute', 'resources:read', 'prompts:read'],
  originPolicy: 'EXACT_ALLOWLIST',
  allowedOrigins: ['https://mcp.foresift.internal', 'https://partner.agent-gateway.io'],
  quotaTier: 'COMMERCIAL',
  rateLimitPerMinute: 120,
  concurrencyCap: 8,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-12-31T23:59:59Z',
};

/** Admin/diagnostic profile client credential seed. */
export const CREDENTIAL_ADMIN_CLIENT: McpCredentialSeed = {
  actor: 'actor_admin_01@foresift.internal',
  keyPrefix: 'fs_live_adm01',
  rawSecret: 'fs_live_adm01_secret_77777777777777777777777777777777',
  profileId: 'admin-diagnostic',
  allowedScopes: ['tools:read', 'tools:execute', 'resources:read', 'prompts:read', 'admin:diagnostics'],
  originPolicy: 'EXACT_ALLOWLIST',
  allowedOrigins: ['https://mcp.foresift.internal'],
  quotaTier: 'COMMERCIAL',
  rateLimitPerMinute: 300,
  concurrencyCap: 16,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-12-31T23:59:59Z',
};

/** Revoked credential seed for testing immediate revocation enforcement. */
export const CREDENTIAL_REVOKED_CLIENT: McpCredentialSeed = {
  actor: 'actor_revoked_01@foresift.internal',
  keyPrefix: 'fs_live_rev01',
  rawSecret: 'fs_live_rev01_secret_00000000000000000000000000000000',
  profileId: 'discovery',
  allowedScopes: ['tools:read', 'tools:execute'],
  originPolicy: 'EXACT_ALLOWLIST',
  allowedOrigins: ['https://mcp.foresift.internal'],
  quotaTier: 'STRICT_FREE',
  rateLimitPerMinute: 60,
  concurrencyCap: 4,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-12-31T23:59:59Z',
  revokedAt: '2026-08-15T12:00:00Z',
};

/** Expired credential seed for testing expired credential rejection. */
export const CREDENTIAL_EXPIRED_CLIENT: McpCredentialSeed = {
  actor: 'actor_expired_01@foresift.internal',
  keyPrefix: 'fs_live_exp01',
  rawSecret: 'fs_live_exp01_secret_11111111111111111111111111111111',
  profileId: 'discovery',
  allowedScopes: ['tools:read', 'tools:execute'],
  originPolicy: 'EXACT_ALLOWLIST',
  allowedOrigins: ['https://mcp.foresift.internal'],
  quotaTier: 'STRICT_FREE',
  rateLimitPerMinute: 60,
  concurrencyCap: 4,
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: '2026-06-01T00:00:00Z',
};

/** Malformed or invalid credential tokens for negative testing. */
export const INVALID_CREDENTIAL_TOKENS = {
  SHORT_ENTROPY: 'fs_live_short',
  UNPREFIXED: 'bearer_token_without_proper_foresift_prefix_0123456789',
  CORRUPTED_SECRET: 'fs_live_disc01_secret_corrupted_signature_ffffffffffffffff',
  EMPTY: '',
  BEARER_MALFORMED: 'Basic fs_live_disc01_secret_99999999999999999999999999999999',
} as const;
