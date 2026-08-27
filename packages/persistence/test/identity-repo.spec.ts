/**
 * Identity repository + golden fixtures (FR-DATA-001, AC-022/023
 * substrate). Fixtures live at tests/fixtures/data/ (manifest-scoped paths).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  ChainMappingQuality,
  DecimalsResolutionState,
  ErrorCode,
  ForesiftError,
  LineageStatus,
  VerifiedEquivalence,
  caip10,
  chainIdentity,
  normalizeAddressForNamespace,
  normalizeEvmAddress,
  renderEip55,
  utcTimestamp,
  type MigrationLineageEdge,
  type PoolId,
} from '@foresift/domain';
import {
  applyMigrations,
  attachMembership,
  confirmedMigrationBoundaries,
  createAsset,
  createEngine,
  ensureChain,
  insertChain,
  insertDex,
  insertPool,
  insertRepresentation,
  loadRepresentation,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  recordDecimalsObservation,
  recordPair,
  registerLaunch,
  registerMigrationEdge,
  registerSourceIdentity,
  type DatabaseEngine,
} from '../src/index.ts';
import { CollectionMethod, type SourceIdentityId } from '@foresift/domain';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/data',
);

interface IdentityVectors {
  chains: { chainId: string; expectedMappingQuality: string }[];
  invalidChainIds: string[];
  evmAddresses: { input: string; canonical: string; eip55: string }[];
  invalidEvmAddresses: string[];
  solanaAddresses: { input: string; canonical: string }[];
  invalidSolanaAddresses: string[];
  caip10: { chainId: string; address: string; accountId: string }[];
}

interface DecimalsVectors {
  scenarios: {
    name: string;
    representation: { chainId: string; canonicalAddress: string };
    observations: {
      observationId: string;
      decimals: number;
      observedAt: string;
      sourceRef: string;
      expectRefusal?: boolean;
    }[];
    expectedState: string;
    expectedDecimals: number | null;
  }[];
}

let db: PGlite;
let engine: DatabaseEngine;
let vectors: IdentityVectors;
let decimalsVectors: DecimalsVectors;

async function loadFixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, name), 'utf8');
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  vectors = JSON.parse(await loadFixture('identity-vectors.json')) as IdentityVectors;
  decimalsVectors = JSON.parse(await loadFixture('decimals-vectors.json')) as DecimalsVectors;
}, 120_000);

afterAll(async () => {
  await db.close();
}, 30_000);

describe('golden chain-id vectors through the repository (AC-023)', () => {
  it('stores each registered chain with its expected mapping quality', async () => {
    for (const c of vectors.chains) {
      const identity = await ensureChain(engine, c.chainId);
      expect(String(identity.mappingQuality)).toBe(c.expectedMappingQuality);
      const stored = await engine.query<{ mapping_quality: string }>(
        'SELECT mapping_quality FROM chains WHERE chain_id = $1',
        [c.chainId],
      );
      expect(stored.rows[0]?.mapping_quality).toBe(c.expectedMappingQuality);
    }
    // Internal-versioned identifiers carry an explicit id version.
    const internal = await ensureChain(engine, 'custom:localnet-7', 3);
    expect(internal.mappingQuality).toBe(ChainMappingQuality.INTERNAL_VERSIONED);
    expect(internal.internalIdVersion).toBe(3);
  });

  it('refuses malformed chain ids at the domain boundary', async () => {
    for (const bad of vectors.invalidChainIds) {
      await expect(ensureChain(engine, bad), `expected refusal for ${bad}`).rejects.toThrowError(
        ForesiftError,
      );
    }
  });
});

describe('golden EVM/Solana address vectors (AC-023)', () => {
  it('canonicalizes any-cased input and renders EIP-55 exactly as the fixture declares', () => {
    for (const v of vectors.evmAddresses) {
      expect(normalizeAddressForNamespace('eip155', v.input)).toBe(v.canonical);
      expect(renderEip55(normalizeEvmAddress(v.canonical))).toBe(v.eip55);
    }
  });

  it('rejects wrong-length and non-canonical EVM forms on insert', async () => {
    for (const bad of vectors.invalidEvmAddresses) {
      await expect(
        insertRepresentation(engine, { chainId: 'eip155:1', canonicalAddress: bad }),
      ).rejects.toThrow();
    }
  });

  it('accepts the Solana vectors as representations', async () => {
    for (const v of vectors.solanaAddresses) {
      const canonical = normalizeAddressForNamespace('solana', v.input);
      expect(canonical).toBe(v.canonical);
      await ensureChain(engine, 'solana:mainnet');
      await insertRepresentation(engine, {
        chainId: 'solana:mainnet',
        canonicalAddress: canonical,
      });
    }
  });

  it('rejects invalid Solana addresses', () => {
    for (const bad of vectors.invalidSolanaAddresses) {
      expect(() => normalizeAddressForNamespace('solana', bad)).toThrowError();
    }
  });

  it('builds CAIP-10 account ids from the fixtures', () => {
    for (const v of vectors.caip10) {
      expect(String(caip10(chainIdentity({ chainId: v.chainId }).chainId, v.address))).toBe(
        v.accountId,
      );
    }
  });
});

describe('verified-equivalence memberships and pool identity', () => {
  it('groups representations only under verified equivalences; refuses heuristics', async () => {
    await createAsset(engine, 'asset_golden_1');
    const rep = vectors.evmAddresses[0];
    if (rep === undefined) throw new Error('fixture missing');
    await ensureChain(engine, 'eip155:1');
    await insertRepresentation(engine, { chainId: 'eip155:1', canonicalAddress: rep.canonical });

    // Heuristic merge claims are refused before any SQL runs.
    await expect(
      attachMembership(engine, {
        assetId: 'asset_golden_1',
        chainId: 'eip155:1',
        canonicalAddress: rep.canonical,
        verification: 'SAME_SYMBOL_SO_PROBABLY_SAME' as unknown as VerifiedEquivalence,
      }),
    ).rejects.toThrowError(ForesiftError);

    // A verified equivalence attaches.
    await attachMembership(engine, {
      assetId: 'asset_golden_1',
      chainId: 'eip155:1',
      canonicalAddress: rep.canonical,
      verification: VerifiedEquivalence.BRIDGE_VERIFIED,
    });
    const stored = await engine.query<{ verification: string }>(
      'SELECT verification FROM asset_memberships WHERE canonical_address = $1',
      [rep.canonical],
    );
    expect(stored.rows[0]?.verification).toBe(VerifiedEquivalence.BRIDGE_VERIFIED);
  });

  it('composes pool ids strictly as chain/dex/address', async () => {
    await insertDex(engine, 'eip155:1', 'uniswap');
    const addr = normalizeAddressForNamespace(
      'eip155',
      '0x00000000000000000000000000000000c0ffee01',
    );
    const poolId = await insertPool(engine, {
      chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
      dexId: 'uniswap',
      poolAddress: addr,
    });
    expect(poolId).toBe(`eip155:1/uniswap/${addr}` as PoolId);
  });

  it('registers launch pools and migration edges; refuses cycles and ambiguous boundaries', async () => {
    await insertDex(engine, 'eip155:1', 'uniswap-v2');
    const mkAddr = (n: number) =>
      normalizeAddressForNamespace('eip155', `0x${n.toString(16).padStart(40, '0')}`);
    const poolKey = (n: number) => ({
      chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
      dexId: 'uniswap-v2',
      poolAddress: mkAddr(n),
    });
    const launchPool = await insertPool(engine, poolKey(0xa1));
    const migratedPool = await insertPool(engine, poolKey(0xa2));
    const otherA = await insertPool(engine, poolKey(0xa3));
    const otherB = await insertPool(engine, poolKey(0xa4));

    await registerLaunch(engine, {
      launchId: 'launch_g1',
      poolId: launchPool,
      launchedAt: utcTimestamp('2026-01-01T00:00:00Z'),
      sourceRef: 'fixture://identity-repo',
    });

    const edge = (
      migrationId: string,
      launchPoolId: PoolId,
      migratedPoolId: PoolId,
      status: MigrationLineageEdge['status'],
      migratedAt?: MigrationLineageEdge['migratedAt'],
    ): MigrationLineageEdge => ({
      migrationId: migrationId as MigrationLineageEdge['migrationId'],
      launchPoolId,
      migratedPoolId,
      status,
      ...(migratedAt === undefined ? {} : { migratedAt }),
    });

    await registerMigrationEdge(
      engine,
      edge(
        'mig_g1',
        launchPool,
        migratedPool,
        LineageStatus.CONFIRMED,
        utcTimestamp('2026-02-01T00:00:00Z'),
      ),
    );
    expect(await confirmedMigrationBoundaries(engine, launchPool)).toEqual([
      utcTimestamp('2026-02-01T00:00:00Z'),
    ]);

    // Cycle: migrating back over an existing confirmed edge is refused.
    await expect(
      registerMigrationEdge(
        engine,
        edge(
          'mig_cycle',
          migratedPool,
          launchPool,
          LineageStatus.CONFIRMED,
          utcTimestamp('2026-03-01T00:00:00Z'),
        ),
      ),
    ).rejects.toThrowError(ForesiftError);

    // Ambiguous edges may not assert a boundary…
    await expect(
      registerMigrationEdge(
        engine,
        edge(
          'mig_amb_boundary',
          otherA,
          otherB,
          LineageStatus.AMBIGUOUS,
          utcTimestamp('2026-03-02T00:00:00Z'),
        ),
      ),
    ).rejects.toThrow(/ambiguous/);

    // …but a boundary-free ambiguous lineage hint is accepted.
    await registerMigrationEdge(
      engine,
      edge('mig_amb_ok', otherA, otherB, LineageStatus.AMBIGUOUS),
    );
  });

  it('refuses re-pointing a representation between asset groupings; identical re-attach is a no-op', async () => {
    await createAsset(engine, 'asset_group_a');
    await createAsset(engine, 'asset_group_b');
    const rep = vectors.evmAddresses[1];
    if (rep === undefined) throw new Error('fixture missing');
    await ensureChain(engine, 'eip155:1');
    await insertRepresentation(engine, { chainId: 'eip155:1', canonicalAddress: rep.canonical });

    const attach = (assetId: string) =>
      attachMembership(engine, {
        assetId,
        chainId: 'eip155:1',
        canonicalAddress: rep.canonical,
        verification: VerifiedEquivalence.BRIDGE_VERIFIED,
      });

    expect(await attach('asset_group_a')).toEqual({ inserted: true });
    // One representation maps to ONE grouping — a conflicting re-point is a
    // typed identity conflict, never silently absorbed.
    await expect(attach('asset_group_b')).rejects.toMatchObject({
      code: ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    });
    // The original grouping still holds the membership.
    const stored = await engine.query<{ asset_id: string }>(
      'SELECT asset_id FROM asset_memberships WHERE canonical_address = $1',
      [rep.canonical],
    );
    expect(stored.rows[0]?.asset_id).toBe('asset_group_a');
    // An identical re-attach reports honestly as a no-op.
    expect(await attach('asset_group_a')).toEqual({ inserted: false });
  });
});

describe('insert-only identity semantics (insertOrVerify)', () => {
  it('treats an identical re-registration as a no-op reporting inserted:false', async () => {
    const identity = chainIdentity({ chainId: 'eip155:9001' });
    expect(await insertChain(engine, identity)).toEqual({ inserted: true });
    expect(await insertChain(engine, identity)).toEqual({ inserted: false });
  });

  it('refuses a conflicting re-registration with a typed error', async () => {
    const first = chainIdentity({ chainId: 'custom:localnet-9', internalIdVersion: 3 });
    expect(await insertChain(engine, first)).toEqual({ inserted: true });
    const conflicting = chainIdentity({ chainId: 'custom:localnet-9', internalIdVersion: 4 });
    await expect(insertChain(engine, conflicting)).rejects.toMatchObject({
      code: ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    });
  });

  it('compares instants by epoch, not text shape (…00Z vs …00.000Z)', async () => {
    await insertDex(engine, 'eip155:9001', 'dex_instant');
    const poolId = await insertPool(engine, {
      chainId: chainIdentity({ chainId: 'eip155:9001' }).chainId,
      dexId: 'dex_instant',
      poolAddress: normalizeAddressForNamespace(
        'eip155',
        '0x00000000000000000000000000000000c0ffee09',
      ),
    });
    const launchId = 'launch_instant_equiv';
    expect(
      await registerLaunch(engine, {
        launchId,
        poolId,
        launchedAt: utcTimestamp('2026-01-01T00:00:00Z'),
        sourceRef: 'fixture://identity-repo',
      }),
    ).toEqual({ inserted: true });
    // Same instant in a different ISO spelling must read as the SAME row.
    await expect(
      registerLaunch(engine, {
        launchId,
        poolId,
        launchedAt: utcTimestamp('2026-01-01T00:00:00.000Z'),
        sourceRef: 'fixture://identity-repo',
      }),
    ).resolves.toEqual({ inserted: false });
  });
});

describe('decimals resolution state machine over golden vectors', () => {
  it('walks every scenario to its declared final state', async () => {
    for (const scenario of decimalsVectors.scenarios) {
      await ensureChain(engine, scenario.representation.chainId);
      await insertRepresentation(engine, scenario.representation);
      let last: { state: DecimalsResolutionState; decimals: number | null } | null = null;
      for (const obs of scenario.observations) {
        const call = recordDecimalsObservation(engine, {
          observationId: obs.observationId,
          chainId: scenario.representation.chainId,
          canonicalAddress: scenario.representation.canonicalAddress,
          decimals: obs.decimals,
          observedAt: utcTimestamp(obs.observedAt),
          sourceRef: obs.sourceRef,
        });
        if (obs.expectRefusal === true) {
          await expect(call).rejects.toThrow();
          continue;
        }
        last = await call;
      }
      const snapshot = await loadRepresentation(
        engine,
        scenario.representation.chainId,
        scenario.representation.canonicalAddress,
      );
      expect(String(snapshot?.decimalsState), scenario.name).toBe(scenario.expectedState);
      if (last !== null) expect(String(last.state), scenario.name).toBe(scenario.expectedState);
      expect(snapshot?.decimals ?? null, scenario.name).toBe(scenario.expectedDecimals);
    }
  });

  it('keeps conflicting values explicitly unusable instead of guessing', async () => {
    const conflicting = decimalsVectors.scenarios.find((s) => s.expectedState === 'CONFLICTING');
    if (conflicting === undefined) throw new Error('fixture missing CONFLICTING scenario');
    const snapshot = await loadRepresentation(
      engine,
      conflicting.representation.chainId,
      conflicting.representation.canonicalAddress,
    );
    expect(snapshot?.decimals).toBeNull();
    expect(snapshot?.decimalsState).toBe(DecimalsResolutionState.CONFLICTING);
  });

  it('refuses full cross-check credit when supporting refs share one upstream lineage (INV-008, ADR-0016)', async () => {
    await ensureChain(engine, 'eip155:1');
    const sharedLineageAddress = '0x' + '11'.repeat(20);
    const distinctLineageAddress = '0x' + '22'.repeat(20);
    await insertRepresentation(engine, {
      chainId: 'eip155:1',
      canonicalAddress: sharedLineageAddress,
    });
    await insertRepresentation(engine, {
      chainId: 'eip155:1',
      canonicalAddress: distinctLineageAddress,
    });

    // Two brands reselling the SAME upstream lineage collapse to one voice.
    for (const id of ['src:brand-a:getTokenMeta', 'src:brand-b:getTokenMeta']) {
      await registerSourceIdentity(engine, {
        id: id as SourceIdentityId,
        brandProvider: id,
        operation: 'getTokenMeta',
        upstreamLineageKey: 'lineage:shared-aggregator',
        endpointRegion: 'eu-central',
        collectionMethod: CollectionMethod.POLLING_API,
      });
    }
    // Control pair on DIFFERENT lineages stays two independent voices.
    for (const [id, lineage] of [
      ['src:independent-c:getTokenMeta', 'lineage:c-first-party'],
      ['src:independent-d:getTokenMeta', 'lineage:d-first-party'],
    ] as const) {
      await registerSourceIdentity(engine, {
        id: id as SourceIdentityId,
        brandProvider: id,
        operation: 'getTokenMeta',
        upstreamLineageKey: lineage,
        endpointRegion: 'us-east',
        collectionMethod: CollectionMethod.POLLING_API,
      });
    }

    let callNo = 0;
    const observe = (canonicalAddress: string, sourceRef: string, decimals: number) =>
      recordDecimalsObservation(engine, {
        observationId: `obs-indep-${(callNo += 1)}`,
        chainId: 'eip155:1',
        canonicalAddress,
        decimals,
        observedAt: utcTimestamp('2026-04-01T00:00:00Z'),
        sourceRef,
      });

    // Same-lineage supporters: ref count reaches 2 but independence does not.
    const collapsedA = await observe(sharedLineageAddress, 'src:brand-a:getTokenMeta', 6);
    expect(collapsedA.state).toBe(DecimalsResolutionState.SOURCED);
    const collapsedB = await observe(sharedLineageAddress, 'src:brand-b:getTokenMeta', 6);
    expect(collapsedB.state).toBe(DecimalsResolutionState.SOURCED);
    expect(collapsedB.decimals).toBe(6);
    expect(collapsedB.independenceHints).toEqual(['DECIMAL_UNCERTAIN']);

    // Distinct-lineage supporters keep full CROSS_CHECKED credit, no hint.
    await observe(distinctLineageAddress, 'src:independent-c:getTokenMeta', 8);
    const crossChecked = await observe(distinctLineageAddress, 'src:independent-d:getTokenMeta', 8);
    expect(crossChecked.state).toBe(DecimalsResolutionState.CROSS_CHECKED);
    expect(crossChecked.independenceHints).toBeUndefined();
  });
});

describe('pair identity (§11.6)', () => {
  it('records a pair insert-or-verify: identical re-record is a no-op, conflict is typed', async () => {
    await ensureChain(engine, 'eip155:1');
    await insertDex(engine, 'eip155:1', 'dex_pairs');
    const poolId = await insertPool(engine, {
      chainId: chainIdentity({ chainId: 'eip155:1' }).chainId,
      dexId: 'dex_pairs',
      poolAddress: normalizeAddressForNamespace(
        'eip155',
        '0x00000000000000000000000000000000c0ffee10',
      ),
    });
    await createAsset(engine, 'asset_pair_base');
    await createAsset(engine, 'asset_pair_quote');

    const pair = {
      pairId: 'pair_identity_1',
      poolId,
      baseAssetId: 'asset_pair_base',
      quoteAssetId: 'asset_pair_quote',
    };
    expect(await recordPair(engine, pair)).toEqual({ inserted: true });
    // Identical re-record reads as the same row — never a duplicate.
    expect(await recordPair(engine, pair)).toEqual({ inserted: false });

    // Re-pointing the same pair_id at different sides is a typed conflict.
    await createAsset(engine, 'asset_pair_quote_alt');
    await expect(
      recordPair(engine, { ...pair, quoteAssetId: 'asset_pair_quote_alt' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONTRACT_INVARIANT_VIOLATED });
  });

  it('the pairs_distinct_sides CHECK refuses base == quote at the SQL layer', async () => {
    await expect(
      engine.query(
        `INSERT INTO pairs (pair_id, pool_id, base_asset_id, quote_asset_id)
         VALUES ('pair_degenerate', $1, 'asset_pair_base', 'asset_pair_base')`,
        ['eip155:1/dex_pairs/0x00000000000000000000000000000000c0ffee10'],
      ),
    ).rejects.toThrow(/distinct_sides|pairs_distinct/i);
  });
});
