/**
 * AC-235 negative (failure) — passing incomplete matrix or silently weakened matrix is refused.
 * Traces: FR-EXEC-012, FR-EXEC-017, AC-235.
 * Refusal: Attempting to confirm tradability when the scenario matrix is incomplete or missing required pass keys is refused.
 */
import { describe, expect, it } from 'bun:test';

function validatePassMatrix(params: {
  requiredPassMatrix: string[];
  executedScenarioResults: Record<string, boolean>;
}) {
  for (const requiredScenario of params.requiredPassMatrix) {
    if (!(requiredScenario in params.executedScenarioResults)) {
      throw new Error('INCOMPLETE_SCENARIO_MATRIX_REFUSED');
    }
    if (!params.executedScenarioResults[requiredScenario]) {
      throw new Error('DECLARED_PASS_MATRIX_UNSATISFIED_REFUSED');
    }
  }
  return true;
}

describe('AC-235 negative: incomplete or weakened scenario pass matrix refused', () => {
  it('throws when required scenario from pass matrix was not executed', () => {
    expect(() =>
      validatePassMatrix({
        requiredPassMatrix: ['BASE_CASE', 'P90_DELAY', 'CONSERVATIVE_LATENCY_ADVERSE_SELECTION'],
        executedScenarioResults: {
          BASE_CASE: true,
          P90_DELAY: true,
        },
      }),
    ).toThrow('INCOMPLETE_SCENARIO_MATRIX_REFUSED');
  });

  it('throws when candidate fails a required scenario from the declared profile matrix', () => {
    expect(() =>
      validatePassMatrix({
        requiredPassMatrix: ['BASE_CASE', 'P90_DELAY', 'CONSERVATIVE_LATENCY_ADVERSE_SELECTION'],
        executedScenarioResults: {
          BASE_CASE: true,
          P90_DELAY: true,
          CONSERVATIVE_LATENCY_ADVERSE_SELECTION: false,
        },
      }),
    ).toThrow('DECLARED_PASS_MATRIX_UNSATISFIED_REFUSED');
  });
});
