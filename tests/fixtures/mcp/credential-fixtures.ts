/**
 * MCP Credential test fixtures (FR-MCP-004, FR-MCP-005; AC-052, AC-053).
 * Known HMAC test peppers, >=256-bit entropy bearer API keys,
 * strict presentation context vectors, revoked/expired states.
 */

export interface TestMcpCredential {
  readonly keyId: string;
  readonly keyPrefix: string;
  readonly secretKey: string;
  readonly actor: string;
  readonly profileId: string;
  readonly scopes: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly allowedIps: readonly string[];
  readonly rateLimitRps: number;
  readonly concurrencyCap: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

/** Known fixed HMAC test peppers for deterministic testing (never production secrets). */
export const KNOWN_TEST_PEPPERS = {
  primary: 'test-mcp-pepper-sha256-constant-seed-2026-auth-0000000000000000000000000001',
  secondary: 'test-mcp-pepper-sha256-constant-seed-2026-auth-0000000000000000000000000002',
} as const;

/** Standard 256-bit entropy bearer API keys for testing. */
export const TEST_BEARER_CREDENTIALS: Record<string, TestMcpCredential> = {
  standardDiscovery: {
    keyId: 'cred-mcp-disc-001',
    keyPrefix: 'fs_live_disc_',
    secretKey: 'fs_live_disc_9f8e7d6c5b4a3928170f1e2d3c4b5a69788796a5b4c3d2e1f0e9d8c7b6a50001',
    actor: 'actor-discovery-user@example.com',
    profileId: 'discovery',
    scopes: ['tools:execute', 'discovery:read'],
    allowedOrigins: ['https://mcp.example.com', 'https://app.foresift.io'],
    allowedIps: ['192.168.1.100', '10.0.0.1'],
    rateLimitRps: 10,
    concurrencyCap: 2,
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    revokedAt: null,
  },
  marketResearch: {
    keyId: 'cred-mcp-res-002',
    keyPrefix: 'fs_live_res_',
    secretKey: 'fs_live_res_8e7d6c5b4a3928170f1e2d3c4b5a69788796a5b4c3d2e1f0e9d8c7b6a5f40002',
    actor: 'actor-research-analyst@example.com',
    profileId: 'market-research',
    scopes: ['tools:execute', 'research:read', 'evidence:read'],
    allowedOrigins: ['https://mcp.example.com'],
    allowedIps: ['192.168.1.101'],
    rateLimitRps: 20,
    concurrencyCap: 4,
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    revokedAt: null,
  },
  revokedClient: {
    keyId: 'cred-mcp-rev-003',
    keyPrefix: 'fs_live_rev_',
    secretKey: 'fs_live_rev_7d6c5b4a3928170f1e2d3c4b5a69788796a5b4c3d2e1f0e9d8c7b6a5f4e30003',
    actor: 'actor-compromised@example.com',
    profileId: 'discovery',
    scopes: ['tools:execute'],
    allowedOrigins: ['https://mcp.example.com'],
    allowedIps: ['192.168.1.102'],
    rateLimitRps: 5,
    concurrencyCap: 1,
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    revokedAt: '2026-08-02T12:00:00Z',
  },
  expiredClient: {
    keyId: 'cred-mcp-exp-004',
    keyPrefix: 'fs_live_exp_',
    secretKey: 'fs_live_exp_6c5b4a3928170f1e2d3c4b5a69788796a5b4c3d2e1f0e9d8c7b6a5f4e3d20004',
    actor: 'actor-expired@example.com',
    profileId: 'discovery',
    scopes: ['tools:execute'],
    allowedOrigins: ['https://mcp.example.com'],
    allowedIps: ['192.168.1.103'],
    rateLimitRps: 5,
    concurrencyCap: 1,
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-06-01T00:00:00Z',
    revokedAt: null,
  },
};

/** Presentation context fixtures for strict presentation validation. */
export const VALID_PRESENTATION_CONTEXT = {
  sourceIp: '192.168.1.100',
  origin: 'https://mcp.example.com',
  requestedScopes: ['tools:execute', 'discovery:read'],
};

export const INVALID_PRESENTATION_CONTEXTS = [
  {
    context: {
      sourceIp: '198.51.100.1', // Unapproved IP
      origin: 'https://mcp.example.com',
      requestedScopes: ['tools:execute'],
    },
    reason: 'IP_NOT_PERMITTED',
  },
  {
    context: {
      sourceIp: '192.168.1.100',
      origin: 'https://unauthorized-origin.com', // Origin not in credential policy
      requestedScopes: ['tools:execute'],
    },
    reason: 'ORIGIN_NOT_PERMITTED',
  },
  {
    context: {
      sourceIp: '192.168.1.100',
      origin: 'https://mcp.example.com',
      requestedScopes: ['admin:high:execute'], // Scope exceeding granted credential scopes
    },
    reason: 'SCOPE_EXCEEDED',
  },
];
