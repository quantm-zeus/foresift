/**
 * AC-020 negative / failure-path.
 * Traces: FR-DATA-003, INV-005/INV-006.
 * Attempts to read future evidence through each replay surface this package
 * exposes that resolves against an availability boundary (replay queries,
 * backfill visibility, current-view resolution); each attempt must fail
 * closed — exclusion, refusal, or typed error, never a silent leak.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AcquisitionState, ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  backfillVisibleForReplay,
  recordAcquisitionDecision,
  recordProbeAssignment,
  completeRetrieval,
} from '@foresift/persistence';
import { freezeBundle, projectMaturedCounts } from '@foresift/evidence';
import type { CacheKeyComponents } from '@foresift/shared-schemas';
import { assertExactOnlyCaching } from '../../packages/tool-core/src/cache-key.ts';
import { CacheStageChain } from '../../packages/tool-core/src/stages/cache.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  seedPool,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac201',
  });

  await appendObservation(engine, {
    observationId: 'ac20n-future-obs',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T09:00:00Z'),
    availableAt: T('2026-06-01T20:00:00Z'), // becomes available LONG after T below
    availabilityProvenance: 'HISTORICAL_QUERY_FETCHED_LATER',
    rawAmount: '777',
    decimals: 2,
  });
  await freezeBundle(engine, {
    bundleId: 'ac20n-future-bundle',
    manifest: { family: 'swaps', note: 'frozen after the replay boundary' },
    frozenAt: T('2026-06-01T21:00:00Z'),
  });

  // A completed RETURNED decision whose only evidence is the future bundle.
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac20n-decision',
    candidateId: 'cand/ac20n',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-01T08:00:00Z'),
  });
  await recordProbeAssignment(engine, {
    decisionId: 'ac20n-decision',
    assignment: {
      eligibilityStratum: 'stratum-a',
      assignmentProbability: 0.5,
      seedProvenance: 'seed/deterministic-v1',
      selectionAt: T('2026-06-01T08:00:01Z'),
      requestedFields: ['volume'],
    },
    estimatedDecisionImpact: 0.25,
  });
  await completeRetrieval(engine, {
    decisionId: 'ac20n-decision',
    completedAt: T('2026-06-01T22:00:00Z'),
    state: AcquisitionState.RETURNED,
    evidenceIds: ['ac20n-future-bundle'],
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-020 negative: attempted future-evidence reads fail', () => {
  it('observation replay at T never returns the future-available row', async () => {
    const { replayObservations } = await import('@foresift/persistence');
    const resolved = await replayObservations(tdb.engine, T('2026-06-01T19:59:59.999Z'));
    expect(resolved.map((r) => r.observationId)).not.toContain('ac20n-future-obs');
  });

  it('evidence replay at T never returns the later-frozen bundle', async () => {
    const { resolveEvidenceAt } = await import('@foresift/evidence');
    const resolution = await resolveEvidenceAt(tdb.engine, {
      resolvedAt: T('2026-06-01T20:59:59.999Z'),
    });
    expect(resolution.bundles.map((b) => b.bundleId)).not.toContain('ac20n-future-bundle');
  });

  it('a backfilled historical row is refused entry into a simulated decision before its actual available_at', () => {
    const visible = backfillVisibleForReplay(
      {
        historicalEventAt: T('2026-06-01T09:00:00Z'),
        availableAt: T('2026-06-01T20:00:00Z'),
      },
      T('2026-06-01T12:00:00Z'),
    );
    expect(visible).toBe(false);
  });

  it('a maturity window reaching past the replay boundary is refused with a typed error', async () => {
    await expectForesiftError(
      projectMaturedCounts(tdb.engine, {
        candidateId: 'cand/ac20n',
        evidenceFamily: 'swaps',
        windowStartInclusive: T('2026-06-01T00:00:00Z'),
        windowEndInclusive: T('2026-06-01T23:00:00Z'), // beyond resolvedAt below
        resolvedAt: T('2026-06-01T19:00:00Z'),
        promotionThreshold: 1,
      }),
      ErrorCode.SOURCE_FROZEN_COUNT_IMMUTABLE,
    );
  });

  it('the future bundle cannot be counted as matured evidence for any earlier boundary', async () => {
    const projection = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac20n',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-01T18:00:00Z'),
      resolvedAt: T('2026-06-01T18:00:00Z'),
      promotionThreshold: 1,
    });
    // The completion (22:00) and the freeze (21:00) both post-date the
    // boundary: the count is honestly zero, never inflated by what exists now.
    expect(projection.maturedCount).toBe(0);
    expect(projection.promotionEligible).toBe(false);
  });
});

describe('AC-020 negative (tool-core substrate): attempted future cache reads and prohibited caching fail closed', () => {
  it('cache lookup with decisionTime strictly before entry stored_at returns MISS', async () => {
    const cacheChain = new CacheStageChain({
      engine: tdb.engine,
      now: () => '2026-06-01T12:00:00Z',
    });

    const components: CacheKeyComponents = {
      provider: 'first-party-dex-observer',
      operation: 'get_asset_identity',
      operationVersion: '1.0.0',
      chain: 'eip155:1',
      canonicalEntityIdentity: 'eip155:1:0x00000000000000000000000000000000000ac201',
      normalizedArguments: { address: '0x00000000000000000000000000000000000ac201' },
      fieldProjection: ['symbol'],
      asOf: '2026-06-01T12:00:00Z',
      licensePolicyVersion: 'rights-1',
    };

    await cacheChain.storeIfPermitted({
      components,
      payloadRef: 'obj://core-cache/ac20n-entry-1',
      storedAt: '2026-06-01T20:00:00Z',
      rightsAllowed: true,
      policy: { cachingPermitted: true },
    });

    const lookup = await cacheChain.lookup({
      components,
      holderMode: 'MCP_MANUAL',
      decisionTime: '2026-06-01T19:59:59.999Z',
    });
    expect(lookup.outcome).toBe('MISS');
  });

  it('assertExactOnlyCaching refuses semantic cache strategy for financial and identity data classes', () => {
    expect(() =>
      assertExactOnlyCaching({ requestedStrategy: 'SEMANTIC', dataClass: 'FINANCIAL' }),
    ).toThrow(/SEMANTIC_CACHE_FORBIDDEN|financial/i);

    expect(() =>
      assertExactOnlyCaching({ requestedStrategy: 'SEMANTIC', dataClass: 'IDENTITY' }),
    ).toThrow(/SEMANTIC_CACHE_FORBIDDEN|identity/i);

    expect(() =>
      assertExactOnlyCaching({ requestedStrategy: 'EXACT', dataClass: 'FINANCIAL' }),
    ).not.toThrow();
  });
});

