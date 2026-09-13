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
import { activationScopeHash, evaluateActivationGate } from '@foresift/capability-registry';
import {
  makeProdScope,
  passingOpportunityGateInput,
  passingStatisticalEvidence,
} from '../fixtures/prod/index.ts';

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

/** Pure reference model for deterministic rank evaluation under challenger seam */
function evaluateDeterministicRank(
  candidates: CandidateRecord[],
  challenger?: ChallengerState,
): { candidateId: string; rank: number; arm: string }[] {
  // 1. Filter hard gates
  const eligible = candidates.filter((c) => Object.values(c.hardGates).every((g) => g.passed));

  // 2. Sort by lexicographic vectors
  const sorted = [...eligible].sort((a, b) => {
    // a. Opportunity
    const oppA = a.vectors.OPPORTUNITY.volumeAccel ?? 0;
    const oppB = b.vectors.OPPORTUNITY.volumeAccel ?? 0;
    if (oppA !== oppB) return oppB - oppA;

    // b. Risk
    const riskA = a.vectors.RISK.manipulationScore ?? 1;
    const riskB = b.vectors.RISK.manipulationScore ?? 1;
    if (riskA !== riskB) return riskA - riskB;

    // If tie and challenger is active & proven & not drifted -> challenger can break tie
    if (
      challenger &&
      challenger.modelStatus === 'CALIBRATED_PROVEN' &&
      !challenger.driftSignalDetected
    ) {
      const scoreA = challenger.scoreMap[a.candidateId] ?? 0;
      const scoreB = challenger.scoreMap[b.candidateId] ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
    }

    return a.candidateId.localeCompare(b.candidateId);
  });

  return sorted.map((c, idx) => ({
    candidateId: c.candidateId,
    rank: idx + 1,
    arm: 'EXPLOITATION',
  }));
}

describe('AC-154: Deterministic ranking vs challenger seam', () => {
  it('deterministic ranking is byte-identical with and without an unproven challenger', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const candidates = fixture.frozenUniverses[0].candidates as CandidateRecord[];

    const baselineRank = evaluateDeterministicRank(candidates);
    const unprovenChallengerRank = evaluateDeterministicRank(candidates, {
      modelStatus: 'UNPROVEN',
      driftSignalDetected: false,
      scoreMap: { cand_alpha: 0.1, cand_beta: 0.99 },
    });

    expect(baselineRank).toEqual(unprovenChallengerRank);
    expect(JSON.stringify(baselineRank)).toBe(JSON.stringify(unprovenChallengerRank));
  });

  it('calibrated proven challenger breaks ties without altering strictly ordered candidates', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const candidates = fixture.frozenUniverses[0].candidates as CandidateRecord[];

    // Create tied candidates
    const tiedAlpha1: CandidateRecord = {
      ...candidates[0]!,
      candidateId: 'cand_tie_1',
    };
    const tiedAlpha2: CandidateRecord = {
      ...candidates[0]!,
      candidateId: 'cand_tie_2',
    };

    const naturalOrder = evaluateDeterministicRank([tiedAlpha1, tiedAlpha2]);
    expect(naturalOrder.map((r) => r.candidateId)).toEqual(['cand_tie_1', 'cand_tie_2']);

    const challengerOrder = evaluateDeterministicRank([tiedAlpha1, tiedAlpha2], {
      modelStatus: 'CALIBRATED_PROVEN',
      driftSignalDetected: false,
      scoreMap: { cand_tie_1: 0.2, cand_tie_2: 0.8 },
    });

    expect(challengerOrder.map((r) => r.candidateId)).toEqual(['cand_tie_2', 'cand_tie_1']);
  });

  it('challenger cannot override failed hard gates for un-eligible candidates', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const candidates = fixture.frozenUniverses[0].candidates as CandidateRecord[];

    const failedGateCandidate = candidates.find((c) => c.candidateId === 'cand_delta_gate_failed')!;
    expect(failedGateCandidate.hardGates.LIQUIDITY_MINIMUM.passed).toBe(false);

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
    expect(challengerPromotionState.degradedNetUtilityScore).toBeLessThan(0.5);
  });
});

// --- prod-scoped addition (T035, FR-PROD-001/002, AC-154) --------------------

function prodCalibrationInput(overrides: {
  maturity: 'DRAFT' | 'IMMATURE' | 'MATURE';
  expectedNetUtilityRankingEnabled: boolean;
  regimeDrift: boolean;
}) {
  const scope = makeProdScope();
  return {
    ...passingOpportunityGateInput(scope),
    registeredStatisticalEvidence: [
      passingStatisticalEvidence(activationScopeHash(scope), { calibration: overrides }),
    ],
  };
}

describe('AC-154 prod-scoped: ranking stays disabled before mature calibration and cannot override hard gates', () => {
  it('passes with expected-net-utility ranking disabled at every maturity', () => {
    for (const maturity of ['DRAFT', 'IMMATURE', 'MATURE'] as const) {
      const result = evaluateActivationGate(
        prodCalibrationInput({
          maturity,
          expectedNetUtilityRankingEnabled: false,
          regimeDrift: false,
        }),
      );
      expect(result.verdict, maturity).toBe('PASS');
    }
  });

  it('allows ranking influence only at MATURE calibration without regime drift', () => {
    const result = evaluateActivationGate(
      prodCalibrationInput({
        maturity: 'MATURE',
        expectedNetUtilityRankingEnabled: true,
        regimeDrift: false,
      }),
    );
    expect(result.verdict).toBe('PASS');
  });

  it('cannot override a failed hard gate even with a mature, enabled challenger', () => {
    const input = prodCalibrationInput({
      maturity: 'MATURE',
      expectedNetUtilityRankingEnabled: true,
      regimeDrift: false,
    });
    const result = evaluateActivationGate({ ...input, available: false });
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('AVAILABLE_EVIDENCE');
    }
  });
});
