/**
 * AC-151 acceptance (positive) — cluster/block intervals diverge from naive intervals on correlated fixtures (§68.6).
 * Traces: FR-MAT-005, AC-151.
 */
import { describe, expect, it } from 'bun:test';
import { CLUSTERED_INTERVAL_METHODS, evaluateActivationGate } from '@foresift/capability-registry';
import { GOLDEN_INTERVAL_CASES } from '../fixtures/eval/intervals-vectors.ts';
import { makeProdScope, passingOpportunityGateInput } from '../fixtures/prod/index.ts';

describe('AC-151 acceptance (positive): cluster-robust confidence intervals diverge from naive intervals on correlated tokens', () => {
  it('confirms that cluster-robust interval is significantly wider than naive interval on correlated tokens', () => {
    const correlatedCase = GOLDEN_INTERVAL_CASES.find(
      (c) => c.caseId === 'int_correlated_deployer_clusters',
    );
    expect(correlatedCase).toBeDefined();
    if (!correlatedCase) return;

    expect(correlatedCase.clusteredMetrics.ciWidth).toBeGreaterThan(
      correlatedCase.naiveMetrics.ciWidth,
    );
    expect(correlatedCase.divergenceFactor).toBeGreaterThan(2.0);
  });
});

// --- prod-scoped addition (T035, FR-PROD-001/002, AC-151) --------------------

describe('AC-151 prod-scoped: clustered-interval evidence gates PROVEN/ACTIVE', () => {
  it('passes the ordered gate with a clustered/block method that differs from the naive interval', () => {
    const scope = makeProdScope();
    const result = evaluateActivationGate(passingOpportunityGateInput(scope));
    expect(result.verdict).toBe('PASS');

    const evidence = passingOpportunityGateInput(scope).registeredStatisticalEvidence[0];
    expect(evidence).toBeDefined();
    expect(CLUSTERED_INTERVAL_METHODS as readonly string[]).toContain(evidence?.intervalMethod);
    expect(evidence?.clusterDefinition.length).toBeGreaterThan(0);
    expect(evidence?.clusteredDiffersFromNaive).toBe(true);
    expect(evidence?.naiveIntervalMethod).toBe('NAIVE_INDEPENDENT_TOKEN');
  });
});
