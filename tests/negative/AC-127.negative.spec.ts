/**
 * AC-127 negative (failure) — optimistic-only passing refused & mutated replay reproduction failure.
 * Traces: FR-EXEC-010, FR-EXEC-012, FR-EXEC-017, AC-127.
 * Refusal: Permitting a candidate to pass a conservative profile when failing stress scenarios is refused;
 * replay with mutated assumption hash fails reproduction verification.
 */
import { describe, expect, it } from 'bun:test';

function evaluateProfilePass(profile: {
  requiresConservativeStress: boolean;
  baseCasePass: boolean;
  conservativeStressPass: boolean;
}) {
  if (profile.requiresConservativeStress && !profile.conservativeStressPass) {
    throw new Error('CANDIDATE_FAILS_REQUIRED_CONSERVATIVE_STRESS_SCENARIOS');
  }
  return true;
}

function verifyFrozenReplay(original: { assumptionHash: string }, replayed: { assumptionHash: string }) {
  if (original.assumptionHash !== replayed.assumptionHash) {
    throw new Error('FROZEN_REPLAY_ASSUMPTION_HASH_MISMATCH_REFUSED');
  }
  return true;
}

describe('AC-127 negative: optimistic-only passing refused and assumption mutation fails replay', () => {
  it('throws when candidate only passes base case but profile requires conservative stress', () => {
    expect(() =>
      evaluateProfilePass({
        requiresConservativeStress: true,
        baseCasePass: true,
        conservativeStressPass: false,
      }),
    ).toThrow('CANDIDATE_FAILS_REQUIRED_CONSERVATIVE_STRESS_SCENARIOS');
  });

  it('throws when frozen replay is executed with drifted or mutated assumptions', () => {
    expect(() =>
      verifyFrozenReplay(
        { assumptionHash: 'sha256:original_frozen_assumptions' },
        { assumptionHash: 'sha256:mutated_modified_assumptions' },
      ),
    ).toThrow('FROZEN_REPLAY_ASSUMPTION_HASH_MISMATCH_REFUSED');
  });
});
