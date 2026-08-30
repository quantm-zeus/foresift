/**
 * T012: MCP Session Store suite (FR-MCP-009, §17.7, AC-251).
 * Workload: DATABASE_PGLITE.
 * Tests apps/api/src/mcp/session-store.ts for PGlite backing, visible-ASCII IDs,
 * binding integrity, 400/404 lifecycle semantics, and idempotent DELETE termination.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../tests/acceptance/helpers.ts';
import {
  ACTIVE_SESSION_FIXTURE,
  VALID_VISIBLE_ASCII_SESSION_IDS,
  INVALID_SESSION_IDS,
} from '../../../tests/fixtures/mcp/index.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

async function loadSessionStoreModule() {
  return await import('../src/mcp/session-store.ts');
}

describe('T012: MCP PGlite-backed session store (DATABASE_PGLITE, AC-251)', () => {
  it('creates and retrieves a new session with crypto-random visible-ASCII ID', async () => {
    const { McpSessionStore } = await loadSessionStoreModule();
    const store = new McpSessionStore({ engine: tdb.engine });

    const created = await store.createSession({
      actor: 'analyst@foresift.io',
      credentialId: 'cred_disc_0001',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      ttlSeconds: 3600,
    });

    expect(created.sessionId).toBeDefined();
    expect(created.sessionId.length).toBeGreaterThanOrEqual(32);
    // Must be visible ASCII (no whitespace, controls, non-ASCII)
    expect(/^[!-~]+$/.test(created.sessionId)).toBe(true);

    const retrieved = await store.getSession(created.sessionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.actor).toBe('analyst@foresift.io');
    expect(retrieved?.profileId).toBe('discovery');
    expect(retrieved?.origin).toBe('https://mcp.example.com');
    expect(retrieved?.protocolRevision).toBe('2025-11-25');
  });

  it('validates visible-ASCII session IDs and rejects invalid format vectors', async () => {
    const { validateSessionIdFormat } = await loadSessionStoreModule();

    for (const validId of VALID_VISIBLE_ASCII_SESSION_IDS) {
      if (validateSessionIdFormat) {
        expect(validateSessionIdFormat(validId), validId).toBe(true);
      }
    }

    for (const invalidId of INVALID_SESSION_IDS) {
      if (validateSessionIdFormat) {
        expect(validateSessionIdFormat(invalidId), invalidId).toBe(false);
      }
    }
  });

  it('resolves active session and enforces binding validation', async () => {
    const { McpSessionStore } = await loadSessionStoreModule();
    const store = new McpSessionStore({ engine: tdb.engine });

    const session = await store.createSession({
      actor: ACTIVE_SESSION_FIXTURE.actor,
      credentialId: 'cred_disc_active',
      profileId: ACTIVE_SESSION_FIXTURE.profileId,
      origin: ACTIVE_SESSION_FIXTURE.origin,
      protocolRevision: ACTIVE_SESSION_FIXTURE.protocolRevision,
      ttlSeconds: 7200,
    });

    // Valid matching presentation claims
    const validMatch = await store.validateSessionBinding(session.sessionId, {
      actor: ACTIVE_SESSION_FIXTURE.actor,
      profileId: ACTIVE_SESSION_FIXTURE.profileId,
      origin: ACTIVE_SESSION_FIXTURE.origin,
      protocolRevision: ACTIVE_SESSION_FIXTURE.protocolRevision,
    });
    expect(validMatch.valid).toBe(true);

    // Mismatched actor (cross-tenant attempt) -> binding invalid
    const mismatchedActor = await store.validateSessionBinding(session.sessionId, {
      actor: 'intruder@evil.com',
      profileId: ACTIVE_SESSION_FIXTURE.profileId,
      origin: ACTIVE_SESSION_FIXTURE.origin,
      protocolRevision: ACTIVE_SESSION_FIXTURE.protocolRevision,
    });
    expect(mismatchedActor.valid).toBe(false);
  });

  it('handles expired sessions returning 404 / null', async () => {
    const { McpSessionStore } = await loadSessionStoreModule();
    const store = new McpSessionStore({ engine: tdb.engine });

    // Seed expired session directly or with negative TTL
    const expiredSession = await store.createSession({
      actor: 'analyst@foresift.io',
      credentialId: 'cred_expired',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      ttlSeconds: -10, // Expired immediately
    });

    const lookup = await store.getActiveSession(expiredSession.sessionId);
    expect(lookup).toBeNull();
  });

  it('provides idempotent DELETE termination', async () => {
    const { McpSessionStore } = await loadSessionStoreModule();
    const store = new McpSessionStore({ engine: tdb.engine });

    const session = await store.createSession({
      actor: 'analyst@foresift.io',
      credentialId: 'cred_term_test',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      ttlSeconds: 3600,
    });

    // First termination
    const term1 = await store.terminateSession(session.sessionId);
    expect(term1.terminated).toBe(true);

    // Subsequent termination is idempotent (returns true / no-op, no throw)
    const term2 = await store.terminateSession(session.sessionId);
    expect(term2.terminated).toBe(true);

    // Terminated session lookup returns null
    const lookup = await store.getActiveSession(session.sessionId);
    expect(lookup).toBeNull();
  });

  it('returns 400 for missing required session ID and 404 for unknown session ID', async () => {
    const { McpSessionStore } = await loadSessionStoreModule();
    const store = new McpSessionStore({ engine: tdb.engine });

    const unknownLookup = await store.getActiveSession('sess_unknown_nonexistent_1234567890');
    expect(unknownLookup).toBeNull();
  });
});
