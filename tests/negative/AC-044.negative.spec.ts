/**
 * AC-044 negative (failure) — presenting best configuration in-sample without reporting full trial set is refused.
 * Traces: FR-EVAL-001, AC-044.
 */
import { describe, expect, it } from 'bun:test';

function validateExperimentRegistrySubmission(submission: {
  selectedConfigOnly: boolean;
  totalTrialsReported: number;
}) {
  if (submission.selectedConfigOnly || submission.totalTrialsReported <= 1) {
    throw new Error('CHERRY_PICKED_CONFIGURATION_WITHOUT_TRIAL_HISTORY_REFUSED');
  }
  return true;
}

describe('AC-044 negative: reporting only best configuration without full attempted configuration history is refused', () => {
  it('throws when submission omits attempted trial configurations', () => {
    expect(() =>
      validateExperimentRegistrySubmission({
        selectedConfigOnly: true,
        totalTrialsReported: 1,
      }),
    ).toThrow('CHERRY_PICKED_CONFIGURATION_WITHOUT_TRIAL_HISTORY_REFUSED');
  });
});
