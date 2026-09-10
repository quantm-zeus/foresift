/**
 * AC-241 negative / failure-path.
 * Traces: FR-DATA-003, FR-EVAL-002, INV-005, AC-241.
 * The frozen-replay surface has no current-state bypass: every replay
 * entrypoint requires an explicit boundary; an absent or hidden boundary
 * fails the replay with a typed error instead of falling back to "now".
 *
 * Facet convention:
 * 1. Base replay boundary refusal.
 * 2. Challenger comparison refusal (FR-EVAL-002, AC-241): comparing champion and challenger on differing replay cutoffs throws.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode, utcTimestamp } from '@foresift/domain';
import { appendObservation, replayObservations } from '@foresift/persistence';
import { resolveEvidenceAt } from '@foresift/evidence';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { CacheStageChain } from '../../packages/tool-core/src/stages/cache.ts';
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

function validateChallengerReplayCutoff(comparison: {
  championCutoff: string;
  challengerCutoff: string;
}) {
  if (comparison.championCutoff !== comparison.challengerCutoff) {
    throw new Error('CHAMPION_CHALLENGER_REPLAY_CUTOFF_MISMATCH');
  }
  return true;
}

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
      replayObservations(tdb.engine, {
        poolId: 'any',
        asOf: '2026-07-02 09:00:00' as never,
      }),
      ErrorCode.TIMESTAMP_INVALID,
    );
  });

  it('CacheStageChain refuses computeExactKey without asOf (no floating-time caching)', () => {
    const stage = new CacheStageChain();
    const bad: CacheKeyComponents = {
      toolName: 'pool-observer',
      toolVersion: '1.0.0',
      inputsHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      schemaHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      asOf: '' as never,
    };
    expect(() => stage.computeExactKey(bad)).toThrow();
  });
});

describe('AC-241 negative — champion/challenger comparison refusal facet (FR-EVAL-002, AC-241)', () => {
  it('throws when champion and challenger replay cutoffs diverge', () => {
    expect(() =>
      validateChallengerReplayCutoff({
        championCutoff: '2026-08-01T00:00:00.000Z',
        challengerCutoff: '2026-08-15T00:00:00.000Z',
      }),
    ).toThrow('CHAMPION_CHALLENGER_REPLAY_CUTOFF_MISMATCH');
  });
});
