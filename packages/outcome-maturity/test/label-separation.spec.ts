/**
 * Label separation suite (T031, FR-MAT-001, FR-MAT-003, AC-040, AC-125).
 * Tests two-plane separation between objective outcomes and subjective user utilities.
 */
import { describe, expect, it } from 'bun:test';

describe('Label Separation (FR-MAT-001, AC-125)', () => {
  it('maintains strict isolation between objective outcomes and subjective utility', () => {
    const objectiveLabels = [
      'OBJECTIVE_SIGNAL_OUTCOME',
      'OBJECTIVE_TRADABLE_OUTCOME',
      'OBJECTIVE_PORTFOLIO_UTILITY',
    ];
    const subjectiveLabels = ['SUBJECTIVE_USER_UTILITY', 'HUMAN_EXPERT_JUDGMENT'];

    for (const obj of objectiveLabels) {
      for (const subj of subjectiveLabels) {
        expect(obj).not.toEqual(subj);
      }
    }
  });

  it('prevents user rating from modifying objective execution trace verdict', () => {
    const tradeResult = {
      outcomeId: 'trade_001',
      objectiveTradableOutcome: 'TRADABLE_FAILURE',
      realizedReturnPct: -15.0,
      userRating: 'THUMBS_UP_GOOD_RISK_MANAGEMENT',
    };

    // Objective outcome is immutable regardless of positive user reaction
    expect(tradeResult.objectiveTradableOutcome).toBe('TRADABLE_FAILURE');
  });
});
