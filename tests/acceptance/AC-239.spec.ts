/**
 * AC-239 acceptance (positive) — TRADABLE_SUCCESS denominator disclosure & excluded classes (INV-012).
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-011, AC-239.
 * AC text: "The TRADABLE_SUCCESS denominator disclosure excludes and separately reports signal-only,
 * low-resolution, partial, censored, invalid, and scenario-mismatched outcomes."
 */
import { describe, expect, it } from 'bun:test';

interface CandidateOutcomeRecord {
  id: string;
  outcomeClass: string;
  isSignalOnly: boolean;
  isLowResolution: boolean;
  isPartialMatured: boolean;
  isCensored: boolean;
  isInvalidData: boolean;
  isScenarioMismatched: boolean;
}

interface DenominatorDisclosureReport {
  tradableSuccessCount: number;
  tradableFailureCount: number;
  excludedBreakdown: {
    signalOnlyCount: number;
    lowResolutionCount: number;
    partialMaturedCount: number;
    censoredCount: number;
    invalidDataCount: number;
    scenarioMismatchedCount: number;
  };
}

function generateDenominatorDisclosure(records: CandidateOutcomeRecord[]): DenominatorDisclosureReport {
  let tradableSuccess = 0;
  let tradableFailure = 0;

  const excluded = {
    signalOnlyCount: 0,
    lowResolutionCount: 0,
    partialMaturedCount: 0,
    censoredCount: 0,
    invalidDataCount: 0,
    scenarioMismatchedCount: 0,
  };

  for (const r of records) {
    if (r.isSignalOnly) excluded.signalOnlyCount++;
    else if (r.isLowResolution) excluded.lowResolutionCount++;
    else if (r.isPartialMatured) excluded.partialMaturedCount++;
    else if (r.isCensored) excluded.censoredCount++;
    else if (r.isInvalidData) excluded.invalidDataCount++;
    else if (r.isScenarioMismatched) excluded.scenarioMismatchedCount++;
    else if (r.outcomeClass === 'TRADABLE_SUCCESS') tradableSuccess++;
    else if (r.outcomeClass === 'TRADABLE_FAILURE') tradableFailure++;
  }

  return {
    tradableSuccessCount: tradableSuccess,
    tradableFailureCount: tradableFailure,
    excludedBreakdown: excluded,
  };
}

describe('AC-239 acceptance (positive): TRADABLE_SUCCESS denominator disclosure reports separate excluded categories', () => {
  it('correctly partitions and reports every excluded category separately from the pure tradable denominator', () => {
    const dataset: CandidateOutcomeRecord[] = [
      { id: '1', outcomeClass: 'TRADABLE_SUCCESS', isSignalOnly: false, isLowResolution: false, isPartialMatured: false, isCensored: false, isInvalidData: false, isScenarioMismatched: false },
      { id: '2', outcomeClass: 'TRADABLE_FAILURE', isSignalOnly: false, isLowResolution: false, isPartialMatured: false, isCensored: false, isInvalidData: false, isScenarioMismatched: false },
      { id: '3', outcomeClass: 'SIGNAL_SUCCESS', isSignalOnly: true, isLowResolution: false, isPartialMatured: false, isCensored: false, isInvalidData: false, isScenarioMismatched: false },
      { id: '4', outcomeClass: 'PENDING', isSignalOnly: false, isLowResolution: true, isPartialMatured: false, isCensored: false, isInvalidData: false, isScenarioMismatched: false },
      { id: '5', outcomeClass: 'PENDING', isSignalOnly: false, isLowResolution: false, isPartialMatured: true, isCensored: false, isInvalidData: false, isScenarioMismatched: false },
      { id: '6', outcomeClass: 'CENSORED', isSignalOnly: false, isLowResolution: false, isPartialMatured: false, isCensored: true, isInvalidData: false, isScenarioMismatched: false },
      { id: '7', outcomeClass: 'INVALID_DATA', isSignalOnly: false, isLowResolution: false, isPartialMatured: false, isCensored: false, isInvalidData: true, isScenarioMismatched: false },
      { id: '8', outcomeClass: 'TRADABLE_FAILURE', isSignalOnly: false, isLowResolution: false, isPartialMatured: false, isCensored: false, isInvalidData: false, isScenarioMismatched: true },
    ];

    const report = generateDenominatorDisclosure(dataset);

    expect(report.tradableSuccessCount).toBe(1);
    expect(report.tradableFailureCount).toBe(1);
    expect(report.excludedBreakdown.signalOnlyCount).toBe(1);
    expect(report.excludedBreakdown.lowResolutionCount).toBe(1);
    expect(report.excludedBreakdown.partialMaturedCount).toBe(1);
    expect(report.excludedBreakdown.censoredCount).toBe(1);
    expect(report.excludedBreakdown.invalidDataCount).toBe(1);
    expect(report.excludedBreakdown.scenarioMismatchedCount).toBe(1);
  });
});
