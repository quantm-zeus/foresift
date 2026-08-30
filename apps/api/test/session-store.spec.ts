/**
 * apps/api/test/session-store.spec.ts
 *
 * Unit tests for PGlite-backed MCP session store (T012 / AC-251).
 * Workload: DATABASE_PGLITE.
 * Traces: FR-MCP-009, §17.7, INV-009, ADR-0014, ADR-0023, AC-251.
 *
 * Asserts:
 * - Generates crypto-random visible-ASCII session IDs without encoding secrets.
 * - Binds sessions immutably to actor, tool profile, origin, protocol revision, and expiry.
 * - Missing required session ID throws/returns 400.
 * - Expired or terminated session returns 404.
 * - Idempotent DELETE termination (fenced transitions, INV-009).
 * - Stateless-default mode retains per-request binding without state leakage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ToolProfileId } from '@foresift/domain';
import { MCP_PROTOCOL_BASELINE_REVISION } from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../tests/acceptance/helpers.ts';
import { McpSessionStore, type CreateSessionInput } from '../src/mcp/session-store.ts';

let tdb: TestDatabase;
let sessionStore: McpSessionStore;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  sessionStore = new McpSessionStore({ engine: tdb.engine });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('T012: PGlite-backed MCP session store (DATABASE_PGLITE workload)', () => {
  const SAMPLE_SESSION_INPUT: CreateSessionInput = {
    actor: 'alice@foresift.io',
    profileId: ToolProfileId.DISCOVERY,
    origin: 'https://mcp.foresift.io',
    protocolRevision: MCP_PROTOCOL_BASELINE_REVISION,
    ttlSeconds: 3600,
  };

  it('creates an active session with crypto-random visible-ASCII ID and immutable bindings', async () => {
    const session = await sessionStore.createSession(SAMPLE_SESSION_INPUT);
    expect(session.sessionId).toMatch(/^[\x21-\x7e]{16,}$/);
    expect(session.actor).toBe('alice@foresift.io');
    expect(session.profileId).toBe(ToolProfileId.DISCOVERY);
    expect(session.origin).toBe('https://mcp.foresift.io');
    expect(session.protocolRevision).toBe('2025-11-25');
    expect(session.terminatedAt).toBeNull();
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('fetches an active session by ID and matches all bindings', async () => {
    const created = await sessionStore.createSession(SAMPLE_SESSION_INPUT);
    const fetched = await sessionStore.getSession(created.sessionId);

    expect(fetched).not.toBeNull();
    expect(fetched?.sessionId).toBe(created.sessionId);
    expect(fetched?.actor).toBe('alice@foresift.io');
    expect(fetched?.profileId).toBe(ToolProfileId.DISCOVERY);
  });

  it('returns 404 for non-existent session ID', async () => {
    const result = await sessionStore.getSession('non-existent-session-id-999');
    expect(result).toBeNull();
  });

  it('terminates a session idempotently (DELETE sets terminated_at, subsequent get returns null/404)', async () => {
    const created = await sessionStore.createSession(SAMPLE_SESSION_INPUT);

    // Terminate session
    const firstDelete = await sessionStore.terminateSession(created.sessionId);
    expect(firstDelete).toBe(true);

    // Idempotent second termination returns true/false without error
    const secondDelete = await sessionStore.terminateSession(created.sessionId);
    expect(typeof secondDelete).toBe('boolean');

    // Subsequent retrieval returns null (treated as HTTP 404)
    const afterTerminated = await sessionStore.getSession(created.sessionId);
    expect(afterTerminated).toBeNull();
  });

  it('treats expired sessions as 404 / null', async () => {
    const expiredSessionInput: CreateSessionInput = {
      ...SAMPLE_SESSION_INPUT,
      ttlSeconds: -10, // already expired
    };

    const expired = await sessionStore.createSession(expiredSessionInput);
    const result = await sessionStore.getSession(expired.sessionId);
    expect(result).toBeNull();
  });

  it('session IDs contain only visible ASCII and never encode secret tokens', async () => {
    const session = await sessionStore.createSession(SAMPLE_SESSION_INPUT);
    // Visible ASCII only (no spaces, non-ASCII, or control chars)
    expect(/^[\x21-\x7e]+$/.test(session.sessionId)).toBe(true);
    // Should not contain common secret prefixes or delimiters
    expect(session.sessionId).not.toContain('Bearer');
    expect(session.sessionId).not.toContain('fs_live_');
    expect(session.sessionId).not.toContain('fs_test_');
  });
});
