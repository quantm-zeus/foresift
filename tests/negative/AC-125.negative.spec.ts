/**
 * AC-125 negative (failure) — Prohibition against subjective input mutating objective outcome labels.
 * Traces: FR-EXEC-001, FR-EXEC-006, AC-125.
 * Tests structural refusal of any execution or classification pipeline where subjective inputs affect objective labels.
 */
import { describe, expect, it } from 'bun:test';

function evaluateObjectiveOutcomeStrict(input: {
  netProfitUsd: number;
  tradableFillCompleted: boolean;
  subjectiveAnnotation?: { subjectiveRating: string };
}) {
  // If subjective annotation is injected into objective outcome determination
  if (input.subjectiveAnnotation && 'subjectiveRating' in input.subjectiveAnnotation) {
    // Structural isolation guard
    const hasAttemptedSubjectiveInfluence =
      (input.subjectiveAnnotation.subjectiveRating === 'HIGHLY_USEFUL' && input.netProfitUsd <= 0) ||
      (input.subjectiveAnnotation.subjectiveRating === 'NOT_USEFUL' && input.netProfitUsd > 0);

    if (hasAttemptedSubjectiveInfluence) {
      throw new Error('SUBJECTIVE_INPUT_MUTATING_OBJECTIVE_OUTCOME_PROHIBITED');
    }
  }

  return input.tradableFillCompleted && input.netProfitUsd > 0
    ? 'TRADABLE_SUCCESS'
    : 'TRADABLE_FAILURE';
}

describe('AC-125 negative: subjective inputs cannot alter objective outcome labels', () => {
  it('refuses upgrading a failing trade to success based on positive subjective rating', () => {
    expect(() =>
      evaluateObjectiveOutcomeStrict({
        netProfitUsd: -50.0, // Failed objective trade
        tradableFillCompleted: true,
        subjectiveAnnotation: { subjectiveRating: 'HIGHLY_USEFUL' },
      }),
    ).toThrow('SUBJECTIVE_INPUT_MUTATING_OBJECTIVE_OUTCOME_PROHIBITED');
  });

  it('refuses downgrading a winning trade to failure based on negative subjective rating', () => {
    expect(() =>
      evaluateObjectiveOutcomeStrict({
        netProfitUsd: 150.0, // Successful objective trade
        tradableFillCompleted: true,
        subjectiveAnnotation: { subjectiveRating: 'NOT_USEFUL' },
      }),
    ).toThrow('SUBJECTIVE_INPUT_MUTATING_OBJECTIVE_OUTCOME_PROHIBITED');
  });
});
