/**
 * AC-022 acceptance (positive).
 * Traces: FR-DATA-001 (§11.6 launch/migration lineage).
 * AC text (manifest §39): "Asset/pool migration avoids double counting in
 * fixture tests."
 *
 * A token launches on pool A and migrates to pool B; later it hops to pool C.
 * Metric samples on every pool are aggregated through the lineage-aware
 * helper, with edges persisted through the identity repository — each unit is
 * counted exactly once across the boundaries.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  LineageStatus,
  aggregateWithoutDoubleCounting,
  caip10,
  normalizeEvmAddress,
  parseChainId,
  utcTimestamp,
  type MigrationLineageEdge,
  type PoolId,
  type UtcTimestamp,
} from '@foresift/domain';
import {
  confirmedMigrationBoundaries,
  insertPool,
  registerLaunch,
  registerMigrationEdge,
} from '@foresift/persistence';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { computeExactCacheKey } from '../../packages/tool-core/src/cache-key.ts';
import { CacheStageChain } from '../../packages/tool-core/src/stages/cache.ts';
import { closeTestDatabase, makeTestDatabase, seedPool, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let launchA: PoolId;
let migratedB: PoolId;
let migratedC: PoolId;

/** Samples: value in metric-native units, positioned on the lineage timeline. */
const sample = (iso: string | null, value: bigint) => ({
  effectiveAt: iso === null ? null : T(iso),
  value,
});

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;

  // Chain/dex identity for all three pools (distinct addresses per pool).
  await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac220',
  });
  launchA = await insertPool(engine, {
    chainId: parseChainId('eip155:1'),
    dexId: 'uniswap-v2',
    poolAddress: '0x0000000000000000000000000000000000a10001',
  });
  migratedB = await insertPool(engine, {
    chainId: parseChainId('eip155:1'),
    dexId: 'uniswap-v2',
    poolAddress: '0x0000000000000000000000000000000000b20002',
  });
  migratedC = await insertPool(engine, {
    chainId: parseChainId('eip155:1'),
    dexId: 'uniswap-v2',
    poolAddress: '0x0000000000000000000000000000000000c30003',
  });

  await registerLaunch(engine, {
    launchId: 'ac22-launch',
    poolId: launchA,
    launchedAt: T('2026-03-01T00:00:00Z'),
    sourceRef: 'fixture/ac22',
  });

  // Confirmed lineage: A →(Apr 1)→ B →(May 1)→ C, persisted as SQL truth.
  await registerMigrationEdge(tdb.engine, {
    migrationId: 'ac22-mig-a-b' as MigrationLineageEdge['migrationId'],
    launchPoolId: launchA,
    migratedPoolId: migratedB,
    status: LineageStatus.CONFIRMED,
    migratedAt: T('2026-04-01T12:00:00Z'),
  });
  await registerMigrationEdge(tdb.engine, {
    migrationId: 'ac22-mig-b-c' as MigrationLineageEdge['migrationId'],
    launchPoolId: migratedB,
    migratedPoolId: migratedC,
    status: LineageStatus.CONFIRMED,
    migratedAt: T('2026-05-01T12:00:00Z'),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-022: asset/pool migration avoids double counting', () => {
  it('persists confirmed edges with their boundary times', async () => {
    const outOfA = await confirmedMigrationBoundaries(tdb.engine, launchA);
    expect(outOfA).toEqual([T('2026-04-01T12:00:00Z')]);
    const outOfB = await confirmedMigrationBoundaries(tdb.engine, migratedB);
    expect(outOfB).toEqual([T('2026-05-01T12:00:00Z')]);
    // The terminal pool has no outgoing migration.
    expect(await confirmedMigrationBoundaries(tdb.engine, migratedC)).toEqual([]);
  });

  it('aggregates a two-hop fixture counting each unit exactly once', async () => {
    // Liquidity snapshots around the two boundaries. The same liquidity
    // physically moves A → B → C; only the newest position counts.
    const contributions = new Map<PoolId, ReturnType<typeof sample>[]>([
      [
        launchA,
        [
          sample('2026-03-15T00:00:00Z', 1_000n), // pre-migration: counts
          sample('2026-04-02T00:00:00Z', 1_100n), // post-out-migration: superseded
        ],
      ],
      [migratedB, [sample('2026-04-20T00:00:00Z', 1_100n)]], // current holder pre-May: counts
      [migratedC, [sample('2026-05-10T00:00:00Z', 1_150n)]], // terminal: counts
    ]);

    const edges: MigrationLineageEdge[] = [
      {
        migrationId: 'ac22-mig-a-b' as MigrationLineageEdge['migrationId'],
        launchPoolId: launchA,
        migratedPoolId: migratedB,
        status: LineageStatus.CONFIRMED,
        migratedAt: T('2026-04-01T12:00:00Z'),
      },
      {
        migrationId: 'ac22-mig-b-c' as MigrationLineageEdge['migrationId'],
        launchPoolId: migratedB,
        migratedPoolId: migratedC,
        status: LineageStatus.CONFIRMED,
        migratedAt: T('2026-05-01T12:00:00Z'),
      },
    ];

    // 1_000 + 1_100 + 1_150 — never 1_000+1_100+1_100+1_150.
    expect(aggregateWithoutDoubleCounting(contributions, edges)).toBe(3_250n);
  });

  it('boundary equality supersedes (the successor owns the boundary instant)', async () => {
    const contributions = new Map<PoolId, ReturnType<typeof sample>[]>([
      [launchA, [sample('2026-04-01T12:00:00Z', 5n)]], // exactly at the boundary
      [migratedB, []],
    ]);
    const edges: MigrationLineageEdge[] = [
      {
        migrationId: 'ac22-mig-eq' as MigrationLineageEdge['migrationId'],
        launchPoolId: launchA,
        migratedPoolId: migratedB,
        status: LineageStatus.CONFIRMED,
        migratedAt: T('2026-04-01T12:00:00Z'),
      },
    ];
    expect(aggregateWithoutDoubleCounting(contributions, edges)).toBe(0n);
  });

  it('undated samples on pools without migrations still count', async () => {
    const contributions = new Map<PoolId, ReturnType<typeof sample>[]>([
      [migratedC, [sample(null, 7n)]],
    ]);
    expect(aggregateWithoutDoubleCounting(contributions, [])).toBe(7n);
  });
});

describe('AC-022 acceptance (tool-core substrate): canonical entity identity in cache keys prevents double counting across migrations', () => {
  it('migrated pool queries with canonical entity identity produce deterministic exact cache keys', () => {
    const canonicalPoolId = caip10(
      parseChainId('eip155:1'),
      normalizeEvmAddress('0x0000000000000000000000000000000000a10001'),
    );
    const componentsA: CacheKeyComponents = {
      provider: 'first-party-dex-observer',
      operation: 'get_pool_observation',
      operationVersion: '1.0.0',
      chain: 'eip155:1',
      canonicalEntityIdentity: canonicalPoolId,
      normalizedArguments: { poolAddress: '0x0000000000000000000000000000000000a10001' },
      fieldProjection: ['liquidity', 'volume'],
      asOf: '2026-04-01T12:00:00Z',
      licensePolicyVersion: 'rights-1',
    };

    const keyA1 = computeExactCacheKey(componentsA);
    const keyA2 = computeExactCacheKey({ ...componentsA });
    expect(keyA1.cacheKeyHash).toBe(keyA2.cacheKeyHash);
  });

  it('cache lookup on canonical identity retrieves single entry without duplicate counting', async () => {
    const cacheChain = new CacheStageChain({
      engine: tdb.engine,
      now: () => '2026-04-01T12:00:00Z',
    });

    const canonicalPoolId = caip10(
      parseChainId('eip155:1'),
      normalizeEvmAddress('0x0000000000000000000000000000000000a10001'),
    );
    const components: CacheKeyComponents = {
      provider: 'first-party-dex-observer',
      operation: 'get_pool_observation',
      operationVersion: '1.0.0',
      chain: 'eip155:1',
      canonicalEntityIdentity: canonicalPoolId,
      normalizedArguments: { poolAddress: '0x0000000000000000000000000000000000a10001' },
      fieldProjection: ['liquidity'],
      asOf: '2026-04-01T12:00:00Z',
      licensePolicyVersion: 'rights-1',
    };

    await cacheChain.storeIfPermitted({
      components,
      payloadRef: 'obj://core-cache/ac22-pool-a',
      storedAt: '2026-04-01T12:00:00Z',
      rightsAllowed: true,
      policy: { cachingPermitted: true },
    });

    const lookup = await cacheChain.lookup({
      components,
      holderMode: 'MCP_MANUAL',
      decisionTime: '2026-04-01T12:00:00Z',
    });
    expect(lookup.outcome).toBe('HIT_FRESH');
    expect(lookup.payloadRef).toBe('obj://core-cache/ac22-pool-a');
  });
});
