/**
 * AC-246 negative / failure-path — task T056.
 * Traces: FR-DATA-006, INV-008.
 * The collapse is identity-anchored: a source cannot silently migrate between
 * lineages (differing tuples refuse), so independence groups can never be
 * gamed by re-registering a provider under a different upstream lineage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { independenceGroupOf, registerSourceIdentity } from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  await registerSourceIdentity(tdb.engine, {
    id: 'src/ac246n-dual' as never,
    brandProvider: 'DualFace',
    operation: 'swaps',
    upstreamLineageKey: 'upstream/original-lineage',
    endpointRegion: 'eu-central',
    collectionMethod: 'POLLING_API',
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-246 negative: collapse integrity', () => {
  it('re-registering a source under a different lineage tuple is refused', async () => {
    await expect(
      registerSourceIdentity(tdb.engine, {
        id: 'src/ac246n-dual' as never,
        brandProvider: 'DualFace',
        operation: 'swaps',
        upstreamLineageKey: 'upstream/someone-elses-infra', // different lineage
        endpointRegion: 'eu-central',
        collectionMethod: 'POLLING_API',
      }),
    ).rejects.toThrow(/different tuple/);
  });

  it('the refused migration leaves group membership unchanged', async () => {
    const original = await independenceGroupOf(tdb.engine, 'upstream/original-lineage');
    expect(original?.memberSourceIds).toEqual(['src/ac246n-dual']);
    const poached = await independenceGroupOf(tdb.engine, 'upstream/someone-elses-infra');
    expect(poached?.memberSourceIds ?? []).not.toContain('src/ac246n-dual');
  });

  it('an unknown lineage has no group to collapse into', async () => {
    const absent = await independenceGroupOf(tdb.engine, 'upstream/never-registered');
    expect(absent).toBeNull();
  });
});
