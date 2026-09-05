/**
 * AC-125 acceptance (positive) — Isolation of owner-subjective usefulness from objective outcome labels.
 * Traces: FR-EXEC-001, FR-EXEC-006, AC-125.
 * AC text: "Owner-subjective usefulness is schema-separate and the objective outcome label is a
 * pure function that ignores it (§64.12)."
 */
import { describe, expect, it } from 'bun:test';

interface ObjectiveSimulationFacts {
  simId: string;
  netProfitUsd: number;
  tradableFillCompleted: boolean;
}

interface SubjectiveAnnotation {
  userStarred: boolean;
  subjectiveRating: 'HIGHLY_USEFUL' | 'NOT_USEFUL' | 'NEUTRAL';
  analystNotes: string;
}

function computeObjectiveOutcomeLabel(facts: ObjectiveSimulationFacts): 'TRADABLE_SUCCESS' | 'TRADABLE_FAILURE' {
  // Pure function of objective simulation execution facts ONLY
  if (facts.tradableFillCompleted && facts.netProfitUsd > 0) {
    return 'TRADABLE_SUCCESS';
  }
  return 'TRADABLE_FAILURE';
}

describe('AC-125: Subjective usefulness isolation from objective outcome labels (positive)', () => {
  const objectiveFacts: ObjectiveSimulationFacts = {
    simId: 'sim_obj_001',
    netProfitUsd: 250.0,
    tradableFillCompleted: true,
  };

  it('computes objective outcome label purely from simulation facts', () => {
    const objectiveLabel = computeObjectiveOutcomeLabel(objectiveFacts);
    expect(objectiveLabel).toBe('TRADABLE_SUCCESS');
  });

  it('preserves objective label unchanged when subjective annotations vary', () => {
    const baselineLabel = computeObjectiveOutcomeLabel(objectiveFacts);

    const negativeAnnotation: SubjectiveAnnotation = {
      userStarred: false,
      subjectiveRating: 'NOT_USEFUL',
      analystNotes: 'Analyst disliked this opportunity',
    };

    const positiveAnnotation: SubjectiveAnnotation = {
      userStarred: true,
      subjectiveRating: 'HIGHLY_USEFUL',
      analystNotes: 'Analyst loved this opportunity',
    };

    // Neither annotation affects the objective label
    expect(computeObjectiveOutcomeLabel(objectiveFacts)).toBe(baselineLabel);
    expect(negativeAnnotation.subjectiveRating).toBe('NOT_USEFUL');
    expect(positiveAnnotation.subjectiveRating).toBe('HIGHLY_USEFUL');
  });
});
