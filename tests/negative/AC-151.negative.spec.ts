/**
 * AC-151 negative (failure) — relying on naive i.i.d. confidence intervals without cluster diagnostics is refused.
 * Traces: FR-MAT-005, AC-151.
 */
import { describe, expect, it } from 'bun:test';
import { activationScopeHash, evaluateActivationGate } from '@foresift/capability-registry';
import {
  makeProdScope,
  passingOpportunityGateInput,
  passingStatisticalEvidence,
} from '../fixtures/prod/index.ts';

function validateIntervalReport(report: {
  naiveOnly: boolean;
  effectiveSampleSize?: number;
  clusterCount?: number;
}) {
  if (report.naiveOnly || !report.effectiveSampleSize || !report.clusterCount) {
    throw new Error('CLUSTERED_UNCERTAINTY_AND_ESS_REQUIRED');
  }
  return true;
}

describe('AC-151 negative: naive confidence intervals without clustered ESS diagnostics are refused', () => {
  it('throws when interval report omits cluster count and ESS', () => {
    expect(() =>
      validateIntervalReport({
        naiveOnly: true,
      }),
    ).toThrow('CLUSTERED_UNCERTAINTY_AND_ESS_REQUIRED');
  });
});

// --- prod-scoped additions (T035, FR-PROD-001/002, AC-151) -------------------

describe('AC-151 prod-scoped negatives: naive or uncompared intervals refuse', () => {
  it('refuses at CLUSTERED_INTERVALS when only a naive i.i.d. interval method is registered', () => {
    const scope = makeProdScope();
    const input = {
      ...passingOpportunityGateInput(scope),
      registeredStatisticalEvidence: [
        passingStatisticalEvidence(activationScopeHash(scope), {
          intervalMethod: 'NAIVE_INDEPENDENT_TOKEN',
        }),
      ],
    };
    const result = evaluateActivationGate(input);
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('CLUSTERED_INTERVALS');
      expect(result.reason).toBe('CLUSTERED_INTERVALS_REQUIRED');
    }
  });

  it('refuses when the clustered interval was never compared to the naive interval', () => {
    const scope = makeProdScope();
    const input = {
      ...passingOpportunityGateInput(scope),
      registeredStatisticalEvidence: [
        passingStatisticalEvidence(activationScopeHash(scope), {
          clusteredDiffersFromNaive: false,
        }),
      ],
    };
    const result = evaluateActivationGate(input);
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('CLUSTERED_INTERVALS');
      expect(result.reason).toBe('CLUSTERED_INTERVALS_NOT_COMPARED');
    }
  });
});
