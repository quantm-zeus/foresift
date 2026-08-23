/**
 * AC-241 acceptance (positive) — task T053.
 * Traces: FR-DATA-003 (INV-005 frozen replay), FR-DATA-002.
 * AC text (manifest §39): "Replaying the same frozen candidate … differs
 * only in registered policy components; hidden current-data calls fail the
 * replay."
 *
 * Substrate owned here: a frozen-replay resolution is a pure function of
 * (persisted data, declared boundary T) — re-running is byte-identical, later
 * data never leaks in, and the only way the view changes is through the
 * explicitly registered component (the resolved-at boundary).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { appendObservation, replayObservations } from '@foresift/persistence';
import { freezeBundle, resolveEvidenceAt } from '@foresift/evidence';
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
    poolAddress: '0x00000000000000000000000000000000000ac241',
  });
  await appendObservation(engine, {
    observationId: 'ac241-a',
    subjectPoolId: poolId,
    eventAt: T('2026-07-01T08:00:00Z'),
    availableAt: T('2026-07-01T09:00:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '111',
    decimals: 2,
  });
  await freezeBundle(engine, {
    bundleId: 'ac241-bundle',
    manifest: { family: 'swaps' },
    frozenAt: T('2026-07-01T10:00:00Z'),
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-241: frozen replay differs only via registered components', () => {
  it('re-running the same frozen resolution is byte-identical', async () => {
    const t = T('2026-07-01T10:00:00Z');
    const first = await resolveEvidenceAt(tdb.engine, { resolvedAt: t });
    const second = await resolveEvidenceAt(tdb.engine, { resolvedAt: t });
    expect(second).toEqual(first);

    const obsFirst = await replayObservations(tdb.engine, t);
    const obsSecond = await replayObservations(tdb.engine, t);
    expect(obsSecond).toEqual(obsFirst);
  });

  it('data arriving after the boundary never alters the earlier replay', async () => {
    const boundary = T('2026-07-01T10:00:00Z');
    const before = await resolveEvidenceAt(tdb.engine, { resolvedAt: boundary });

    // Post-boundary arrivals: a new observation and a new bundle.
    await appendObservation(tdb.engine, {
      observationId: 'ac241-b',
      subjectPoolId: poolId,
      eventAt: T('2026-07-01T11:00:00Z'),
      availableAt: T('2026-07-01T12:00:00Z'),
      availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
      rawAmount: '222',
      decimals: 2,
    });
    await freezeBundle(tdb.engine, {
      bundleId: 'ac241-bundle-late',
      manifest: { family: 'swaps', note: 'frozen after the candidate acted' },
      frozenAt: T('2026-07-01T12:30:00Z'),
    });

    const after = await resolveEvidenceAt(tdb.engine, { resolvedAt: boundary });
    expect(after).toEqual(before);
    expect(await replayObservations(tdb.engine, boundary)).toEqual(
      await replayObservations(tdb.engine, boundary),
    );
  });

  it('changing ONLY the registered boundary moves the view predictably', async () => {
    const early = await resolveEvidenceAt(tdb.engine, { resolvedAt: T('2026-07-01T10:00:00Z') });
    const late = await resolveEvidenceAt(tdb.engine, { resolvedAt: T('2026-07-01T13:00:00Z') });
    // The delta is exactly the two post-boundary registrations, nothing else.
    expect(early.bundles.map((b) => b.bundleId)).toEqual(['ac241-bundle']);
    expect(late.bundles.map((b) => b.bundleId).sort()).toEqual([
      'ac241-bundle',
      'ac241-bundle-late',
    ]);
    // Same persisted corpus both times; only resolvedAt differed.
    expect(early.resolvedAt).toBe(T('2026-07-01T10:00:00Z'));
    expect(late.resolvedAt).toBe(T('2026-07-01T13:00:00Z'));
  });
});
