/**
 * Single-flight manager units over PGlite (FR-CORE-006, §16.6, INV-009):
 * cross-mode acquisition only of released/expired leases, strictly
 * increasing fencing tokens, stale-holder release refusal, and concurrency
 * races where exactly one interleaved acquirer can win.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { SingleFlightManager, StaleFencingTokenError } from '../src/single-flight.ts';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url).pathname;

// A fixed clock the tests advance explicitly — expiry is deterministic.
let NOW_MS = Date.parse('2026-08-01T00:00:00Z');
const now = () => new Date(NOW_MS).toISOString();
const advance = (seconds: number) => {
  NOW_MS += seconds * 1000;
};

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

function manager(): SingleFlightManager {
  return new SingleFlightManager({ engine, now, defaultTtlSeconds: 60 });
}

function key(label: string): string {
  return SingleFlightManager.resourceKeyHash({
    provider: 'gmgn',
    operation: label,
    canonicalEntityIdentity: 'solana:test',
  });
}

describe('cross-mode lease acquisition', () => {
  it.each(['MCP_MANUAL', 'CHATGPT', 'ADMIN_CHAT', 'AUTOMATION'] as const)(
    '%s acquires a fresh lease with a positive token',
    async (mode) => {
      const handle = await manager().acquire({
        resourceKeyHash: key(`fresh-${mode}`),
        holderMode: mode,
        holderId: `holder-${mode}`,
      });
      expect(handle.fencingToken).toBeGreaterThan(0);
      expect(Date.parse(handle.expiresAt)).toBe(NOW_MS + 60_000);
    },
  );

  it('refuses a second live holder across modes (cross-mode single-flight)', async () => {
    const m = manager();
    const k = key('contended');
    await m.acquire({ resourceKeyHash: k, holderMode: 'MCP_MANUAL', holderId: 'human-1' });
    await expect(
      m.acquire({ resourceKeyHash: k, holderMode: 'AUTOMATION', holderId: 'worker-1' }),
    ).rejects.toMatchObject({ code: 'LEASE_FENCING_TOKEN_STALE' });
    expect(await m.isLive(k)).toBe(true);
  });

  it('allows takeover only after expiry and bumps the fence strictly', async () => {
    const m = manager();
    const k = key('expiry');
    const first = await m.acquire({ resourceKeyHash: k, holderMode: 'CHATGPT', holderId: 'c1' });
    advance(61); // past the 60s TTL
    const second = await m.acquire({
      resourceKeyHash: k,
      holderMode: 'AUTOMATION',
      holderId: 'w1',
    });
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);
    // The stale holder's release now fails closed.
    await expect(m.release(first)).rejects.toBeInstanceOf(StaleFencingTokenError);
  });

  it('release with the matching token succeeds; replay refuses', async () => {
    const m = manager();
    const k = key('release');
    const handle = await m.acquire({
      resourceKeyHash: k,
      holderMode: 'ADMIN_CHAT',
      holderId: 'a1',
    });
    await m.release(handle);
    await expect(m.release(handle)).rejects.toBeInstanceOf(StaleFencingTokenError);
    // Released key can be re-acquired immediately.
    const next = await m.acquire({ resourceKeyHash: k, holderMode: 'MCP_MANUAL', holderId: 'm2' });
    expect(next.fencingToken).toBeGreaterThan(handle.fencingToken);
  });

  it('interleaved acquirers of an expired lease elect exactly ONE winner', async () => {
    const m = manager();
    const k = key('interleave');
    const first = await m.acquire({ resourceKeyHash: k, holderMode: 'AUTOMATION', holderId: 'w0' });
    advance(61);
    // PGlite serializes writers: the first takeover revives the row as LIVE,
    // so the second guard matches zero rows and refuses. Exactly one of the
    // two interleaved acquirers wins, on a strictly higher fence.
    const results = await Promise.allSettled([
      m.acquire({ resourceKeyHash: k, holderMode: 'AUTOMATION', holderId: 'w1' }),
      m.acquire({ resourceKeyHash: k, holderMode: 'CHATGPT', holderId: 'c2' }),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const winner = (winners[0] as PromiseFulfilledResult<{ fencingToken: number }>).value;
    expect(winner.fencingToken).toBeGreaterThan(first.fencingToken);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'LEASE_FENCING_TOKEN_STALE',
    });
  });

  it('derives identical resource hashes for identical identity tuples', () => {
    const a = SingleFlightManager.resourceKeyHash({
      provider: 'p',
      operation: 'o',
      canonicalEntityIdentity: 'e',
    });
    const b = SingleFlightManager.resourceKeyHash({
      provider: 'p',
      operation: 'o',
      canonicalEntityIdentity: 'e',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
