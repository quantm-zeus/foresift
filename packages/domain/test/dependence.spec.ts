import { describe, expect, it } from 'bun:test';
import {
  ALL_DEPENDENCE_METHODS,
  DependenceMethod,
  calculateEffectiveIndependenceMultiplier,
  dependenceMethod,
  isEdgeValidAtTimestamp,
} from '../src/index.ts';

describe('Source dependence vocabulary and effective independence policy (FR-DATA-013, FR-DATA-014, FR-DATA-015, AC-245, AC-246, AC-247)', () => {
  it('declares the exact dependence methods (DECLARED, EMPIRICAL)', () => {
    expect([...ALL_DEPENDENCE_METHODS].sort()).toEqual(['DECLARED', 'EMPIRICAL'].sort() as DependenceMethod[]);
  });

  it('parses valid dependence methods fail-closed', () => {
    expect(dependenceMethod('DECLARED')).toBe(DependenceMethod.DECLARED);
    expect(dependenceMethod('EMPIRICAL')).toBe(DependenceMethod.EMPIRICAL);
  });

  it('refuses unknown dependence methods fail-closed', () => {
    expect(() => dependenceMethod('STATISTICAL_GUESS')).toThrow();
    expect(() => dependenceMethod('')).toThrow();
  });

  it('evaluates validity interval at point-in-time timestamp T (plan ADR-3)', () => {
    const edge = {
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2026-06-01T00:00:00Z',
    };

    expect(isEdgeValidAtTimestamp(edge, '2025-12-31T23:59:59Z')).toBe(false);
    expect(isEdgeValidAtTimestamp(edge, '2026-01-01T00:00:00Z')).toBe(true);
    expect(isEdgeValidAtTimestamp(edge, '2026-03-15T12:00:00Z')).toBe(true);
    expect(isEdgeValidAtTimestamp(edge, '2026-06-01T00:00:00Z')).toBe(true);
    expect(isEdgeValidAtTimestamp(edge, '2026-06-01T00:00:01Z')).toBe(false);
  });

  it('reduces effective independence multiplier automatically when correlation or shared lineage is detected (App O.8)', () => {
    // Independent: low correlation, no shared upstream
    const independentInputs = {
      sharedUpstreamLineage: false,
      valueErrorTimingCorrelation: 0.1,
      outageOverlap: 0.05,
      firstSeenLagAgreement: 0.2,
      fingerprintSimilarity: 0.15,
    };
    const indepMult = calculateEffectiveIndependenceMultiplier(independentInputs);
    expect(indepMult).toBeCloseTo(1.0, 2);

    // Highly correlated / shared upstream lineage
    const correlatedInputs = {
      sharedUpstreamLineage: true,
      valueErrorTimingCorrelation: 0.95,
      outageOverlap: 0.8,
      firstSeenLagAgreement: 0.9,
      fingerprintSimilarity: 0.95,
    };
    const corrMult = calculateEffectiveIndependenceMultiplier(correlatedInputs);
    expect(corrMult).toBeLessThan(0.5);
    expect(corrMult).toBeGreaterThanOrEqual(0.0);
  });

  it('multiplier function is monotonically decreasing with respect to correlation metrics', () => {
    const low = calculateEffectiveIndependenceMultiplier({
      sharedUpstreamLineage: false,
      valueErrorTimingCorrelation: 0.3,
      outageOverlap: 0.2,
      firstSeenLagAgreement: 0.2,
      fingerprintSimilarity: 0.2,
    });
    const high = calculateEffectiveIndependenceMultiplier({
      sharedUpstreamLineage: false,
      valueErrorTimingCorrelation: 0.85,
      outageOverlap: 0.7,
      firstSeenLagAgreement: 0.8,
      fingerprintSimilarity: 0.8,
    });
    expect(low).toBeGreaterThan(high);
  });
});
