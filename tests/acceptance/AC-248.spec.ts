/**
 * AC-248 acceptance (positive).
 * Traces: FR-DATA-003, FR-DATA-004 (immutable replay-correct counts).
 * AC text (manifest §39, abridged): "Promotion fails below the registered
 * mature success/failure/risk counts…"
 *
 * Non-goal beyond substrate: promotion machinery belongs to later packages.
 * This suite proves the counts they consume are honest below thresholds,
 * immutable under re-resolution, and never inflated toward a gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AcquisitionState, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  completeRetrieval,
  maturedEvidenceCountAt,
  recordAcquisitionDecision,
  recordProbeAssignment,
} from '@foresift/persistence';
import { freezeBundle, projectMaturedCounts } from '@foresift/evidence';
import { closeTestDatabase, makeTestDatabase, seedPool, type TestDatabase } from './helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;
let poolId: string;

/** Persist one RETURNED retrieval maturing at `completedAt`, citing `bundleId`. */
async function maturedRetrieval(
  decisionId: string,
  bundleId: string,
  completedAt: UtcTimestamp,
): Promise<void> {
  await recordAcquisitionDecision(tdb.engine, {
    decisionId,
    candidateId: 'cand/ac248',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: completedAt,
  });
  await recordProbeAssignment(tdb.engine, {
    decisionId,
    assignment: {
      eligibilityStratum: 'stratum-a',
      assignmentProbability: 0.5,
      seedProvenance: 'seed/deterministic-v1',
      selectionAt: completedAt,
      requestedFields: ['volume'],
    },
    estimatedDecisionImpact: 0.2,
  });
  await completeRetrieval(tdb.engine, {
    decisionId,
    completedAt,
    state: AcquisitionState.RETURNED,
    // bundleId joins the decision to the frozen bundle's identity row — it is
    // NOT the content hash itself; the evidence index refuses conflating them.
    evidenceIds: [bundleId],
  });
}

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac248',
  });
  // Two matured retrievals with frozen bundles (June 1–2), one later (July).
  await freezeBundle(engine, {
    bundleId: 'ac248-bundle-1',
    manifest: { family: 'swaps', window: '2026-06-01' },
    frozenAt: T('2026-06-01T09:30:00Z'),
  });
  await maturedRetrieval('ac248-ret-1', 'ac248-bundle-1', T('2026-06-01T10:00:00Z'));
  await freezeBundle(engine, {
    bundleId: 'ac248-bundle-2',
    manifest: { family: 'swaps', window: '2026-06-02' },
    frozenAt: T('2026-06-02T09:30:00Z'),
  });
  await maturedRetrieval('ac248-ret-2', 'ac248-bundle-2', T('2026-06-02T10:00:00Z'));

  // A plain observation so the identity/replay substrate is exercised too.
  await appendObservation(engine, {
    observationId: 'ac248-obs',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T08:00:00Z'),
    availableAt: T('2026-06-01T08:30:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '42',
    decimals: 2,
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-248: immutable projections reported honestly below thresholds', () => {
  it('a count of 2 against threshold 5 is reported below threshold, not inflated', async () => {
    const projection = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-03T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: 5,
    });
    expect(projection.maturedCount).toBe(2);
    expect(projection.promotionThreshold).toBe(5);
    expect(projection.promotionEligible).toBe(false); // honestly ineligible
  });

  it('the same count clears an honest threshold of 2', async () => {
    const projection = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-03T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: 2,
    });
    expect(projection.maturedCount).toBe(2);
    expect(projection.promotionEligible).toBe(true);
  });

  it('re-resolution is identical — projections are immutable', async () => {
    const input = {
      candidateId: 'cand/ac248',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-03T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: 5,
    };
    const first = await projectMaturedCounts(tdb.engine, input);
    const second = await projectMaturedCounts(tdb.engine, input);
    expect(second).toEqual(first);

    const rawFirst = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac248',
      t: T('2026-06-05T00:00:00Z'),
    });
    const rawSecond = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac248',
      t: T('2026-06-05T00:00:00Z'),
    });
    expect(rawSecond).toBe(rawFirst);
  });

  it('later maturity never reaches back into an earlier boundary', async () => {
    await freezeBundle(tdb.engine, {
      bundleId: 'ac248-bundle-july',
      manifest: { family: 'swaps', window: '2026-07-01' },
      frozenAt: T('2026-07-01T09:30:00Z'),
    });
    await maturedRetrieval('ac248-ret-july', 'ac248-bundle-july', T('2026-07-01T10:00:00Z'));
    const beforeBoundary = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-03T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: 5,
    });
    expect(beforeBoundary.maturedCount).toBe(2); // unchanged by July maturity
    const later = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-07-02T00:00:00Z'),
      resolvedAt: T('2026-07-05T00:00:00Z'),
      promotionThreshold: 5,
    });
    expect(later.maturedCount).toBe(3); // visible only to the later horizon
  });
});
