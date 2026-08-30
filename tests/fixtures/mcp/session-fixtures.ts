/**
 * MCP Session test fixtures (FR-MCP-009; AC-251).
 * Cryptographically random visible-ASCII session IDs, bound actor/profile/origin/revision/expiry,
 * matching/mismatching claims, expired and terminated session states.
 */

export interface TestMcpSession {
  readonly sessionId: string;
  readonly actor: string;
  readonly profileId: string;
  readonly origin: string;
  readonly protocolRevision: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly terminatedAt: string | null;
}

export const VALID_SESSION_FIXTURE: TestMcpSession = {
  sessionId: 'sess_mcp_pub_01h7x8k2v4m9n3p5q6r8s9t0u1',
  actor: 'actor-discovery-user@example.com',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-08-01T01:00:00Z',
  terminatedAt: null,
};

export const EXPIRED_SESSION_FIXTURE: TestMcpSession = {
  sessionId: 'sess_mcp_exp_01h7x8k2v4m9n3p5q6r8s9t0u2',
  actor: 'actor-discovery-user@example.com',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  createdAt: '2026-07-01T00:00:00Z',
  expiresAt: '2026-07-01T01:00:00Z',
  terminatedAt: null,
};

export const TERMINATED_SESSION_FIXTURE: TestMcpSession = {
  sessionId: 'sess_mcp_term_01h7x8k2v4m9n3p5q6r8s9t0u3',
  actor: 'actor-discovery-user@example.com',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-08-01T01:00:00Z',
  terminatedAt: '2026-08-01T00:15:00Z',
};

/** Session binding mismatch test cases for McpProtocolGuard.inspect() */
export const SESSION_BINDING_MISMATCH_CASES = [
  {
    name: 'mismatched actor',
    requestClaims: { actor: 'foreign-actor@example.com' },
    session: VALID_SESSION_FIXTURE,
    expectedReason: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'mismatched profileId',
    requestClaims: { profileId: 'admin-high' },
    session: VALID_SESSION_FIXTURE,
    expectedReason: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'mismatched origin',
    requestClaims: { origin: 'https://unbound-origin.example.com' },
    session: VALID_SESSION_FIXTURE,
    expectedReason: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'mismatched protocolRevision',
    requestClaims: { protocolRevision: '2026-01-01' },
    session: VALID_SESSION_FIXTURE,
    expectedReason: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'request claims without session',
    requestClaims: { actor: 'actor-discovery-user@example.com' },
    session: undefined,
    expectedReason: 'SESSION_BINDING_INVALID',
  },
];

/** Malformed / non-conforming session ID vectors */
export const MALFORMED_SESSION_ID_VECTORS: readonly string[] = [
  '', // empty string
  'sess with spaces', // spaces
  'sess\nwith\nnewlines', // control characters
  'sess_non_ascii_🔒_key', // non-ASCII emojis
  'sess\x00nullbyte', // null byte
  '../path-traversal-session-id', // path confusion attempt
  'a'.repeat(512), // excessive length (>256 chars)
];
