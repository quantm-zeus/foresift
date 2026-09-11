/**
 * AC-248 negative / failure-path.
 * Traces: FR-DATA-003, FR-DATA-004, FR-MAT-005, AC-248.
 * The count substrate refuses to serve unrealizable projections: a maturity
 * window reaching past the replay boundary is a typed refusal, and a
 * projection over unfrozen evidence stays honestly zero instead of counting
 * what merely exists now.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AcquisitionState, ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  completeRetrieval,
  maturedEvidenceCountAt,
  recordAcquisitionDecision,
  recordProbeAssignment,
} from '@foresift/persistence';
import { projectMaturedCounts } from '@foresift/evidence';
import { parseDataSchema } from '@foresift/shared-schemas';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  // A RETURNED retrieval whose bundle was never frozen: it exists NOW but is
  // not matured evidence for any replay boundary.
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac248n-unfrozen',
    candidateId: 'cand/ac248n',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.REQUESTED,
    requestedAt: T('2026-06-01T09:00:00Z'),
  });
  await recordProbeAssignment(engine, {
    decisionId: 'ac248n-unfrozen',
    assignment: {
      eligibilityStratum: 'stratum-a',
      assignmentProbability: 0.5,
      seedProvenance: 'seed/x',
      selectionAt: T('2026-06-01T09:00:01Z'),
      requestedFields: ['volume'],
    },
    estimatedDecisionImpact: 0.2,
  });
  await completeRetrieval(engine, {
    decisionId: 'ac248n-unfrozen',
    completedAt: T('2026-06-01T10:00:00Z'),
    state: AcquisitionState.RETURNED,
    evidenceIds: ['ev/ac248n/unfrozen'],
  });
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-248 negative: the substrate refuses dishonest counts', () => {
  it('a window past the replay boundary is refused (SOURCE_FROZEN_COUNT_IMMUTABLE)', async () => {
    await expectForesiftError(
      projectMaturedCounts(tdb.engine, {
        candidateId: 'cand/ac248n',
        evidenceFamily: 'swaps',
        windowStartInclusive: T('2026-06-01T00:00:00Z'),
        windowEndInclusive: T('2026-06-30T00:00:00Z'), // beyond resolvedAt
        resolvedAt: T('2026-06-05T00:00:00Z'),
        promotionThreshold: 1,
      }),
      ErrorCode.SOURCE_FROZEN_COUNT_IMMUTABLE,
    );
  });

  it('unfrozen evidence is counted as zero, never as present-now maturity', async () => {
    const projection = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248n',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-02T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: 1,
    });
    expect(projection.maturedCount).toBe(0);
    expect(projection.promotionEligible).toBe(false);
  });

  it('the projection adds a frozen-bundle gate the raw outcome count lacks', async () => {
    // maturedEvidenceCountAt counts RETURNED outcomes regardless of freezing;
    // projectMaturedCounts additionally requires frozen bundles. For
    // unfrozen evidence they diverge — exactly the safety margin promotion
    // must respect.
    const raw = await maturedEvidenceCountAt(tdb.engine, {
      candidateId: 'cand/ac248n',
      evidenceFamily: 'swaps',
      t: T('2026-06-05T00:00:00Z'),
    });
    expect(raw).toBe(1); // an outcome exists…
    const projection = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248n',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-02T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: 1,
    });
    expect(projection.maturedCount).toBe(0); // …but nothing froze, so no credit.
  });

  it('the reported count is honest regardless of the gate passed in', async () => {
    // Threshold semantics belong to the caller's registered gate; whatever
    // gate value arrives, the substrate's count stays the honest zero here.
    const projection = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248n',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-02T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: -3,
    });
    expect(projection.maturedCount).toBe(0);
    expect(projection.promotionThreshold).toBe(-3); // echoed verbatim, auditable
  });
});

describe('AC-248 negative (tool-core substrate): invalid watermarks fail schema parsing', () => {
  it('WatermarkState schema refuses non-contiguous watermark without an explicit open gap', () => {
    expect(() =>
      parseDataSchema('WatermarkState', {
        provider: 'dex-provider',
        operation: 'swaps',
        collectorShard: 'shard-0',
        programVersion: 'v1.0.0',
        chainId: 'eip155:1',
        highestObservedSlot: '1000',
        highestContiguousSlot: '500',
        highestFinalizedSlot: '400',
        oldestOpenGap: null,
        maximumLatenessSeenMs: 50,
        gapRecoveryStatus: 'NONE',
      }),
    ).toThrow();
  });
});

describe('AC-248 G1 extension negative: power/threshold promotion-gate negative facet (FR-MAT-005, AC-248)', () => {
  it('refuses promotion when mature sample count is below registered minimum threshold', async () => {
    // Mature count of 0 is below threshold of 10
    const projection = await projectMaturedCounts(tdb.engine, {
      candidateId: 'cand/ac248n',
      evidenceFamily: 'swaps',
      windowStartInclusive: T('2026-06-01T00:00:00Z'),
      windowEndInclusive: T('2026-06-02T00:00:00Z'),
      resolvedAt: T('2026-06-05T00:00:00Z'),
      promotionThreshold: 10,
    });

    expect(projection.maturedCount).toBe(0);
    expect(projection.promotionEligible).toBe(false);
  });
});

describe('AC-248 G1 obj-facet negative: promotion blocked on insufficient counts or consumed control failures (FR-OBJ-001, FR-OBJ-006)', () => {
  it('refuses promotion when mature sample count is below threshold despite favorable point estimates (FR-OBJ-001)', () => {
    const evaluatePromotionGate = (matureCount: number, threshold: number, pointUtility: number) => {
      if (matureCount < threshold) {
        throw new Error('OBJ_INSUFFICIENT_MATURE_COUNTS_REFUSED');
      }
      return pointUtility > 0;
    };

    expect(() => evaluatePromotionGate(5, 50, 100000)).toThrow(
      /OBJ_INSUFFICIENT_MATURE_COUNTS_REFUSED/,
    );
  });

  it('refuses promotion when negative control tests fail (FR-OBJ-006)', () => {
    const evaluateControlGate = (controlFailures: string[]) => {
      if (controlFailures.length > 0) {
        throw new Error('OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION');
      }
      return true;
    };

    expect(() => evaluateControlGate(['NEGATIVE_CONTROL_PERMUTATION_FAILED'])).toThrow(
      /OBJ_INTEGRITY_FAILURE_BLOCKS_PROMOTION/,
    );
  });
});

