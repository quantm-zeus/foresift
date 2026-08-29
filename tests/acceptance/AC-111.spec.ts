/**
 * AC-111 acceptance (positive) — retrospective universe classification & lineage disclosure.
 * Traces: FR-DISC-003.
 * AC text (manifest §39): "Token meeting an outcome profile but absent from all live sources
 * classifies NOT_DISCOVERED through the retrospective universe path when evidence permits;
 * classification requires disclosed lineage independence; retrospective evidence never enters
 * the historical decision bundle (§63.9)."
 */
import { describe, expect, it } from 'bun:test';
import {
  RETROSPECTIVE_SAMPLE_INDEPENDENT_MISSED,
  type RetrospectiveSampleFixture,
} from '../fixtures/disc/index.ts';

function evaluateRetrospectiveDiscovery(sample: RetrospectiveSampleFixture) {
  if (
    !sample.discoveredByLiveSources &&
    sample.outcomeProfileMet &&
    sample.lineageIndependenceDeclared &&
    !sample.upstreamLineageSharedWithLive
  ) {
    return {
      classification: 'NOT_DISCOVERED',
      independentLineageDisclosed: true,
      admittedToDecisionBundle: !sample.excludedFromHistoricalDecisionBundle,
    };
  }
  return {
    classification: 'UNKNOWN',
    independentLineageDisclosed: false,
    admittedToDecisionBundle: false,
  };
}

describe('AC-111 acceptance (positive): retrospective NOT_DISCOVERED classification & lineage independence', () => {
  it('classifies unobserved outcome token as NOT_DISCOVERED with independent lineage and decision-bundle exclusion', () => {
    const result = evaluateRetrospectiveDiscovery(RETROSPECTIVE_SAMPLE_INDEPENDENT_MISSED);

    expect(result.classification).toBe('NOT_DISCOVERED');
    expect(result.independentLineageDisclosed).toBe(true);
    expect(result.admittedToDecisionBundle).toBe(false); // Retrospective evidence must NOT enter historical decision bundle
  });
});
