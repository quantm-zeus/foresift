/**
 * MCP Session fixtures (FR-MCP-009, PRD §17.7, AC-251).
 *
 * Provides valid bound session fixtures, stateful/stateless session descriptors,
 * expired/terminated sessions, and foreign session claim vectors.
 */

export interface McpSessionFixture {
  readonly sessionId: string;
  readonly actor: string;
  readonly profileId: string;
  readonly origin: string;
  readonly protocolRevision: string;
  readonly stateful: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly terminatedAt?: string;
}

/** Standard valid stateless session bound to discovery actor. */
export const SESSION_DISCOVERY_STATELESS: McpSessionFixture = {
  sessionId: 'sess_disc_0123456789abcdef01234567',
  actor: 'actor_discovery_01@foresift.internal',
  profileId: 'discovery',
  origin: 'https://mcp.foresift.internal',
  protocolRevision: '2025-11-25',
  stateful: false,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-08-01T01:00:00Z',
};

/** Valid stateful session bound to research actor. */
export const SESSION_RESEARCH_STATEFUL: McpSessionFixture = {
  sessionId: 'sess_res_abcdef0123456789abcdef01',
  actor: 'actor_research_01@foresift.internal',
  profileId: 'market-research',
  origin: 'https://mcp.foresift.internal',
  protocolRevision: '2025-11-25',
  stateful: true,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-08-01T02:00:00Z',
};

/** Expired session fixture. */
export const SESSION_EXPIRED: McpSessionFixture = {
  sessionId: 'sess_exp_999999999999999999999999',
  actor: 'actor_discovery_01@foresift.internal',
  profileId: 'discovery',
  origin: 'https://mcp.foresift.internal',
  protocolRevision: '2025-11-25',
  stateful: false,
  createdAt: '2026-07-01T00:00:00Z',
  expiresAt: '2026-07-01T01:00:00Z',
};

/** Terminated session fixture (e.g. after idempotent DELETE). */
export const SESSION_TERMINATED: McpSessionFixture = {
  sessionId: 'sess_term_888888888888888888888888',
  actor: 'actor_discovery_01@foresift.internal',
  profileId: 'discovery',
  origin: 'https://mcp.foresift.internal',
  protocolRevision: '2025-11-25',
  stateful: true,
  createdAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-08-01T01:00:00Z',
  terminatedAt: '2026-08-01T00:15:00Z',
};

/** Foreign/mismatched claim test vectors for session binding validation. */
export const SESSION_MISMATCH_VECTORS = [
  {
    name: 'ACTOR_MISMATCH',
    session: SESSION_DISCOVERY_STATELESS,
    presentedClaim: { actor: 'attacker_impersonator@evil.com' },
    expectedDecision: 'REFUSE',
    expectedReason: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'PROFILE_MISMATCH',
    session: SESSION_DISCOVERY_STATELESS,
    presentedClaim: { profileId: 'admin-diagnostic' },
    expectedDecision: 'REFUSE',
    expectedReason: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'ORIGIN_MISMATCH',
    session: SESSION_DISCOVERY_STATELESS,
    presentedClaim: { origin: 'https://evil.example.com' },
    expectedDecision: 'REFUSE',
    expectedReason: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'PROTOCOL_REVISION_MISMATCH',
    session: SESSION_DISCOVERY_STATELESS,
    presentedClaim: { protocolRevision: '2024-01-01' },
    expectedDecision: 'REFUSE',
    expectedReason: 'SESSION_BINDING_INVALID',
  },
] as const;
