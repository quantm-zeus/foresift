/**
 * Cache stage-chain units (FR-CORE-006, pipeline stages 6–11 and 20):
 * lookup order short-circuits memo → fresh → acceptable-stale, PIT lookups
 * never see entries stored after the decision time, license-component
 * mismatch refuses, post-lease re-check observes concurrent refreshes, and
 * stage-20 writes happen only when rights AND policy permit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { FreshnessFieldFamily } from '@foresift/domain';
import { CacheStageChain } from '../src/stages/cache.ts';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url).pathname;

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

function components(over: Partial<CacheKeyComponents> = {}): CacheKeyComponents {
  return {
    provider: 'gmgn',
    operation: 'token_security',
    operationVersion: '2',
    chain: 'solana',
    canonicalEntityIdentity: 'solana:So11111111111111111111111111111111111111112',
    normalizedArguments: { window: '24h' },
    fieldProjection: ['security.score'],
    asOf: now(),
    licensePolicyVersion: 'rights-1',
    ...over,
  } as CacheKeyComponents;
}

function chain(): CacheStageChain {
  return new CacheStageChain({
    engine,
    now,
    resolveFamily: () => FreshnessFieldFamily.SECURITY_SCAN, // fresh 6h / stale 24h / AUTOMATED
  });
}

const POLICY_PERMITTED = { cachingPermitted: true };
const POLICY_DENIED = { cachingPermitted: false };

describe('cache stage chain (stages 6–11)', () => {
  it('misses on an empty store, then hits FRESH after a permitted store', async () => {
    const c = chain();
    const comps = components();
    expect((await c.lookup({ components: comps, holderMode: 'AUTOMATION' })).outcome).toBe('MISS');
    const stored = await c.storeIfPermitted({
      components: comps,
      payloadRef: 'artifact://cache/fresh-1',
      storedAt: now(),
      rightsAllowed: true,
      policy: POLICY_PERMITTED,
    });
    expect(stored).toBe(true);
    const hit = await c.lookup({ components: comps, holderMode: 'AUTOMATION' });
    expect(hit.outcome).toBe('HIT_FRESH');
    expect(hit.payloadRef).toBe('artifact://cache/fresh-1');
  });

  it('memoizes within a request: a second lookup does not re-query', async () => {
    const c = chain();
    const comps = components({ canonicalEntityIdentity: 'solana:memo' });
    await c.storeIfPermitted({
      components: comps,
      payloadRef: 'artifact://cache/memo',
      storedAt: now(),
      rightsAllowed: true,
      policy: POLICY_PERMITTED,
    });
    const first = await c.lookup({ components: comps, holderMode: 'AUTOMATION' });
    // Undermine the store underneath: the memo must still serve the hit.
    await engine.query(`DELETE FROM core.core_exact_cache_entries`);
    const second = await c.lookup({ components: comps, holderMode: 'AUTOMATION' });
    expect(second).toEqual(first);
  });

  it('admits stale to automation for AUTOMATED families at the family edge', async () => {
    advance(6 * 3600 + 1); // one second past security-scan's 6h fresh TTL
    const c = chain();
    const comps = components();
    await c.storeIfPermitted({
      components: comps,
      payloadRef: 'artifact://cache/stale',
      storedAt: now(),
      rightsAllowed: true,
      policy: POLICY_PERMITTED,
    });
    advance(7 * 3600); // past the 6h fresh window, inside the 24h stale window
    expect((await c.lookup({ components: comps, holderMode: 'AUTOMATION' })).outcome).toBe(
      'HIT_STALE',
    );
  });

  it('point-in-time safety: a reader before the write never sees the entry', async () => {
    const c = chain();
    const comps = components({ canonicalEntityIdentity: 'solana:pit' });
    await c.storeIfPermitted({
      components: comps,
      payloadRef: 'artifact://cache/pit',
      storedAt: now(),
      rightsAllowed: true,
      policy: POLICY_PERMITTED,
    });
    const before = await c.lookup({
      components: comps,
      holderMode: 'AUTOMATION',
      decisionTime: new Date(NOW_MS - 1000).toISOString(),
    });
    expect(before.outcome).toBe('MISS');
  });

  it('refuses entries whose license component no longer matches', async () => {
    const c = chain();
    await c.storeIfPermitted({
      components: components({ canonicalEntityIdentity: 'solana:lic' }),
      payloadRef: 'artifact://cache/lic',
      storedAt: now(),
      rightsAllowed: true,
      policy: POLICY_PERMITTED,
    });
    const drifted = await c.lookup({
      components: components({
        canonicalEntityIdentity: 'solana:lic',
        licensePolicyVersion: 'rights-2',
      }),
      holderMode: 'AUTOMATION',
    });
    expect(drifted.outcome).toBe('MISS');
  });

  it('post-lease re-check drops the memo and observes a concurrent refresh', async () => {
    const c = chain();
    const comps = components({ canonicalEntityIdentity: 'solana:recheck' });
    await c.storeIfPermitted({
      components: comps,
      payloadRef: 'artifact://cache/old',
      storedAt: now(),
      rightsAllowed: true,
      policy: POLICY_PERMITTED,
    });
    const preLease = await c.lookup({ components: comps, holderMode: 'AUTOMATION' });
    expect(preLease.payloadRef).toBe('artifact://cache/old');
    // Another actor refreshes while we hold the lease — same key is
    // impossible (PIT key includes as-of), so simulate by overwriting via a
    // direct insert under the SAME key with a NEWER payload_ref.
    advance(2);
    await engine.query(
      `UPDATE core.core_exact_cache_entries SET payload_ref = 'artifact://cache/new'
       WHERE payload_ref = 'artifact://cache/old'`,
    );
    const postLease = await c.postLeaseRecheck({ components: comps, holderMode: 'AUTOMATION' });
    expect(postLease.outcome).toBe('HIT_FRESH');
    expect(postLease.payloadRef).toBe('artifact://cache/new');
  });
});

describe('stage-20 write admission', () => {
  it.each([
    ['rights refused', false, POLICY_PERMITTED],
    ['cache policy denied', true, POLICY_DENIED],
  ] as const)('%s ⇒ nothing is written', async (_label, rightsAllowed, policy) => {
    const c = chain();
    const comps = components({ canonicalEntityIdentity: `solana:no-write-${rightsAllowed}` });
    const wrote = await c.storeIfPermitted({
      components: comps,
      payloadRef: 'artifact://cache/refused',
      storedAt: now(),
      rightsAllowed,
      policy,
    });
    expect(wrote).toBe(false);
    const rows = await engine.query(
      `SELECT * FROM core.core_exact_cache_entries WHERE payload_ref = 'artifact://cache/refused'`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('writes windows derived from the §16.5 family row at write time', async () => {
    const c = chain();
    const comps = components({ canonicalEntityIdentity: 'solana:windows' });
    const storedAt = now();
    await c.storeIfPermitted({
      components: comps,
      payloadRef: 'artifact://cache/windows',
      storedAt,
      rightsAllowed: true,
      policy: POLICY_PERMITTED,
    });
    const rows = await engine.query<{ fresh_until: string; stale_until: string }>(
      `SELECT fresh_until, stale_until FROM core.core_exact_cache_entries
       WHERE payload_ref = 'artifact://cache/windows'`,
    );
    const row = rows.rows[0];
    expect(row).toBeDefined();
    // security-scan row: fresh +6h, stale +24h.
    expect(Date.parse(String(row?.fresh_until))).toBe(Date.parse(storedAt) + 6 * 3600_000);
    expect(Date.parse(String(row?.stale_until))).toBe(Date.parse(storedAt) + 24 * 3600_000);
  });
});
