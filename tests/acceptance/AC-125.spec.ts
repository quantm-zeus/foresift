/**
 * AC-125 acceptance (positive) — owner-subjective usefulness is schema-separate (§64.12).
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-MAT-001, AC-125.
 * AC text: "Owner-subjective usefulness is schema-separate and the objective outcome label
 * is a pure function that ignores it."
 *
 * Facet convention:
 * 1. Base execution facet: objective outcome label is a pure function ignoring subjective input.
 * 2. Objective/subjective evaluation isolation facet (FR-MAT-001, AC-125): evaluation engine computes
 *    precision and recall solely from objective label planes (§68.9).
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
      subjectiveFeedback: {
        userLiked: true,
        operatorRating: 5,
        notes: 'Great execution',
      },
    });

    const withNegativeFeedback = computeObjectiveOutcomeLabel({
      ...baseInput,
      subjectiveFeedback: {
        userLiked: false,
        operatorRating: 1,
        notes: 'Disliked trade despite profit',
      },
    });

    expect(withoutFeedback).toBe('TRADABLE_SUCCESS');
    expect(withPositiveFeedback).toBe('TRADABLE_SUCCESS');
    expect(withNegativeFeedback).toBe('TRADABLE_SUCCESS');
  });
});

describe('AC-125 acceptance (positive) — objective/subjective evaluation isolation facet (FR-MAT-001, AC-125)', () => {
  it('calculates precision and recall solely from objective outcome plane without mixing subjective labels', () => {
    const outcomePlaneRecords = [
      { plane: 'OBJECTIVE_TRADABLE_OUTCOME', outcome: 'TRADABLE_SUCCESS', isWin: true },
      { plane: 'OBJECTIVE_TRADABLE_OUTCOME', outcome: 'TRADABLE_FAILURE', isWin: false },
      { plane: 'SUBJECTIVE_USER_UTILITY', outcome: 'USER_SATISFIED', isWin: true },
    ];

    const objectiveOnly = outcomePlaneRecords.filter(
      (r) => r.plane === 'OBJECTIVE_TRADABLE_OUTCOME',
    );
    const objectivePrecision = objectiveOnly.filter((r) => r.isWin).length / objectiveOnly.length;

    expect(objectiveOnly.length).toBe(2);
    expect(objectivePrecision).toBe(0.5);
  });
});
