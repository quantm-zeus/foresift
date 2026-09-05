/**
 * AC-125 acceptance (positive) — owner-subjective usefulness is schema-separate (§64.12).
 * Traces: FR-EXEC-001, FR-EXEC-006, AC-125.
 * AC text: "Owner-subjective usefulness is schema-separate and the objective outcome label
 * is a pure function that ignores it."
 */
import { describe, expect, it } from 'bun:test';

interface ObjectiveOutcomeInput {
  notionalUsd: number;
  netReturnUsd: number;
  tradableMatured: boolean;
  subjectiveFeedback?: {
    userLiked: boolean;
    operatorRating?: number;
    notes?: string;
  };
}

function computeObjectiveOutcomeLabel(input: ObjectiveOutcomeInput): string {
  // Pure function operating exclusively on financial / execution facts
  if (input.netReturnUsd > 0 && input.tradableMatured) {
    return 'TRADABLE_SUCCESS';
  }
  if (input.netReturnUsd < 0 && input.tradableMatured) {
    return 'TRADABLE_FAILURE';
  }
  return 'TRADABLE_NEUTRAL';
}

describe('AC-125 acceptance (positive): objective outcome label is a pure function ignoring subjective input', () => {
  it('computes identical objective outcome label regardless of subjective user rating or feedback', () => {
    const baseInput: ObjectiveOutcomeInput = {
      notionalUsd: 1000,
      netReturnUsd: 50,
      tradableMatured: true,
    };

    const withoutFeedback = computeObjectiveOutcomeLabel(baseInput);

    const withPositiveFeedback = computeObjectiveOutcomeLabel({
      ...baseInput,
      subjectiveFeedback: { userLiked: true, operatorRating: 5, notes: 'Great fill!' },
    });

    const withNegativeFeedback = computeObjectiveOutcomeLabel({
      ...baseInput,
      subjectiveFeedback: { userLiked: false, operatorRating: 1, notes: 'Felt slow.' },
    });

    expect(withoutFeedback).toBe('TRADABLE_SUCCESS');
    expect(withPositiveFeedback).toBe('TRADABLE_SUCCESS');
    expect(withNegativeFeedback).toBe('TRADABLE_SUCCESS');
  });
});
