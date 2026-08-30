/**
 * MCP Credential test fixtures (FR-MCP-004, FR-MCP-005, AC-052, AC-053, PRD §17.5).
 * Bearer tokens (≥256-bit entropy), HMAC-SHA256 test peppers, prefix identification,
 * client scopes, tool profiles, quota bindings, and lifecycle states (active/revoked/expired).
 */
import type { ToolProfileId } from '@foresift/domain';

/** Known server-side HMAC pepper for deterministic test runs (never production secrets). */
export const TEST_HMAC_PEPPER = 'test-pepper-foresift-mcp-known-seed-32bytes-min';

export interface TestMcpCredentialSeed {
  readonly clientId: string;
  readonly actor: string;
  readonly rawSecret: string;
  readonly prefix: string;
  readonly profileId: ToolProfileId;
  readonly allowedScopes: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly rateLimitRps: number;
  readonly concurrencyLimit: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string | null;
  readonly revocationReason?: string | null;
}

export const VALID_BEARER_SEEDS: readonly TestMcpCredentialSeed[] = [
  {
    clientId: 'client-discovery-001',
    actor: 'agent-discovery@example.com',
    rawSecret: 'fs_mcp_live_sec_0123456789abcdef0123456789abcdef0123456789abcdef',
    prefix: 'fs_mcp_live_sec_0123',
    profileId: 'discovery',
    allowedScopes: ['mcp:tools:read', 'mcp:tools:call', 'discovery:read'],
    allowedOrigins: ['https://mcp.example.com', 'https://api.foresift.io'],
    rateLimitRps: 10,
    concurrencyLimit: 2,
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    revokedAt: null,
  },
  {
    clientId: 'client-research-002',
    actor: 'analyst@example.com',
    rawSecret: 'fs_mcp_live_sec_fedcba9876543210fedcba9876543210fedcba9876543210',
    prefix: 'fs_mcp_live_sec_fedc',
    profileId: 'market-research',
    allowedScopes: ['mcp:tools:read', 'mcp:tools:call', 'research:read', 'evidence:read'],
    allowedOrigins: ['https://mcp.example.com'],
    rateLimitRps: 25,
    concurrencyLimit: 5,
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    revokedAt: null,
  },
  {
    clientId: 'client-diagnostic-003',
    actor: 'expert-oncall@example.com',
    rawSecret: 'fs_mcp_live_sec_aabbccddeeff00112233445566778899aabbccddeeff0011',
    prefix: 'fs_mcp_live_sec_aabb',
    profileId: 'admin-read',
    allowedScopes: ['mcp:tools:read', 'mcp:tools:call', 'diagnostic:read', 'providers:probe'],
    allowedOrigins: ['https://agent.foresift.internal:8443'],
    rateLimitRps: 50,
    concurrencyLimit: 10,
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    revokedAt: null,
  },
];

export const REVOKED_CREDENTIAL_SEEDS: readonly TestMcpCredentialSeed[] = [
  {
    clientId: 'client-revoked-004',
    actor: 'compromised-agent@example.com',
    rawSecret: 'fs_mcp_live_sec_99887766554433221100ffeeddccbbaa9988776655443322',
    prefix: 'fs_mcp_live_sec_9988',
    profileId: 'discovery',
    allowedScopes: ['mcp:tools:read', 'mcp:tools:call'],
    allowedOrigins: ['https://mcp.example.com'],
    rateLimitRps: 10,
    concurrencyLimit: 2,
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-12-31T23:59:59Z',
    revokedAt: '2026-08-15T12:00:00Z',
    revocationReason: 'KEY_ROTATION_SECURITY_INCIDENT',
  },
];

export const EXPIRED_CREDENTIAL_SEEDS: readonly TestMcpCredentialSeed[] = [
  {
    clientId: 'client-expired-005',
    actor: 'stale-agent@example.com',
    rawSecret: 'fs_mcp_live_sec_11223344556677889900aabbccddeeff1122334455667788',
    prefix: 'fs_mcp_live_sec_1122',
    profileId: 'discovery',
    allowedScopes: ['mcp:tools:read', 'mcp:tools:call'],
    allowedOrigins: ['https://mcp.example.com'],
    rateLimitRps: 10,
    concurrencyLimit: 2,
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-06-01T00:00:00Z',
    revokedAt: null,
  },
];

export const LOW_ENTROPY_CREDENTIALS = [
  'short',
  'fs_mcp_short',
  '12345',
  'password123',
  'fs_mcp_live_only16chars',
] as const;

export const MALFORMED_AUTH_HEADERS = [
  'Basic dXNlcjpwYXNz',
  'Token abc123',
  'Bearer ',
  'bearer',
  'Bearer not-a-valid-token-format',
  'Bearer fs_mcp_invalid_structure_no_entropy',
] as const;
