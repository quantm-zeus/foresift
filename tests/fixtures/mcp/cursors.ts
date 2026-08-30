/**
 * MCP Resumable Cursor fixtures (FR-MCP-003, FR-MCP-009, §17.4, AC-251).
 *
 * Covers resumable-event ownership, pagination state, and cursor tamper vectors.
 */
import type { UtcTimestamp } from '@foresift/domain';

/** Valid authorized resumable cursor owned by an active session. */
export const VALID_AUTHORIZED_CURSOR = {
  cursor: 'cur_page_001_seq_100_tok_abc',
  sessionId: 'sess_01j7abcde1234567890abcdef1',
  actor: 'analyst@foresift.io',
  toolName: 'discover_candidates',
  offset: 100,
  pageSize: 50,
  issuedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
  expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
  authorized: true,
} as const;

/** Valid cursor inspection input admitted by protocol guard. */
export const VALID_CURSOR_INSPECTION = {
  cursor: 'cur_page_001_seq_100_tok_abc',
  authorized: true,
} as const;

/** Unauthorized cursor inspection input refused by protocol guard. */
export const UNAUTHORIZED_CURSOR_INSPECTION = {
  cursor: 'cur_page_001_seq_100_tok_abc',
  authorized: false,
} as const;

/** Cursor attack / tamper vectors. */
export const CURSOR_ATTACK_VECTORS = [
  {
    name: 'cross-session cursor replay attempt',
    cursor: 'cur_session_other_user_page_2',
    sessionId: 'sess_attacker_different_id_001',
    authorized: false,
    expectedRefusal: 'CURSOR_UNAUTHORIZED',
  },
  {
    name: 'forged pagination offset out of bounds',
    cursor: 'cur_forged_offset_negative_999',
    sessionId: 'sess_01j7abcde1234567890abcdef1',
    authorized: false,
    expectedRefusal: 'CURSOR_UNAUTHORIZED',
  },
  {
    name: 'expired resumable stream cursor',
    cursor: 'cur_expired_2025_01_01',
    sessionId: 'sess_01j7abcde1234567890abcdef1',
    authorized: false,
    expectedRefusal: 'CURSOR_UNAUTHORIZED',
  },
] as const;
