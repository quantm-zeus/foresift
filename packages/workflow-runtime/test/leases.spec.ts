/**
 * Step-lease fencing suite (T019, FR-WF-003, AC-012; PRD §25.7). Runs on a real
 * SQL engine (PGlite).
 *
 * Mirrors the G0 single-flight interleavings over `wf.step_leases`:
 * - acquire / takeover / stale-commit: a stale worker cannot commit after a
 *   fencing change, even before its own lease expires;
 * - tokens strictly increase across takeovers;
 * - expiry WITHOUT takeover still permits the current holder (expiry alone is
 *   not fencing);
 * - release by a stale token is refused.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import { StepLeaseManager } from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';

const T0 = Date.parse('2026-06-01T12:00:00.000Z');

let tdb: TestDatabase;
let clockMs = T0;
let manager: StepLeaseManager;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  manager = new StepLeaseManager({
    engine: tdb.engine,
    now: () => new Date(clockMs).toISOString(),
  });
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

function resourceKey(tag: string): string {
  return StepLeaseManager.resourceKeyHash({ runId: `run-${tag}`, stepType: 'discover_candidates' });
}

describe('§25.7 fenced step leases (AC-012)', () => {
  it('takeover always allocates a strictly larger token and refuses a live lease', async () => {
    clockMs = T0;
    const key = resourceKey('takeover');
    const first = await manager.acquire({ resourceKey: key, owner: 'worker-a', ttlSeconds: 60 });
    expect(first.fencingToken).toBeGreaterThan(0);
    expect(await manager.isLive(key)).toBe(true);

    await expectForesiftError(
      manager.acquire({ resourceKey: key, owner: 'worker-b', ttlSeconds: 60 }),
      ErrorCode.LEASE_FENCING_TOKEN_STALE,
    );

    clockMs = T0 + 120_000;
    const second = await manager.acquire({ resourceKey: key, owner: 'worker-b', ttlSeconds: 60 });
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);
  });

  it('refuses a stale worker commit after a fencing change', async () => {
    clockMs = T0;
    const key = resourceKey('stale-commit');
    const stale = await manager.acquire({ resourceKey: key, owner: 'worker-a', ttlSeconds: 10 });
    clockMs = T0 + 30_000;
    const fresh = await manager.acquire({ resourceKey: key, owner: 'worker-b', ttlSeconds: 60 });

    // The commit-time compare is EXPIRY-INDEPENDENT: it fails because the token
    // moved, so a stale holder cannot commit even while its own (skewed) clock
    // still believes its window is open.
    clockMs = T0 + 5_000;
    await expectForesiftError(
      manager.assertLeaseCurrent(stale),
      ErrorCode.LEASE_FENCING_TOKEN_STALE,
    );
    await manager.assertLeaseCurrent(fresh);
  });

  it('still permits the current holder after expiry without takeover', async () => {
    clockMs = T0;
    const key = resourceKey('expiry');
    const holder = await manager.acquire({ resourceKey: key, owner: 'worker-a', ttlSeconds: 10 });
    clockMs = T0 + 60_000;

    expect(await manager.isLive(key)).toBe(false);
    // Expiry alone is not fencing: only a takeover fences.
    await manager.assertLeaseCurrent(holder);

    const taker = await manager.acquire({ resourceKey: key, owner: 'worker-b', ttlSeconds: 60 });
    expect(taker.fencingToken).toBeGreaterThan(holder.fencingToken);
    await expectForesiftError(
      manager.assertLeaseCurrent(holder),
      ErrorCode.LEASE_FENCING_TOKEN_STALE,
    );
  });

  it('refuses release by a stale token and accepts the current holder', async () => {
    clockMs = T0;
    const key = resourceKey('release');
    const stale = await manager.acquire({ resourceKey: key, owner: 'worker-a', ttlSeconds: 10 });
    clockMs = T0 + 60_000;
    const fresh = await manager.acquire({ resourceKey: key, owner: 'worker-b', ttlSeconds: 60 });

    await expectForesiftError(manager.release(stale), ErrorCode.LEASE_FENCING_TOKEN_STALE);
    await manager.release(fresh);
    expect(await manager.isLive(key)).toBe(false);
    // A double release is refused too.
    await expectForesiftError(manager.release(fresh), ErrorCode.LEASE_FENCING_TOKEN_STALE);
  });

  it('keeps tokens strictly increasing across many takeovers', async () => {
    clockMs = T0;
    const key = resourceKey('monotonic');
    const tokens: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      clockMs = T0 + i * 120_000;
      const handle = await manager.acquire({
        resourceKey: key,
        owner: `worker-${i}`,
        ttlSeconds: 60,
      });
      tokens.push(handle.fencingToken);
    }
    for (let i = 1; i < tokens.length; i += 1) {
      expect(tokens[i]).toBeGreaterThan(tokens[i - 1] ?? 0);
    }
  });
});
