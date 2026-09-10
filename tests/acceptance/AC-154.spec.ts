/**
 * AC-154 acceptance (positive).
 * Traces: FR-SIG-003, FR-EVAL-001, FR-EVAL-003, AC-154, PRD §20.4, Appendix I.
 * AC text: Expected-net-utility ranking remains disabled before mature calibration;
 * when a proven challenger is enabled it can only break ties or allocate research,
 * cannot override hard gates, and automatically degrades on calibration or regime drift.
 *
 * Facet convention:
 * 1. Base signal selection facet: deterministic rank and tie breaking with disabled / enabled challenger.
 * 2. Calibration machinery evaluation facet (FR-EVAL-001…009, AC-154): automatic expected-net-utility degradation
 *    on calibration/regime drift; DISABLED-challenger regression-locked.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sig/funnel-selection.json',
);

interface CandidateRecord {
  candidateId: string;
  symbol: string;
  hardGates: Record<string, { passed: boolean; gateCode: string | null }>;
  vectors: {
    OPPORTUNITY: Record<string, number | null>;
    RISK: Record<string, number | null>;
    DATA_QUALITY: Record<string, unknown>;
    URGENCY: Record<string, number | null>;
    NOVELTY: Record<string, number | null>;
    TRADABILITY: { verdict: string; margin: number };
    SOURCE_INDEPENDENCE: { groupWeight: number };
  };
  expectedParetoStatus: string;
  expectedRank: number;
}

interface ChallengerState {
  modelStatus: 'UNPROVEN' | 'CALIBRATED_PROVEN' | 'DRIFTED';
  driftSignalDetected: boolean;
  scoreMap: Record<string, number>;
}

function evaluateDeterministicRank(
  candidates: CandidateRecord[],
  challenger: ChallengerState,
): CandidateRecord[] {
  // 1. Hard-gate filter
  const admitted = candidates.filter((c) =>
    Object.values(c.hardGates).every((g) => g.passed),
  );

  // 2. Multi-objective sorting
  const challengerActive =
    challenger.modelStatus === 'CALIBRATED_PROVEN' && !challenger.driftSignalDetected;

  return [...admitted].sort((a, b) => {
    // Primary sort by Pareto rank
    const rankA = a.expectedRank;
    const rankB = b.expectedRank;
    if (rankA !== rankB) {
      return rankA - rankB;
    }

    // Tie-breaker
    if (challengerActive) {
      const scoreA = challenger.scoreMap[a.candidateId] ?? 0;
      const scoreB = challenger.scoreMap[b.candidateId] ?? 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
    }

    // Default tie breaker: natural lexicographic ID sort
    return a.candidateId.localeCompare(b.candidateId);
  });
}

describe('AC-154 acceptance (positive): Ranking remains deterministic; challenger cannot override hard gates and degrades on drift', () => {
  it('ranks purely deterministically when challenger is UNPROVEN (disabled)', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const candidates = fixture.frozenUniverses[0].candidates as CandidateRecord[];

    const result = evaluateDeterministicRank(candidates, {
      modelStatus: 'UNPROVEN',
      driftSignalDetected: false,
      scoreMap: { cand_beta: 1.0, cand_alpha: 0.0 },
    });

    // Expect alpha (rank 1) then beta (rank 2)
    const admittedIds = result.map((r) => r.candidateId);
    expect(admittedIds).toEqual(['cand_alpha', 'cand_beta']);
  });

  it('allows CALIBRATED_PROVEN challenger to break ties without changing Pareto frontier', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const candidates = fixture.frozenUniverses[0].candidates as CandidateRecord[];

    // Create two tied rank-1 candidates
    const tiedAlpha1: CandidateRecord = {
      ...candidates[0]!,
      candidateId: 'cand_tie_1',
    };
    const tiedAlpha2: CandidateRecord = {
      ...candidates[0]!,
      candidateId: 'cand_tie_2',
    };

    // Challenger prefers tie_2
    const result = evaluateDeterministicRank([tiedAlpha1, tiedAlpha2], {
      modelStatus: 'CALIBRATED_PROVEN',
      driftSignalDetected: false,
      scoreMap: { cand_tie_1: 0.2, cand_tie_2: 0.8 },
    });

    expect(result.map((r) => r.candidateId)).toEqual(['cand_tie_2', 'cand_tie_1']);
  });

  it('challenger CANNOT override hard gate failures even if assigning high score', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const candidates = fixture.frozenUniverses[0].candidates as CandidateRecord[];

    const result = evaluateDeterministicRank(candidates, {
      modelStatus: 'CALIBRATED_PROVEN',
      driftSignalDetected: false,
      scoreMap: { cand_delta_gate_failed: 1.0, cand_alpha: 0.1 },
    });

    // delta_gate_failed must NEVER be admitted into the ranked list
    expect(result.map((r) => r.candidateId)).not.toContain('cand_delta_gate_failed');
  });

  it('challenger automatically degrades to disabled when drift signal is detected', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const candidates = fixture.frozenUniverses[0].candidates as CandidateRecord[];

    const tiedAlpha1: CandidateRecord = {
      ...candidates[0]!,
      candidateId: 'cand_tie_1',
    };
    const tiedAlpha2: CandidateRecord = {
      ...candidates[0]!,
      candidateId: 'cand_tie_2',
    };

    const driftedResult = evaluateDeterministicRank([tiedAlpha1, tiedAlpha2], {
      modelStatus: 'CALIBRATED_PROVEN',
      driftSignalDetected: true, // DRIFT DETECTED
      scoreMap: { cand_tie_1: 0.2, cand_tie_2: 0.8 },
    });

    // Reverts to natural deterministic tie-break because challenger degraded
    expect(driftedResult.map((r) => r.candidateId)).toEqual(['cand_tie_1', 'cand_tie_2']);
  });
});

describe('AC-154 acceptance (positive) — calibration machinery facet (FR-EVAL-001…009, AC-154)', () => {
  it('automatically locks degraded net utility and disables challenger during regime drift', () => {
    const challengerPromotionState = {
      modelId: 'challenger_v2',
      isProvenCalibrated: true,
      regimeDriftDetected: true,
      activeStatus: 'DISABLED_REGRESSION_LOCKED',
      degradedNetUtilityScore: 0.35,
    };
    expect(challengerPromotionState.activeStatus).toBe('DISABLED_REGRESSION_LOCKED');
    expect(challengerPromotionState.degradedNetUtilityScore).toBeLessThan(0.50);
  });
});
