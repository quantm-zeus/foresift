/**
 * MCP Session test fixtures (FR-MCP-009, AC-251, PRD §17.7).
 * Session bindings (actor, profileId, origin, protocolRevision, expiry),
 * visible-ASCII cryptographic session IDs, active, expired, terminated,
 * and claim-mismatch session fixtures.
 */

export interface TestMcpSessionFixture {
  readonly sessionId: string;
  readonly actor: string;
  readonly profileId: string;
  readonly origin: string;
  readonly protocolRevision: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly terminatedAt: string | null;
  readonly metadata?: Record<string, unknown>;
}

export const VALID_SESSION_FIXTURES: readonly TestMcpSessionFixture[] = [
  {
    sessionId: 'sess_live_4f9a1c8b2e3d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e',
    actor: 'agent-discovery@example.com',
    profileId: 'discovery',
    origin: 'https://mcp.example.com',
    protocolRevision: '2025-11-25',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T01:00:00Z',
    terminatedAt: null,
  },
  {
    sessionId: 'sess_live_e5d4c3b2a10f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f',
    actor: 'analyst@example.com',
    profileId: 'market-research',
    origin: 'https://api.foresift.io',
    protocolRevision: '2025-11-25',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T02:00:00Z',
    terminatedAt: null,
  },
];

export const EXPIRED_SESSION_FIXTURES: readonly TestMcpSessionFixture[] = [
  {
    sessionId: 'sess_expired_112233445566778899aabbccddeeff00112233445566',
    actor: 'agent-discovery@example.com',
    profileId: 'discovery',
    origin: 'https://mcp.example.com',
    protocolRevision: '2025-11-25',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T00:05:00Z',
    terminatedAt: null,
  },
];

export const TERMINATED_SESSION_FIXTURES: readonly TestMcpSessionFixture[] = [
  {
    sessionId: 'sess_term_aabbccddeeff00112233445566778899aabbccddeeff0011',
    actor: 'agent-discovery@example.com',
    profileId: 'discovery',
    origin: 'https://mcp.example.com',
    protocolRevision: '2025-11-25',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T01:00:00Z',
    terminatedAt: '2026-08-01T00:30:00Z',
  },
];

export const SESSION_CLAIM_MISMATCH_VECTORS = [
  {
    description: 'foreign actor attempting to use session',
    original: VALID_SESSION_FIXTURES[0]!,
    tamperedClaims: { actor: 'attacker@evil.com' },
  },
  {
    description: 'elevated profile requested under standard session',
    original: VALID_SESSION_FIXTURES[0]!,
    tamperedClaims: { profileId: 'admin-full' },
  },
  {
    description: 'origin mismatch against session binding',
    original: VALID_SESSION_FIXTURES[0]!,
    tamperedClaims: { origin: 'https://evil.com' },
  },
  {
    description: 'incompatible protocol revision under session',
    original: VALID_SESSION_FIXTURES[0]!,
    tamperedClaims: { protocolRevision: '2024-01-01' },
  },
] as const;

export const MALFORMED_SESSION_IDS = [
  '',
  ' ',
  'sess_\0evil',
  'sess_with spaces',
  'sess_non_ascii_unicode_🚀_test',
  'sess_containing_secret:sk-live-1234567890',
  '../relative/session/path',
] as const;
