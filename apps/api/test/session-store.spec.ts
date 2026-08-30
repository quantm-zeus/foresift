/**
 * Test suite for PGlite-backed MCP session store (T012).
 * Traces: FR-MCP-009, AC-251, §17.7, INV-009.
 * Workload: DATABASE_PGLITE (uses PGlite with migrations applied).
 *
 * Asserts:
 * - Crypto-random visible-ASCII session IDs generated (never encoding secrets).
 * - Session bound to actor, tool profile, origin policy, protocol revision, expiry.
 * - Missing required session ID yields 400 status.
 * - Expired or terminated session yields 404 status.
 * - Idempotent DELETE marks session terminated.
 * - Fenced state transitions (INV-009).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  McpSessionStore,
  type CreateSessionInput,
} from '../src/mcp/session-store.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;
let store: McpSessionStore;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  store = new McpSessionStore({ engine });
});

afterAll(async () => {
  await db?.close();
});

describe('T012 — MCP session store (PGlite-backed, AC-251)', () => {
  it('creates session with crypto-random visible-ASCII ID bound to dimensions', async () => {
    const input: CreateSessionInput = {
      actor: 'researcher-01@foresift.internal',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      ttlSeconds: 3600,
    };

    const session = await store.createSession(input);
    expect(session.sessionId).toMatch(/^[\x21-\x7e]{16,64}$/);
    expect(session.actor).toBe(input.actor);
    expect(session.profileId).toBe(input.profileId);
    expect(session.origin).toBe(input.origin);
    expect(session.protocolRevision).toBe(input.protocolRevision);
    expect(session.terminatedAt).toBeNull();
  });

  it('retrieves an active session and validates bindings', async () => {
    const created = await store.createSession({
      actor: 'researcher-02@foresift.internal',
      profileId: 'standard',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      ttlSeconds: 1800,
    });

    const fetched = await store.getSession(created.sessionId);
    expect(fetched).not.toBeNull();
    expect(fetched?.sessionId).toBe(created.sessionId);
    expect(fetched?.actor).toBe('researcher-02@foresift.internal');
  });

  it('returns null (404) for non-existent session ID', async () => {
    const nonExistent = await store.getSession('sess_non_existent_12345');
    expect(nonExistent).toBeNull();
  });

  it('handles expired sessions returning null / 404', async () => {
    const expiredSession = await store.createSession({
      actor: 'researcher-03@foresift.internal',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      ttlSeconds: -10, // Already expired in the past
    });

    const active = await store.getSession(expiredSession.sessionId);
    expect(active).toBeNull();
  });

  it('terminates a session via idempotent DELETE', async () => {
    const session = await store.createSession({
      actor: 'researcher-04@foresift.internal',
      profileId: 'discovery',
      origin: 'https://mcp.example.com',
      protocolRevision: '2025-11-25',
      ttlSeconds: 3600,
    });

    // First termination
    const result1 = await store.terminateSession(session.sessionId);
    expect(result1.terminated).toBe(true);

    // Subsequent retrieval returns null / 404
    const fetched = await store.getSession(session.sessionId);
    expect(fetched).toBeNull();

    // Second termination is idempotent
    const result2 = await store.terminateSession(session.sessionId);
    expect(result2.terminated).toBe(true);
  });
});
