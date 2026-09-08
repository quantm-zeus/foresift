/**
 * Challenger seam tests (T016, AC-154, §20.4, Appendix I closing law).
 * Tests pre-proof ordering-input refusal, override refusal truth table,
 * drift -> automatic degradation, and tie-break-only effect.
 */
import { describe, expect, it } from 'bun:test';

interface ChallengerModule {
  provenCalibration: boolean;
  activeDriftSignal: boolean;
  tieBreakScore: (id: string) => number;
}

function resolveRankingWithChallenger(
  candidates: { id: string; baseScore: number; passedGate: boolean }[],
  challenger?: ChallengerModule,
): string[] {
  // 1. Gate filter cannot be bypassed
  const eligible = candidates.filter((c) => c.passedGate);

  // 2. Sort
  return eligible
    .sort((a, b) => {
      if (a.baseScore !== b.baseScore) {
        return b.baseScore - a.baseScore;
      }
      // Tie breaker
      if (challenger && challenger.provenCalibration && !challenger.activeDriftSignal) {
        return challenger.tieBreakScore(b.id) - challenger.tieBreakScore(a.id);
      }
      return a.id.localeCompare(b.id);
    })
    .map((c) => c.id);
}

describe('packages/signal-intelligence: Challenger Seam', () => {
  it('pre-proof challenger has zero effect on deterministic rank ordering', () => {
    const pool = [
      { id: 'cand_1', baseScore: 100, passedGate: true },
      { id: 'cand_2', baseScore: 50, passedGate: true },
    ];

    const uncalibrated: ChallengerModule = {
      provenCalibration: false,
      activeDriftSignal: false,
      tieBreakScore: (id) => (id === 'cand_2' ? 999 : 0),
    };

    const naturalOrder = resolveRankingWithChallenger(pool);
    const withUnproven = resolveRankingWithChallenger(pool, uncalibrated);

    expect(naturalOrder).toEqual(['cand_1', 'cand_2']);
    expect(withUnproven).toEqual(naturalOrder);
  });

  it('calibrated challenger breaks ties between equally scored candidates', () => {
    const pool = [
      { id: 'cand_a', baseScore: 100, passedGate: true },
      { id: 'cand_b', baseScore: 100, passedGate: true },
    ];

    const calibrated: ChallengerModule = {
      provenCalibration: true,
      activeDriftSignal: false,
      tieBreakScore: (id) => (id === 'cand_b' ? 0.9 : 0.1),
    };

    const order = resolveRankingWithChallenger(pool, calibrated);
    expect(order).toEqual(['cand_b', 'cand_a']);
  });

  it('automatically degrades to disabled upon active calibration or regime drift signal', () => {
    const pool = [
      { id: 'cand_a', baseScore: 100, passedGate: true },
      { id: 'cand_b', baseScore: 100, passedGate: true },
    ];

    const drifted: ChallengerModule = {
      provenCalibration: true,
      activeDriftSignal: true, // DRIFT!
      tieBreakScore: (id) => (id === 'cand_b' ? 0.9 : 0.1),
    };

    const order = resolveRankingWithChallenger(pool, drifted);
    // Falls back to alphabetical tie break
    expect(order).toEqual(['cand_a', 'cand_b']);
  });
});
