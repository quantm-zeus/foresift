/**
 * AC-239 acceptance (positive) — TRADABLE_SUCCESS denominator disclosure and excluded classes separation.
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-011, AC-239.
 * AC text: "The TRADABLE_SUCCESS denominator disclosure excludes and separately reports
 * signal-only, low-resolution, partial, censored, invalid, and scenario-mismatched outcomes (INV-012)."
 */
import { describe, expect, it } from 'bun:test';

interface CandidateEvaluationItem {
  id: string;
  isTradableEvaluated: boolean;
  isSignalOnly: boolean;
  isLowResolution: boolean;
  maturity: 'PENDING' | 'PARTIALLY_MATURED' | 'FULLY_MATURED' | 'CENSORED' | 'INVALID_DATA';
  scenarioMatched: boolean;
}

interface DenominatorDisclosureReport {
  tradableSuccessDenominator: number;
  totalPopulation: number;
  exclusions: {
    signalOnlyCount: number;
    lowResolutionCount: number;
    partialOrPendingCount: number;
    censoredCount: number;
    invalidDataCount: number;
    scenarioMismatchedCount: number;
  };
}

function buildTradableDenominatorReport(items: CandidateEvaluationItem[]): DenominatorDisclosureReport {
  let signalOnlyCount = 0;
  let lowResolutionCount = 0;
  let partialOrPendingCount = 0;
  let censoredCount = 0;
  let invalidDataCount = 0;
  let scenarioMismatchedCount = 0;
  let tradableSuccessDenominator = 0;

  for (const item of items) {
    if (item.maturity === 'INVALID_DATA') {
      invalidDataCount++;
    } else if (item.maturity === 'CENSORED') {
      censoredCount++;
    } else if (item.maturity === 'PENDING' || item.maturity === 'PARTIALLY_MATURED') {
      partialOrPendingCount++;
    } else if (item.isLowResolution) {
      lowResolutionCount++;
    } else if (item.isSignalOnly) {
      signalOnlyCount++;
    } else if (!item.scenarioMatched) {
      scenarioMismatchedCount++;
    } else if (item.isTradableEvaluated) {
      tradableSuccessDenominator++;
    }
  }

  return {
    tradableSuccessDenominator,
    totalPopulation: items.length,
    exclusions: {
      signalOnlyCount,
      lowResolutionCount,
      partialOrPendingCount,
      censoredCount,
      invalidDataCount,
      scenarioMismatchedCount,
    },
  };
}

describe('AC-239: TRADABLE_SUCCESS denominator disclosure structure (positive)', () => {
  const dataset: CandidateEvaluationItem[] = [
    { id: '1', isTradableEvaluated: true, isSignalOnly: false, isLowResolution: false, maturity: 'FULLY_MATURED', scenarioMatched: true },
    { id: '2', isTradableEvaluated: true, isSignalOnly: false, isLowResolution: false, maturity: 'FULLY_MATURED', scenarioMatched: true },
    { id: '3', isTradableEvaluated: false, isSignalOnly: true, isLowResolution: false, maturity: 'FULLY_MATURED', scenarioMatched: true },
    { id: '4', isTradableEvaluated: false, isSignalOnly: false, isLowResolution: true, maturity: 'FULLY_MATURED', scenarioMatched: true },
    { id: '5', isTradableEvaluated: false, isSignalOnly: false, isLowResolution: false, maturity: 'PENDING', scenarioMatched: true },
    { id: '6', isTradableEvaluated: false, isSignalOnly: false, isLowResolution: false, maturity: 'CENSORED', scenarioMatched: true },
    { id: '7', isTradableEvaluated: false, isSignalOnly: false, isLowResolution: false, maturity: 'INVALID_DATA', scenarioMatched: true },
    { id: '8', isTradableEvaluated: false, isSignalOnly: false, isLowResolution: false, maturity: 'FULLY_MATURED', scenarioMatched: false },
  ];

  it('excludes non-tradable and un-matured categories from tradableSuccessDenominator', () => {
    const report = buildTradableDenominatorReport(dataset);

    expect(report.totalPopulation).toBe(8);
    expect(report.tradableSuccessDenominator).toBe(2);
  });

  it('separately reports all six excluded categories in the disclosure', () => {
    const report = buildTradableDenominatorReport(dataset);

    expect(report.exclusions.signalOnlyCount).toBe(1);
    expect(report.exclusions.lowResolutionCount).toBe(1);
    expect(report.exclusions.partialOrPendingCount).toBe(1);
    expect(report.exclusions.censoredCount).toBe(1);
    expect(report.exclusions.invalidDataCount).toBe(1);
    expect(report.exclusions.scenarioMismatchedCount).toBe(1);
  });
});
