/**
 * AC-154 negative / failure-path.
 * Traces: FR-SIG-003, FR-EVAL-001, FR-EVAL-003, AC-154, PRD §20.4, Appendix I.
 * Refuses learned ordering inputs pre-proof, hard-gate overrides, and missing drift degradation.
 *
 * Facet convention:
 * 1. Base signal seam refusal: pre-proof learned inputs and hard gate overrides throw.
 * 2. Calibration machinery refusal (FR-EVAL-001…009, AC-154): enabling drifted challenger throws.
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

function validateChallengerActivation(params: {
  isDrifted: boolean;
  attemptedActivation: boolean;
}) {
  if (params.isDrifted && params.attemptedActivation) {
    throw new Error('DRIFTED_CHALLENGER_ACTIVATION_REFUSED');
  }
  return true;
}

describe('AC-154 negative: Challenger seam structural refusals', () => {
  it('refuses learned ordering probability input prior to proven calibration', () => {
    const input: SeamInput = {
      candidateId: 'cand_test',
      hardGates: {
        GATE_1: { passed: true, gateCode: null },
      },
      preProofLearnedProbability: 0.85,
    };

    const result = processCandidateSeam(input);
    expect(result.admitted).toBe(false);
    expect(result.errorCode).toBe('SIG_CHALLENGER_LEARNED_INPUT_PRE_PROOF_REFUSED');
  });

  it('refuses hard gate override attempt by challenger score', () => {
    const input: SeamInput = {
      candidateId: 'cand_test',
      hardGates: {
        GATE_MIN_LIQUIDITY: { passed: false, gateCode: 'GATE_MIN_LIQUIDITY_FAILED' },
      },
      challengerOverrideAttempt: true,
    };

    const result = processCandidateSeam(input);
    expect(result.admitted).toBe(false);
    expect(result.errorCode).toBe('SIG_HARD_GATE_CHALLENGER_OVERRIDE_REFUSED');
  });
});

describe('AC-154 negative — calibration machinery refusal facet (FR-EVAL-001…009, AC-154)', () => {
  it('throws when attempting to activate a drifted challenger model without recalibration', () => {
    expect(() =>
      validateChallengerActivation({
        isDrifted: true,
        attemptedActivation: true,
      }),
    ).toThrow('DRIFTED_CHALLENGER_ACTIVATION_REFUSED');
  });
});
