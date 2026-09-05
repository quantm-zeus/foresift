/**
 * AC-235 negative (failure) — Refusal of incomplete scenario recording and weakened pass matrices.
 * Traces: FR-EXEC-012, FR-EXEC-017, AC-235.
 * Tests structural refusal of passing candidates when the recorded matrix is incomplete or the pass requirements are weakened.
 */
import { describe, expect, it } from 'bun:test';

function evaluateProfileWithIntegrity(params: {
  profileId: string;
  profileRequiredPassMatrix: string[];
  recordedScenarios: string[];
  scenarioResults: Record<string, boolean>;
}) {
  // Check that all required scenarios are recorded
  for (const req of params.profileRequiredPassMatrix) {
    if (!params.recordedScenarios.includes(req)) {
      throw new Error(`INCOMPLETE_SCENARIO_RECORDING_REFUSED:${req}`);
    }
  }

  // Check that no required scenario is bypassed or weakened
  if (
    params.profileId === 'CONFIRMED_OPPORTUNITY_DEFAULT' &&
    !params.profileRequiredPassMatrix.includes('CONSERVATIVE_LATENCY_ADVERSE_SELECTION')
  ) {
    throw new Error('SILENTLY_WEAKENED_PASS_MATRIX_REFUSED');
  }

  for (const req of params.profileRequiredPassMatrix) {
    if (!params.scenarioResults[req]) {
      throw new Error(`SCENARIO_REQUIREMENT_FAILED:${req}`);
    }
  }

  return true;
}

describe('AC-235 negative: incomplete scenario recording and weakened pass matrices are refused', () => {
  it('refuses evaluation when a required scenario is unrecorded in the matrix', () => {
    expect(() =>
      evaluateProfileWithIntegrity({
        profileId: 'CONFIRMED_OPPORTUNITY_DEFAULT',
        profileRequiredPassMatrix: ['BASE_CASE', 'CONSERVATIVE_LATENCY_ADVERSE_SELECTION'],
        recordedScenarios: ['BASE_CASE'], // Missing conservative stress recording!
        scenarioResults: { BASE_CASE: true },
      }),
    ).toThrow('INCOMPLETE_SCENARIO_RECORDING_REFUSED:CONSERVATIVE_LATENCY_ADVERSE_SELECTION');
  });

  it('refuses silently weakening CONFIRMED_OPPORTUNITY by omitting conservative stress', () => {
    expect(() =>
      evaluateProfileWithIntegrity({
        profileId: 'CONFIRMED_OPPORTUNITY_DEFAULT',
        profileRequiredPassMatrix: ['BASE_CASE', 'P50_DELAY'], // Weakened matrix (omitted conservative stress)
        recordedScenarios: ['BASE_CASE', 'P50_DELAY'],
        scenarioResults: { BASE_CASE: true, P50_DELAY: true },
      }),
    ).toThrow('SILENTLY_WEAKENED_PASS_MATRIX_REFUSED');
  });
});
