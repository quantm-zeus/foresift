/**
 * MCP Resumable Cursor fixtures (FR-MCP-009, PRD §17.4, AC-251).
 *
 * Provides valid and invalid resumable cursor descriptors for event stream
 * resumption and pagination ownership checks.
 */

export interface McpCursorFixture {
  readonly cursor: string;
  readonly runId: string;
  readonly sequenceNumber: number;
  readonly actor: string;
  readonly sessionId: string;
  readonly authorized: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Valid resumable cursor owned by discovery actor session. */
export const CURSOR_DISCOVERY_PAGE_1: McpCursorFixture = {
  cursor: 'cur_disc_run001_seq010',
  runId: 'run_disc_001',
  sequenceNumber: 10,
  actor: 'actor_discovery_01@foresift.internal',
  sessionId: 'sess_disc_0123456789abcdef01234567',
  authorized: true,
  createdAt: '2026-08-01T00:00:10Z',
  expiresAt: '2026-08-01T01:00:00Z',
};

/** Second page cursor in the same run. */
export const CURSOR_DISCOVERY_PAGE_2: McpCursorFixture = {
  cursor: 'cur_disc_run001_seq020',
  runId: 'run_disc_001',
  sequenceNumber: 20,
  actor: 'actor_discovery_01@foresift.internal',
  sessionId: 'sess_disc_0123456789abcdef01234567',
  authorized: true,
  createdAt: '2026-08-01T00:00:20Z',
  expiresAt: '2026-08-01T01:00:00Z',
};

/** Unauthorized cursor (e.g. cross-tenant or foreign actor replay attempt). */
export const CURSOR_UNAUTHORIZED_FOREIGN: McpCursorFixture = {
  cursor: 'cur_foreign_run999_seq005',
  runId: 'run_foreign_999',
  sequenceNumber: 5,
  actor: 'foreign_tenant_actor@external.com',
  sessionId: 'sess_foreign_99999999999999999999',
  authorized: false,
  createdAt: '2026-08-01T00:00:05Z',
  expiresAt: '2026-08-01T01:00:00Z',
};

/** Expired cursor. */
export const CURSOR_EXPIRED: McpCursorFixture = {
  cursor: 'cur_expired_run000_seq001',
  runId: 'run_past_000',
  sequenceNumber: 1,
  actor: 'actor_discovery_01@foresift.internal',
  sessionId: 'sess_disc_0123456789abcdef01234567',
  authorized: true,
  createdAt: '2026-07-01T00:00:00Z',
  expiresAt: '2026-07-01T00:30:00Z',
};
