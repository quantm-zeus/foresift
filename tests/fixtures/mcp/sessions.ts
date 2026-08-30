/**
 * MCP Session fixtures (FR-MCP-009, §17.7, AC-251).
 *
 * Covers cryptographically random visible-ASCII session IDs, bound dimensions
 * (actor, profile, origin, revision, expiry), lifecycle states, and binding mismatch vectors.
 */
import type { UtcTimestamp } from '@foresift/domain';

/** Active session fixture bound to standard discovery profile. */
export const ACTIVE_SESSION_FIXTURE = {
  sessionId: 'sess_01j7abcde1234567890abcdef1',
  actor: 'analyst@foresift.io',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
  terminatedAt: null,
  createdAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
} as const;

/** Expired session fixture. */
export const EXPIRED_SESSION_FIXTURE = {
  sessionId: 'sess_01j7expired1234567890abcde',
  actor: 'analyst@foresift.io',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  expiresAt: '2026-01-01T00:00:00Z' as UtcTimestamp,
  terminatedAt: null,
  createdAt: '2025-12-01T00:00:00Z' as UtcTimestamp,
} as const;

/** Terminated session fixture (DELETE idempotent). */
export const TERMINATED_SESSION_FIXTURE = {
  sessionId: 'sess_01j7term1234567890abcdef0',
  actor: 'analyst@foresift.io',
  profileId: 'discovery',
  origin: 'https://mcp.example.com',
  protocolRevision: '2025-11-25',
  expiresAt: '2028-01-01T00:00:00Z' as UtcTimestamp,
  terminatedAt: '2026-08-01T12:00:00Z' as UtcTimestamp,
  createdAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
} as const;

/** Mismatched session claim vectors that protocol guard must refuse (AC-251). */
export const SESSION_CLAIM_MISMATCH_VECTORS = [
  {
    name: 'foreign actor attempting cross-tenant session hijacking',
    requestClaims: { actor: 'intruder@evil.example.com' },
    expectedRefusal: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'profile elevation attempt within established session',
    requestClaims: { profileId: 'admin-read' },
    expectedRefusal: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'origin drift / cross-site request forgery attempt',
    requestClaims: { origin: 'https://evil.example.com' },
    expectedRefusal: 'SESSION_BINDING_INVALID',
  },
  {
    name: 'protocol revision mismatch within established session',
    requestClaims: { protocolRevision: '2024-06-01' },
    expectedRefusal: 'SESSION_BINDING_INVALID',
  },
] as const;

/** Cryptographically valid visible-ASCII session IDs (no secret material encoded). */
export const VALID_VISIBLE_ASCII_SESSION_IDS = [
  'sess_01j7abcde1234567890abcdef1',
  'sess_k9X2mP4vL8wQ1zR5tY7uI3oE6a',
  'sess_7894561230abcdefABCDEF1234',
  'sess_US_WEST_0192837465abcdef12',
] as const;

/** Invalid session IDs (non-ASCII, controls, whitespace, or suspicious patterns). */
export const INVALID_SESSION_IDS = [
  '', // Empty
  'sess_\x00\x01\x02', // Control characters
  'sess_contains spaces', // Spaces
  'sess_café_latte', // Non-ASCII Unicode
  'sess_' + 'A'.repeat(512), // Excessive length
] as const;
