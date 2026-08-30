/**
 * MCP Resumable Cursor test fixtures (FR-MCP-009, AC-251, PRD §17.4, §29.4).
 * Valid cursors with sequence numbers, expired cursors, foreign actor cursors,
 * unauthorized cursors, and malformed cursors.
 */

export interface TestMcpCursorFixture {
  readonly cursor: string;
  readonly runId: string;
  readonly sequenceNumber: number;
  readonly actor: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly authorized: boolean;
}

export const VALID_RESUMABLE_CURSORS: readonly TestMcpCursorFixture[] = [
  {
    cursor: 'cur_run101_seq001_8a7f6e5d4c3b2a10',
    runId: 'run-discovery-101',
    sequenceNumber: 1,
    actor: 'agent-discovery@example.com',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T01:00:00Z',
    authorized: true,
  },
  {
    cursor: 'cur_run101_seq010_1a2b3c4d5e6f7a8b',
    runId: 'run-discovery-101',
    sequenceNumber: 10,
    actor: 'agent-discovery@example.com',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T01:00:00Z',
    authorized: true,
  },
  {
    cursor: 'cur_res202_seq050_9f8e7d6c5b4a3f2e',
    runId: 'run-research-202',
    sequenceNumber: 50,
    actor: 'analyst@example.com',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T02:00:00Z',
    authorized: true,
  },
];

export const UNAUTHORIZED_CURSORS: readonly TestMcpCursorFixture[] = [
  {
    cursor: 'cur_run101_seq001_unauthorized_token',
    runId: 'run-discovery-101',
    sequenceNumber: 1,
    actor: 'attacker@evil.com',
    createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-08-01T01:00:00Z',
    authorized: false,
  },
];

export const EXPIRED_CURSORS: readonly TestMcpCursorFixture[] = [
  {
    cursor: 'cur_run099_seq005_expired_token',
    runId: 'run-discovery-099',
    sequenceNumber: 5,
    actor: 'agent-discovery@example.com',
    createdAt: '2026-07-01T00:00:00Z',
    expiresAt: '2026-07-01T01:00:00Z',
    authorized: false,
  },
];

export const MALFORMED_CURSORS = [
  '',
  ' ',
  'not_a_cursor',
  'cur_invalid::format',
  'cur_tampered\x00byte',
  '../../../etc/cursor',
] as const;
