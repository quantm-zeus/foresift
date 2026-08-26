/**
 * AC-246 acceptance (positive).
 * Traces: FR-DATA-006 (§11.7 independence groups, INV-008).
 * AC text (manifest §39, abridged): "Removing or collapsing each major
 * upstream lineage is included in sensitivity analysis; a policy whose alert
 * gate depends on duplicated evidence cannot be promoted…"
 *
 * Substrate owned here: the lineage-collapse query folds every distinct-brand
 * source reselling one upstream lineage into a single independence group, so
 * duplicated evidence counts as ONE source. Sensitivity analysis and
 * promotion gates consume these groups in later packages.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  independenceGroups,
  independenceGroupOf,
  registerSourceIdentity,
} from '@foresift/persistence';
import { parseDataSchema } from '@foresift/shared-schemas';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;

  // Three distinct brands reselling ONE upstream lineage…
  for (const id of ['src/brand-x', 'src/brand-y', 'src/brand-z']) {
    await registerSourceIdentity(engine, {
      id: id as never,
      brandProvider: id.toUpperCase(),
      operation: 'swaps',
      upstreamLineageKey: 'upstream/nodesense-mainnet',
      endpointRegion: 'eu-central',
      collectionMethod: 'POLLING_API',
    });
  }
  // …plus two genuinely independent providers.
  await registerSourceIdentity(engine, {
    id: 'src/rpc-a' as never,
    brandProvider: 'RpcA',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/rpc-a-own-infra',
    endpointRegion: 'us-east',
    collectionMethod: 'POLLING_API',
  });
  await registerSourceIdentity(engine, {
    id: 'src/explorer-b' as never,
    brandProvider: 'ExplorerB',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/explorer-b-indexer',
    endpointRegion: 'ap-south',
    collectionMethod: 'AUTHORIZED_PUSH',
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-246: lineage collapse removes duplicated credit', () => {
  it('five registered providers collapse into exactly three independence groups', async () => {
    const groups = await independenceGroups(tdb.engine);
    expect(groups.length).toBe(3);
  });

  it('every reseller of one lineage is a member of that lineage’s single group', async () => {
    const group = await independenceGroupOf(tdb.engine, 'upstream/nodesense-mainnet');
    expect(group?.memberSourceIds).toEqual(['src/brand-x', 'src/brand-y', 'src/brand-z']);
  });

  it('collapsing a lineage reduces the independent-source count from 3 to 1 for it', async () => {
    const groups = await independenceGroups(tdb.engine);
    // Naive provider count across the shared lineage: 3. Collapsed: 1.
    const naiveProviderCount = groups
      .filter((g) => g.upstreamLineageKey === 'upstream/nodesense-mainnet')
      .flatMap((g) => g.memberSourceIds).length;
    const collapsedCount = groups.filter(
      (g) => g.upstreamLineageKey === 'upstream/nodesense-mainnet',
    ).length;
    expect(naiveProviderCount).toBe(3);
    expect(collapsedCount).toBe(1);
  });

  it('independent providers keep one group each', async () => {
    const a = await independenceGroupOf(tdb.engine, 'upstream/rpc-a-own-infra');
    const b = await independenceGroupOf(tdb.engine, 'upstream/explorer-b-indexer');
    expect(a?.memberSourceIds).toEqual(['src/rpc-a']);
    expect(b?.memberSourceIds).toEqual(['src/explorer-b']);
    expect(a?.groupId).not.toBe(b?.groupId);
  });
});

describe('AC-246 acceptance (tool-core substrate): source identity and group membership schemas', () => {
  it('IndependenceGroup schema validates lineage group record', () => {
    const parsed = parseDataSchema('IndependenceGroup', {
      id: 'grp-nodesense',
      upstreamLineageKey: 'upstream/nodesense-mainnet',
    });
    expect(parsed.upstreamLineageKey).toBe('upstream/nodesense-mainnet');
  });
});
