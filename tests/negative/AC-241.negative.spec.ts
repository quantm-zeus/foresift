/**
 * AC-241 negative / failure-path.
 * Traces: FR-DATA-003, INV-005.
 * The frozen-replay surface has no current-state bypass: every replay
 * entrypoint requires an explicit boundary; an absent or hidden boundary
 * fails the replay with a typed error instead of falling back to "now".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, utcTimestamp } from '@foresift/domain';
import { appendObservation, replayObservations } from '@foresift/persistence';
import { resolveEvidenceAt } from '@foresift/evidence';
import { expectForesiftError, makeTestDatabase, seedPool } from '../acceptance/helpers.ts';

let tdb: Awaited<ReturnType<typeof makeTestDatabase>>;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const poolId = await seedPool(tdb.engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac241',
  });
  await appendObservation(tdb.engine, {
    observationId: 'ac241n-a',
    subjectPoolId: poolId,
    eventAt: utcTimestamp('2026-07-02T08:00:00Z'),
    availableAt: utcTimestamp('2026-07-02T09:00:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '5',
    decimals: 2,
  });
});

afterAll(async () => {
  if (tdb) await tdb.db.close();
});

describe('AC-241 negative: hidden current-data calls fail the replay', () => {
  it('resolveEvidenceAt refuses to run without an explicit resolved-at boundary', async () => {
    await expectForesiftError(
      resolveEvidenceAt(tdb.engine, {} as never),
      ErrorCode.TIMESTAMP_INVALID,
    );
    await expectForesiftError(
      resolveEvidenceAt(tdb.engine, { resolvedAt: undefined as never }),
      ErrorCode.TIMESTAMP_INVALID,
    );
  });

  it('replayObservations refuses a hidden boundary instead of defaulting to now', async () => {
    await expectForesiftError(
      replayObservations(tdb.engine, undefined as never),
      ErrorCode.TIMESTAMP_INVALID,
    );
  });

  it('replayObservations refuses non-UTC boundaries (no local-time leakage)', async () => {
    await expectForesiftError(
      replayObservations(tdb.engine, '2026-07-02T09:00:00+00:00' as never),
      ErrorCode.TIMESTAMP_INVALID,
    );
  });

  it('the current view stays unreachable through the replay surface', async () => {
    // Data available long after any sane boundary can only appear through the
    // explicit currentObservations path — never via resolveEvidenceAt/replay.
    const far = utcTimestamp('2020-01-01T00:00:00Z');
    const resolution = await resolveEvidenceAt(tdb.engine, { resolvedAt: far });
    const replayed = await replayObservations(tdb.engine, far);
    expect(resolution.observations).toEqual([]);
    expect(resolution.bundles).toEqual([]);
    expect(replayed).toEqual([]);
  });
});
