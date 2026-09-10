/**
 * AC-041 negative (failure) — reporting precision alone without recall / universe gem coverage is refused.
 * Traces: FR-EVAL-003, FR-EVAL-005, AC-041.
 */
import { describe, expect, it } from 'bun:test';

function validateEvaluationMetricReport(report: {
  precision?: number;
  recall?: number;
  missedGemsEvaluated?: boolean;
}) {
  if (typeof report.precision === 'number' && typeof report.recall !== 'number') {
    throw new Error('PRECISION_WITHOUT_RECALL_DISCLOSURE_REFUSED');
  }
  if (!report.missedGemsEvaluated) {
    throw new Error('MISSED_GEMS_ANALYSIS_REQUIRED');
  }
  return true;
}

describe('AC-041 negative: standalone precision reporting without recall disclosure is refused', () => {
  it('throws when precision is provided without recall', () => {
    expect(() =>
      validateEvaluationMetricReport({
        precision: 0.85,
        missedGemsEvaluated: true,
      }),
    ).toThrow('PRECISION_WITHOUT_RECALL_DISCLOSURE_REFUSED');
  });

  it('throws when missed gems analysis is omitted', () => {
    expect(() =>
      validateEvaluationMetricReport({
        precision: 0.85,
        recall: 0.70,
        missedGemsEvaluated: false,
      }),
    ).toThrow('MISSED_GEMS_ANALYSIS_REQUIRED');
  });
});
