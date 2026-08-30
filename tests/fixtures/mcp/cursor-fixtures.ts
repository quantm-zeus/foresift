/**
 * MCP Resumable and Pagination Cursor test fixtures (FR-MCP-003, FR-MCP-009; AC-144, AC-251).
 * Valid opaque cursors, HMAC-authenticated stream cursors, session-bound ownership,
 * and tampered / unauthorized / expired cursor vectors.
 */

export interface TestCursor {
  readonly cursor: string;
  readonly sessionId: string;
  readonly actor: string;
  readonly sequence: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly authorized: boolean;
}

export const VALID_RESUMABLE_CURSOR: TestCursor = {
  cursor: 'cur_res_01h7x8k2v4m9n3p5q6r8s9t0u1_seq_00000042_sig_abcdef0123456789',
  sessionId: 'sess_mcp_pub_01h7x8k2v4m9n3p5q6r8s9t0u1',
  actor: 'actor-discovery-user@example.com',
  sequence: 42,
  issuedAt: '2026-08-01T00:00:00Z',
  expiresAt: '2026-08-01T01:00:00Z',
  authorized: true,
};

export const UNAUTHORIZED_CURSOR_VECTORS = [
  {
    name: 'foreign session ownership',
    cursor: {
      cursor: 'cur_res_foreign_session_seq_00000042',
      authorized: false,
    },
    expectedReason: 'CURSOR_UNAUTHORIZED',
  },
  {
    name: 'tampered signature cursor',
    cursor: {
      cursor: 'cur_res_01h7x8k2v4m9n3p5q6r8s9t0u1_seq_00000099_sig_tampered_invalid',
      authorized: false,
    },
    expectedReason: 'CURSOR_UNAUTHORIZED',
  },
  {
    name: 'expired cursor',
    cursor: {
      cursor: 'cur_res_expired_01h7x8k2v4m9n3p5q6r8s9t0u1_seq_00000001',
      authorized: false,
    },
    expectedReason: 'CURSOR_UNAUTHORIZED',
  },
];

export const VALID_PAGINATION_CURSORS = {
  firstPage: {
    cursor: null,
    limit: 50,
    hasMore: true,
    nextCursor: 'cur_page_00000050_token_solana_discovery',
  },
  secondPage: {
    cursor: 'cur_page_00000050_token_solana_discovery',
    limit: 50,
    hasMore: false,
    nextCursor: null,
  },
  maxPageSize: 100, // §29.4 cap: 100-record page
};
