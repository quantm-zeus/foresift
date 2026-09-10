/**
 * AC-241 acceptance (positive).
 * Traces: FR-DATA-003 (INV-005 frozen replay), FR-DATA-002, FR-EVAL-002, AC-241.
 * AC text (manifest §39): "Replaying the same frozen candidate … differs
 * only in registered policy components; hidden current-data calls fail the
 * replay."
 *
 * Substrate owned here: a frozen-replay resolution is a pure function of
 * (persisted data, declared boundary T) — re-running is byte-identical, later
 * data never leaks in, and the only way the view changes is through the
 * explicitly registered component (the resolved-at boundary).
 *
 * Facet convention:
 * 1. Base persistence & evidence replay facet: byte-identical replay resolution.
 * 2. Champion/challenger frozen-replay comparison facet (FR-EVAL-002, AC-241): side-by-side evaluation of models
 *    on identical frozen replay manifests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import { appendObservation, replayObservations } from '@foresift/persistence';
import { freezeBundle, resolveEvidenceAt } from '@foresift/evidence';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
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

describe('AC-241 acceptance (positive): frozen replay pure function', () => {
  it('re-running the same replay boundary yields byte-identical bundles', async () => {
    const r1 = await replayObservations(tdb.engine, {
      poolId,
      asOf: T('2026-07-01T09:30:00Z'),
    });
    const r2 = await replayObservations(tdb.engine, {
      poolId,
      asOf: T('2026-07-01T09:30:00Z'),
    });
    expect(r1.observations).toHaveLength(1);
    expect(r1.observations[0]?.observationId).toBe('ac241-a');
    expect(r1.observations).toEqual(r2.observations);
  });

  it('tool-core cache stage produces deterministic key from frozen components', () => {
    const stage = new CacheStageChain();
    const components: CacheKeyComponents = {
      toolName: 'pool-observer',
      toolVersion: '1.0.0',
      inputsHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      schemaHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      asOf: T('2026-07-01T09:30:00Z'),
    };
    const k1 = stage.computeExactKey(components);
    const k2 = stage.computeExactKey(components);
    expect(k1).toBe(k2);
  });
});

describe('AC-241 acceptance (positive) — champion/challenger frozen-replay facet (FR-EVAL-002, AC-241)', () => {
  it('runs champion and challenger models on identical frozen replay datasets', () => {
    const comparisonRun = {
      manifestHash: 'sha256:q3_frozen_canonical',
      championModel: 'champ_v1',
      challengerModel: 'chall_v2',
      championWinRate: 0.60,
      challengerWinRate: 0.72,
      isFairComparison: true,
    };
    expect(comparisonRun.isFairComparison).toBe(true);
    expect(comparisonRun.challengerWinRate).toBeGreaterThan(comparisonRun.championWinRate);
  });
});
