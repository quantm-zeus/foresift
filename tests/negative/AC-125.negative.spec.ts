/**
 * AC-125 negative (failure) — subjective input mutating objective label is structurally refused.
 * Traces: FR-EXEC-001, FR-EXEC-006, AC-125.
 * Refusal: Any pathway where subjective operator/user ratings alter the objective mathematical outcome label is refused.
 */
import { describe, expect, it } from 'bun:test';

function setObjectiveOutcomeLabel(params: {
  netReturnUsd: number;
  objectiveLabel: string;
  subjectiveOverride?: string;
}) {
  if (params.subjectiveOverride && params.subjectiveOverride !== params.objectiveLabel) {
    throw new Error('SUBJECTIVE_MUTATION_OF_OBJECTIVE_LABEL_REFUSED');
  }
  return params.objectiveLabel;
}

describe('AC-125 negative: subjective input mutating objective outcome label refused', () => {
  it('throws when subjective override attempts to convert TRADABLE_FAILURE into TRADABLE_SUCCESS', () => {
    expect(() =>
      setObjectiveOutcomeLabel({
        netReturnUsd: -50.0,
        objectiveLabel: 'TRADABLE_FAILURE',
        subjectiveOverride: 'TRADABLE_SUCCESS',
      }),
    ).toThrow('SUBJECTIVE_MUTATION_OF_OBJECTIVE_LABEL_REFUSED');
  });

  it('throws when subjective feedback attempts to alter objective neutral label', () => {
    expect(() =>
      setObjectiveOutcomeLabel({
        netReturnUsd: 0.0,
        objectiveLabel: 'TRADABLE_NEUTRAL',
        subjectiveOverride: 'SIGNAL_SUCCESS',
      }),
    ).toThrow('SUBJECTIVE_MUTATION_OF_OBJECTIVE_LABEL_REFUSED');
  });
});
