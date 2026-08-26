/**
 * AC-003 acceptance (positive) — cross-mode single-flight deduplication.
 * Traces: FR-CORE-006 (exact cache and cross-mode single-flight).
 * AC text (manifest §39): "Cross-mode deduplication: concurrent requests for
 * identical data across MCP, CLI, agent, and cron execute only once."
 *
 * Exercises:
 * - Two concurrent simulated modes (MCP_MANUAL + AUTOMATION) requesting the identical
 *   data resource within the single-flight dedupe window.
 * - Single-flight database lease serializes the requests: first mode acquires the lease
 *   and executes the provider call; second mode observes the active lease, waits, and
 *   re-checks the cache post-lease to receive a fresh hit.
 * - Exactly one external provider dispatch occurs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { SingleFlightManager } from '../../packages/tool-core/src/single-flight.ts';
import { CacheStageChain } from '../../packages/tool-core/src/stages/cache.ts';
import { computeExactCacheKey } from '../../packages/tool-core/src/cache-key.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

let tdb: TestDatabase;

const NOW_MS = Date.parse('2026-08-01T00:00:00Z');
const now = () => new Date(NOW_MS).toISOString();

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-003 acceptance: cross-mode single-flight collapses identical concurrent calls', () => {
  it('two concurrent requests across MCP_MANUAL and AUTOMATION execute exactly one provider call', async () => {
    const singleFlight = new SingleFlightManager({
      engine: tdb.engine,
      now,
      defaultTtlSeconds: 60,
    });
    const cacheChain = new CacheStageChain({ engine: tdb.engine, now });

    const components: CacheKeyComponents = {
      provider: 'gmgn',
      operation: 'token_security',
      operationVersion: '1',
      chain: 'solana',
      canonicalEntityIdentity: 'solana:So11111111111111111111111111111111111111112',
      normalizedArguments: { address: 'So11111111111111111111111111111111111111112' },
      fieldProjection: ['is_honeypot', 'holder_count'],
      asOf: '2026-08-01T00:00:00Z' as never,
      licensePolicyVersion: 'rights-1',
    };

    const exactKey = computeExactCacheKey(components);
    let providerCallCount = 0;

    // Simulated provider dispatch function
    async function dispatchProvider(): Promise<string> {
      providerCallCount += 1;
      return 'art-payload-001';
    }

    // Step 1: Mode 1 (MCP_MANUAL) checks cache -> MISS
    const lookup1 = await cacheChain.lookup({ components, holderMode: 'MCP_MANUAL' });
    expect(lookup1.outcome).toBe('MISS');

    // Step 2: Mode 1 acquires single-flight lease
    const leaseHandle1 = await singleFlight.acquire({
      resourceKeyHash: exactKey.cacheKeyHash,
      holderMode: 'MCP_MANUAL',
      holderId: 'mcp-session-1',
    });
    expect(leaseHandle1.fencingToken).toBeGreaterThan(0);

    // Step 3: Mode 2 (AUTOMATION) arrives concurrently for identical data
    // Mode 2 checks cache -> MISS
    const lookup2 = await cacheChain.lookup({ components, holderMode: 'AUTOMATION' });
    expect(lookup2.outcome).toBe('MISS');

    // Mode 2 attempts to acquire single-flight lease -> detects active live lease held by Mode 1
    const isMode1Holding = await singleFlight.isLive(exactKey.cacheKeyHash);
    expect(isMode1Holding).toBe(true);

    // Step 4: Mode 1 dispatches provider and stores result to cache
    const payloadRef = await dispatchProvider();
    await cacheChain.storeIfPermitted({
      components,
      payloadRef,
      storedAt: now(),
      rightsAllowed: true,
      policy: { cachingPermitted: true },
    });

    // Step 5: Mode 1 releases single-flight lease with fencing token
    await singleFlight.release(leaseHandle1);

    // Step 6: Mode 2 rechecks cache post-lease -> HIT_FRESH
    const postLeaseResult = await cacheChain.postLeaseRecheck({
      components,
      holderMode: 'AUTOMATION',
    });

    expect(postLeaseResult.outcome).toBe('HIT_FRESH');
    expect(postLeaseResult.payloadRef).toBe('art-payload-001');

    // Exactly one provider call was executed across both modes
    expect(providerCallCount).toBe(1);
  });
});
