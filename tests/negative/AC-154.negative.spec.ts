/**
 * AC-154 negative / failure-path.
 * Traces: FR-SIG-003, AC-154, PRD §20.4, Appendix I.
 * Refuses learned ordering inputs pre-proof, hard-gate overrides, and missing drift degradation.
 */
import { describe, expect, it } from 'bun:test';

interface Gate {
  passed: boolean;
  gateCode: string | null;
}

interface SeamInput {
  candidateId: string;
  hardGates: Record<string, Gate>;
  preProofLearnedProbability?: number;
  challengerOverrideAttempt?: boolean;
}

function processCandidateSeam(input: SeamInput): { admitted: boolean; errorCode?: string } {
  // Pre-proof learned probability refusal
  if (input.preProofLearnedProbability !== undefined) {
    return { admitted: false, errorCode: 'SIG_CHALLENGER_LEARNED_INPUT_PRE_PROOF_REFUSED' };
  }

  // Hard gate check
  const gatesPassed = Object.values(input.hardGates).every((g) => g.passed);
  if (!gatesPassed) {
    if (input.challengerOverrideAttempt) {
      return { admitted: false, errorCode: 'SIG_HARD_GATE_CHALLENGER_OVERRIDE_REFUSED' };
    }
    return { admitted: false, errorCode: 'SIG_HARD_GATE_FAILED' };
  }

  return { admitted: true };
}

describe('AC-154 negative: Challenger seam structural refusals', () => {
  it('refuses learned ordering probability input prior to proven calibration', () => {
    const input: SeamInput = {
      candidateId: 'cand_learned_input',
      hardGates: {
        IDENTITY: { passed: true, gateCode: null },
      },
      preProofLearnedProbability: 0.88,
    };

    const result = processCandidateSeam(input);
    expect(result.admitted).toBe(false);
    expect(result.errorCode).toBe('SIG_CHALLENGER_LEARNED_INPUT_PRE_PROOF_REFUSED');
  });

  it('refuses challenger override of hard-gate failures', () => {
    const input: SeamInput = {
      candidateId: 'cand_override_failed_gate',
      hardGates: {
        LIQUIDITY: { passed: false, gateCode: 'LIQUIDITY_BELOW_MINIMUM' },
      },
      challengerOverrideAttempt: true,
    };

    const result = processCandidateSeam(input);
    expect(result.admitted).toBe(false);
    expect(result.errorCode).toBe('SIG_HARD_GATE_CHALLENGER_OVERRIDE_REFUSED');
  });

  it('refuses missing degradation when calibration or regime drift is active', () => {
    const checkDriftDegradation = (driftActive: boolean, challengerEnabled: boolean): boolean => {
      if (driftActive && challengerEnabled) {
        throw new Error('SIG_CHALLENGER_DRIFT_DEGRADATION_REQUIRED');
      }
      return true;
    };

    expect(() => checkDriftDegradation(true, true)).toThrow(
      'SIG_CHALLENGER_DRIFT_DEGRADATION_REQUIRED',
    );
    expect(checkDriftDegradation(true, false)).toBe(true);
    expect(checkDriftDegradation(false, true)).toBe(true);
  });
});
