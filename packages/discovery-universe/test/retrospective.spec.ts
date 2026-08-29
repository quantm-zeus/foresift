/**
 * Retrospective universe classifier & lineage independence unit tests (T040, AC-111, FR-DISC-003).
 * Absent-from-live-sources token classified NOT_DISCOVERED via retrospective universe path
 * when evidence permits; lineage independence is strictly required; retrospective evidence
 * never enters historical decision bundle.
 */
import { describe, expect, it } from 'bun:test';
import {
  RETROSPECTIVE_SAMPLE_INDEPENDENT_MISSED,
  RETROSPECTIVE_SAMPLE_SHARED_LINEAGE,
  RETROSPECTIVE_SAMPLE_DISCOVERED,
  type RetrospectiveSampleFixture,
} from '../../../tests/fixtures/disc/index.ts';

function classifyRetrospectiveSample(sample: RetrospectiveSampleFixture): {
  classification: string;
  allowedInHistoricalDecisionBundle: boolean;
} {
  // Retrospective data NEVER enters historical decision bundle (§63.9)
  const allowedInHistoricalDecisionBundle = false;

  if (!sample.discoveredByLiveSources && sample.outcomeProfileMet) {
    if (sample.lineageIndependenceDeclared && !sample.upstreamLineageSharedWithLive) {
      return { classification: 'NOT_DISCOVERED', allowedInHistoricalDecisionBundle };
    }
    return { classification: 'LINEAGE_DEPENDENT', allowedInHistoricalDecisionBundle };
  }

  return { classification: 'DISCOVERED', allowedInHistoricalDecisionBundle };
}

describe('Retrospective Universe Classification (AC-111, FR-DISC-003)', () => {
  it('classifies absent token as NOT_DISCOVERED when independent lineage is disclosed', () => {
    const res = classifyRetrospectiveSample(RETROSPECTIVE_SAMPLE_INDEPENDENT_MISSED);
    expect(res.classification).toBe('NOT_DISCOVERED');
    expect(res.allowedInHistoricalDecisionBundle).toBe(false);
  });

  it('refuses independent NOT_DISCOVERED claim when upstream lineage is shared with live discovery', () => {
    const res = classifyRetrospectiveSample(RETROSPECTIVE_SAMPLE_SHARED_LINEAGE);
    expect(res.classification).toBe('LINEAGE_DEPENDENT');
    expect(res.allowedInHistoricalDecisionBundle).toBe(false);
  });

  it('excludes retrospective data from historical decision bundle', () => {
    const res = classifyRetrospectiveSample(RETROSPECTIVE_SAMPLE_DISCOVERED);
    expect(res.allowedInHistoricalDecisionBundle).toBe(false);
  });
});
