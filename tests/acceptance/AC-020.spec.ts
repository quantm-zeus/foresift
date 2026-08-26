/**
 * AC-020 acceptance (positive).
 * Traces: FR-DATA-003 (point-in-time `available_at` replay), FR-DATA-002.
 * AC text (manifest §39): "Replay at time T cannot read evidence with
 * available_at > T."
 *
 * Exercises the shared replay predicate through BOTH replay surfaces this
 * package owns — persistence observation replay and frozen-evidence replay —
 * proving the boundary is inclusive, exclusion is exact, and revision
 * resolution respects it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  appendRevision,
  currentObservations,
  replayObservations,
} from '@foresift/persistence';
import { freezeBundle } from '@foresift/evidence';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { computeExactCacheKey } from '../../packages/tool-core/src/cache-key.ts';
import { CacheStageChain } from '../../packages/tool-core/src/stages/cache.ts';
import { closeTestDatabase, makeTestDatabase, seedPool, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac200',
  });

  // obs_past:   available 10:00 (visible well before every boundary below)
  // obs_edge:   available exactly 12:00 (inclusive-boundary probe)
  // obs_future: available 18:00 (must NEVER appear at T <= 17:59)
  // obs_rev:    base 10:00, revision at 14:00 (latest-visible-version probe)
  await appendObservation(engine, {
    observationId: 'ac20-past',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T09:00:00Z'),
    availableAt: T('2026-06-01T10:00:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '100',
    decimals: 2,
  });
  await appendObservation(engine, {
    observationId: 'ac20-edge',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T11:30:00Z'),
    availableAt: T('2026-06-01T12:00:00Z'),
    availabilityProvenance: 'FIRST_PARTY_LIVE_OBSERVED',
    rawAmount: '200',
    decimals: 2,
  });
  await appendObservation(engine, {
    observationId: 'ac20-future',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T15:00:00Z'),
    availableAt: T('2026-06-01T18:00:00Z'),
    availabilityProvenance: 'MANUAL_IMPORT_AVAILABLE',
    rawAmount: '999',
    decimals: 2,
  });
  await appendObservation(engine, {
    observationId: 'ac20-rev',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T08:00:00Z'),
    availableAt: T('2026-06-01T10:00:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '50',
    decimals: 2,
  });
  await appendRevision(engine, {
    revisionId: 'ac20-rev-r1',
    observationId: 'ac20-rev',
    reason: 'PROVIDER_CORRECTION',
    availableAt: T('2026-06-01T14:00:00Z'),
    availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
    rawAmount: '55',
    decimals: 2,
  });

  await freezeBundle(engine, {
    bundleId: 'ac20-bundle-live',
    manifest: { family: 'swaps', window: 'pre-boundary' },
    frozenAt: T('2026-06-01T11:00:00Z'),
  });
  await freezeBundle(engine, {
    bundleId: 'ac20-bundle-late',
    manifest: { family: 'swaps', window: 'post-boundary' },
    frozenAt: T('2026-06-01T16:00:00Z'),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-020: replay at T excludes available_at > T', () => {
  it('serves only records whose availability is at or before the boundary', async () => {
    const resolved = await replayObservations(tdb.engine, T('2026-06-01T12:00:00Z'), {
      subjectPoolId: poolId,
    });
    const ids = resolved.map((r) => r.observationId).sort();
    expect(ids).toEqual(['ac20-edge', 'ac20-past', 'ac20-rev']);

    for (const r of resolved) {
      expect(r.availableAt <= T('2026-06-01T12:00:00Z')).toBe(true);
    }
  });

  it('treats the boundary inclusively (available_at == T is visible)', async () => {
    const resolved = await replayObservations(tdb.engine, T('2026-06-01T12:00:00Z'));
    expect(resolved.find((r) => r.observationId === 'ac20-edge')).toBeDefined();
  });

  it('a record one microsecond past the boundary is excluded', async () => {
    const before = await replayObservations(tdb.engine, T('2026-06-01T17:59:59.999Z'));
    expect(before.find((r) => r.observationId === 'ac20-future')).toBeUndefined();

    const at = await replayObservations(tdb.engine, T('2026-06-01T18:00:00Z'));
    expect(at.find((r) => r.observationId === 'ac20-future')).toBeDefined();
  });

  it('resolves the latest version VISIBLE at T, never a later revision', async () => {
    const early = await replayObservations(tdb.engine, T('2026-06-01T13:00:00Z'));
    const earlyRev = early.find((r) => r.observationId === 'ac20-rev');
    expect(earlyRev?.isRevision).toBe(false);
    expect(earlyRev?.rawAmount).toBe('50');

    const late = await replayObservations(tdb.engine, T('2026-06-01T15:00:00Z'));
    const lateRev = late.find((r) => r.observationId === 'ac20-rev');
    expect(lateRev?.revisionNo).toBe(1);
    expect(lateRev?.rawAmount).toBe('55');
  });

  it('frozen-evidence replay applies the identical boundary to bundles', async () => {
    const { resolveEvidenceAt } = await import('@foresift/evidence');
    const resolution = await resolveEvidenceAt(tdb.engine, {
      resolvedAt: T('2026-06-01T12:00:00Z'),
    });
    const bundleIds = resolution.bundles.map((b) => b.bundleId);
    expect(bundleIds).toContain('ac20-bundle-live');
    expect(bundleIds).not.toContain('ac20-bundle-late');

    const later = await resolveEvidenceAt(tdb.engine, {
      resolvedAt: T('2026-06-01T16:00:00Z'),
    });
    expect(later.bundles.map((b) => b.bundleId)).toContain('ac20-bundle-late');
  });

  it('the current view still sees everything — separation of views is explicit', async () => {
    const current = await currentObservations(tdb.engine, { subjectPoolId: poolId });
    expect(current.map((r) => r.observationId).sort()).toEqual([
      'ac20-edge',
      'ac20-future',
      'ac20-past',
      'ac20-rev',
    ]);
  });
});

describe('AC-020 acceptance (tool-core substrate): exact-cache lookups enforce point-in-time boundary', () => {
  it('exact-cache lookup at decisionTime T cannot read cache entries with stored_at > T', async () => {
    const cacheChain = new CacheStageChain({
      engine: tdb.engine,
      now: () => '2026-06-01T12:00:00Z',
    });

    const components: CacheKeyComponents = {
      provider: 'first-party-dex-observer',
      operation: 'get_asset_identity',
      operationVersion: '1.0.0',
      chain: 'eip155:1',
      canonicalEntityIdentity: 'eip155:1:0x00000000000000000000000000000000000ac200',
      normalizedArguments: { address: '0x00000000000000000000000000000000000ac200' },
      fieldProjection: ['symbol', 'decimals'],
      asOf: '2026-06-01T12:00:00Z',
      licensePolicyVersion: 'rights-1',
    };

    // Store entry with stored_at at 14:00:00Z
    const stored = await cacheChain.storeIfPermitted({
      components,
      payloadRef: 'obj://core-cache/ac20-entry-1',
      storedAt: '2026-06-01T14:00:00Z',
      rightsAllowed: true,
      policy: { cachingPermitted: true },
    });
    expect(stored).toBe(true);

    // Lookup at earlier decisionTime 12:00:00Z -> MISS (point-in-time boundary exclusion)
    const earlyLookup = await cacheChain.lookup({
      components,
      holderMode: 'MCP_MANUAL',
      decisionTime: '2026-06-01T12:00:00Z',
    });
    expect(earlyLookup.outcome).toBe('MISS');

    // Lookup at or after stored_at (14:00:00Z or 14:01:00Z) -> HIT_FRESH
    const onTimeLookup = await cacheChain.lookup({
      components,
      holderMode: 'MCP_MANUAL',
      decisionTime: '2026-06-01T14:00:00Z',
    });
    expect(onTimeLookup.outcome).toBe('HIT_FRESH');
    expect(onTimeLookup.payloadRef).toBe('obj://core-cache/ac20-entry-1');
  });

  it('exact cache keys with distinct asOf semantics isolate point-in-time queries', () => {
    const baseComponents: CacheKeyComponents = {
      provider: 'first-party-dex-observer',
      operation: 'get_asset_identity',
      operationVersion: '1.0.0',
      chain: 'eip155:1',
      canonicalEntityIdentity: 'eip155:1:0x00000000000000000000000000000000000ac200',
      normalizedArguments: { address: '0x00000000000000000000000000000000000ac200' },
      fieldProjection: ['symbol'],
      asOf: '2026-06-01T12:00:00Z',
      licensePolicyVersion: 'rights-1',
    };

    const keyEarly = computeExactCacheKey(baseComponents);
    const keyLate = computeExactCacheKey({ ...baseComponents, asOf: '2026-06-01T14:00:00Z' });

    expect(keyEarly.cacheKeyHash).not.toBe(keyLate.cacheKeyHash);
  });
});
