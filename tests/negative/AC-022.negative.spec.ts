/**
 * AC-022 negative / failure-path — task T051.
 * Traces: FR-DATA-001, §11.8 (abstain over guessing).
 * Naive aggregation demonstrably double counts the same fixture; ambiguous
 * lineages, undated samples on migrated pools, and cyclic edges are refused
 * with typed errors instead of being guessed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode,
  LineageStatus,
  aggregateWithoutDoubleCounting,
  utcTimestamp,
  type MigrationLineageEdge,
  type PoolId,
  type UtcTimestamp,
} from '@foresift/domain';
import { insertPool, registerMigrationEdge } from '@foresift/persistence';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  seedPool,
  type TestDatabase,
} from '../acceptance/helpers';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

const edge = (
  migrationId: string,
  launchPoolId: PoolId,
  migratedPoolId: PoolId,
  overrides: Partial<MigrationLineageEdge> = {},
): MigrationLineageEdge => ({
  migrationId: migrationId as MigrationLineageEdge['migrationId'],
  launchPoolId,
  migratedPoolId,
  status: LineageStatus.CONFIRMED,
  migratedAt: T('2026-04-01T12:00:00Z'),
  ...overrides,
});

describe('AC-022 negative: naive aggregation diverges and ambiguity is refused', () => {
  const poolA = 'eip155:1:0x0000000000000000000000000000000000ac220' as PoolId;
  const poolB = 'eip155:1:0x0000000000000000000000000000000000ac221' as PoolId;
  const lineage: MigrationLineageEdge[] = [
    edge('neg-a-b', poolA, poolB, { migratedAt: T('2026-04-01T12:00:00Z') }),
  ];

  it('naive summation over the migration fixture double counts', () => {
    // Pre-migration liquidity (counts) plus its stale post-migration
    // re-report (must be superseded), plus the successor's own snapshot.
    const contributions = new Map<PoolId, { effectiveAt: UtcTimestamp | null; value: bigint }[]>([
      [
        poolA,
        [
          { effectiveAt: T('2026-03-15T00:00:00Z'), value: 1_000n },
          { effectiveAt: T('2026-04-02T00:00:00Z'), value: 1_000n }, // superseded
        ],
      ],
      [poolB, [{ effectiveAt: T('2026-04-20T00:00:00Z'), value: 1_100n }]],
    ]);

    const lineageAware = aggregateWithoutDoubleCounting(contributions, lineage);
    const naiveTotal = [...contributions.values()]
      .flat()
      .reduce((acc, s) => acc + s.value, 0n);

    expect(lineageAware).toBe(2_100n);
    expect(naiveTotal).toBe(3_100n); // demonstrable divergence: +1_000 phantom
    expect(naiveTotal - lineageAware).toBe(1_000n);
  });

  it('aggregation refuses an AMBIGUOUS edge rather than guessing attribution', () => {
    const ambiguous: MigrationLineageEdge[] = [
      edge('neg-amb', poolA, poolB, { status: LineageStatus.AMBIGUOUS, migratedAt: undefined }),
    ];
    expect(() => aggregateWithoutDoubleCounting(new Map(), ambiguous)).toThrowError();
    try {
      aggregateWithoutDoubleCounting(new Map(), ambiguous);
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS);
    }
  });

  it('aggregation refuses a confirmed edge without a boundary time', () => {
    const undated: MigrationLineageEdge[] = [
      edge('neg-nodate', poolA, poolB, { migratedAt: undefined }),
    ];
    try {
      aggregateWithoutDoubleCounting(new Map(), undated);
      throw new Error('expected refusal for boundary-free confirmed edge');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS);
    }
  });

  it('undated samples on a migrated pool are refused by aggregation (abstain)', () => {
    const contributions = new Map<PoolId, { effectiveAt: UtcTimestamp | null; value: bigint }[]>([
      [poolA, [{ effectiveAt: null, value: 42n }]],
    ]);
    try {
      aggregateWithoutDoubleCounting(contributions, lineage);
      throw new Error('expected refusal for undated sample on migrated pool');
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCode.IDENTITY_MIGRATION_EDGE_AMBIGUOUS);
    }
  });
});

describe('AC-022 negative: storage-level lineage refusals', () => {
  let tdb: TestDatabase;
  let poolA: PoolId;
  let poolB: PoolId;

  beforeAll(async () => {
    tdb = await makeTestDatabase();
    await seedPool(tdb.engine, {
      chainId: 'eip155:1',
      dexId: 'uniswap-v2',
      poolAddress: '0x00000000000000000000000000000000000ac226',
    });
    poolA = await insertPool(tdb.engine, {
      chainId: 'eip155:1',
      dexId: 'uniswap-v2',
      poolAddress: '0x0000000000000000000000000000000000c40004',
    });
    poolB = await insertPool(tdb.engine, {
      chainId: 'eip155:1',
      dexId: 'uniswap-v2',
      poolAddress: '0x0000000000000000000000000000000000c50005',
    });
    await registerMigrationEdge(tdb.engine, edge('neg-store-ab', poolA, poolB));
  });

  afterAll(() => closeTestDatabase(tdb));

  it('a cycle-forming edge is refused by the identity repository', async () => {
    await expectForesiftError(
      registerMigrationEdge(tdb.engine, edge('neg-cycle-ba', poolB, poolA)),
      ErrorCode.IDENTITY_MIGRATION_EDGE_CYCLES,
    );
  });

  it('an AMBIGUOUS edge may not assert a boundary time at registration', async () => {
    await expect(
      registerMigrationEdge(
        tdb.engine,
        edge('neg-amb-store', poolA, poolB, {
          status: LineageStatus.AMBIGUOUS,
          migratedAt: T('2026-06-01T00:00:00Z'),
        }),
      ),
    ).rejects.toThrow(/ambiguous/);
  });
});
