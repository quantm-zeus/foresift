/**
 * Objective Governance Part D Unit Test Suite (T017).
 * Traces: FR-OBJ-010, FR-OBJ-001, FR-OBJ-002, FR-OBJ-003, FR-OBJ-006.
 *
 * Covers:
 * - Prohibited language screening (FR-OBJ-010): pattern matching across all 4 ProhibitedClaimKind variants
 * - Mandatory research-signal disclosure attachment and verification on opportunity outputs
 * - G1-boundary language gating (assertObjectiveLanguage / screenObjectiveLanguage)
 * - Promotion gate nine-stage execution order and full verdict matrix (PROMOTE, HOLD_EXPLORATORY_ONLY, BLOCK)
 * - Short-circuiting: earlier hard failures prevent later utility stages from evaluating
 * - Incomparability as the sole HOLD_EXPLORATORY_ONLY outcome
 */
import { describe, expect, it } from 'bun:test';
import {
  ObjError,
  ObjErrorCode,
  ProhibitedClaimKind,
  PromotionVerdict,
  UNCERTAINTY_DISCLOSURE_TEXT,
  isObjError,
} from '@foresift/domain';
import {
  OBJECTIVE_UNCERTAINTY_DISCLOSURE,
  PromotionGateStage,
  attachUncertaintyDisclosure,
  detectProhibitedClaims,
  evaluatePromotionGate,
  promotionGate,
  requirePermittedObjectiveLanguage,
  screenObjectiveLanguage,
  screenProhibitedLanguage,
  type PromotionGateInput,
} from './src/index.ts';

describe('Part D: Prohibited Language Screening & Disclosure Enforcement (FR-OBJ-010)', () => {
  it('detects every ProhibitedClaimKind pattern across representative samples', () => {
    // 1. GUARANTEED_PROFIT
    expect(
      detectProhibitedClaims('This signal delivers guaranteed profit on every single trade.'),
    ).toContain(ProhibitedClaimKind.GUARANTEED_PROFIT);
    expect(detectProhibitedClaims('Guaranteed 100x returns with zero risk.')).toContain(
      ProhibitedClaimKind.GUARANTEED_PROFIT,
    );
    expect(detectProhibitedClaims('Trading profit is guaranteed.')).toContain(
      ProhibitedClaimKind.GUARANTEED_PROFIT,
    );

    // 2. ASSURED_RETURN
    expect(detectProhibitedClaims('Assured returns backed by predictive algorithms.')).toContain(
      ProhibitedClaimKind.ASSURED_RETURN,
    );
    expect(detectProhibitedClaims('Model returns are assured for all users.')).toContain(
      ProhibitedClaimKind.ASSURED_RETURN,
    );

    // 3. RISK_FREE_PROFIT
    expect(detectProhibitedClaims('Our risk-free arbitrage scanner finds money.')).toContain(
      ProhibitedClaimKind.RISK_FREE_PROFIT,
    );
    expect(detectProhibitedClaims('Completely risk free execution path.')).toContain(
      ProhibitedClaimKind.RISK_FREE_PROFIT,
    );
    expect(detectProhibitedClaims('Generate steady profit without risk.')).toContain(
      ProhibitedClaimKind.RISK_FREE_PROFIT,
    );

    // 4. CERTAIN_GAIN
    expect(detectProhibitedClaims('Certain gains backed by order book telemetry.')).toContain(
      ProhibitedClaimKind.CERTAIN_GAIN,
    );
    expect(detectProhibitedClaims('100% win rate certainty on all screened alerts.')).toContain(
      ProhibitedClaimKind.CERTAIN_GAIN,
    );
    expect(detectProhibitedClaims('Profit is certain across all market regimes.')).toContain(
      ProhibitedClaimKind.CERTAIN_GAIN,
    );
  });

  it('allows clean text without prohibited language', () => {
    const cleanText =
      'Opportunity signal identified for SOL pool with estimated positive net utility under conservative execution assumptions.';
    expect(detectProhibitedClaims(cleanText)).toHaveLength(0);
  });

  it('enforces mandatory disclosure attachment on OPPORTUNITY_OUTPUT kind', () => {
    const cleanText = 'Estimated positive shadow-portfolio utility for SOL-USDC pair.';

    // Without disclosure on opportunity output -> rejected
    const screenNoDisc = screenObjectiveLanguage({
      text: cleanText,
      outputKind: 'OPPORTUNITY_OUTPUT',
      disclosure: null,
    });
    expect(screenNoDisc.accepted).toBe(false);
    expect(screenNoDisc.disclosureAttached).toBe(false);
    expect(() =>
      requirePermittedObjectiveLanguage({
        text: cleanText,
        outputKind: 'OPPORTUNITY_OUTPUT',
        disclosure: null,
      }),
    ).toThrow(ObjError);

    // With disclosure on opportunity output -> accepted
    const screenWithDisc = screenObjectiveLanguage({
      text: cleanText,
      outputKind: 'OPPORTUNITY_OUTPUT',
      disclosure: OBJECTIVE_UNCERTAINTY_DISCLOSURE,
    });
    expect(screenWithDisc.accepted).toBe(true);
    expect(screenWithDisc.disclosureAttached).toBe(true);
    expect(screenWithDisc.prohibitedClaimKinds).toHaveLength(0);

    // OBJECTIVE_CLAIM kind does not require disclosure attachment
    const screenClaim = screenProhibitedLanguage({
      text: cleanText,
      outputKind: 'OBJECTIVE_CLAIM',
    });
    expect(screenClaim.accepted).toBe(true);
    expect(screenClaim.disclosureAttached).toBe(true);
  });

  it('refuses prohibited claims in assertObjectiveLanguage even with disclosure present', () => {
    const prohibitedWithDisc = {
      text: 'Guaranteed returns on every alert.',
      outputKind: 'OPPORTUNITY_OUTPUT' as const,
      disclosure: UNCERTAINTY_DISCLOSURE_TEXT,
    };

    expect(() => requirePermittedObjectiveLanguage(prohibitedWithDisc)).toThrow(ObjError);
    try {
      requirePermittedObjectiveLanguage(prohibitedWithDisc);
    } catch (e) {
      expect(isObjError(e)).toBe(true);
      if (isObjError(e)) {
        expect(e.code).toBe(ObjErrorCode.OBJ_GUARANTEED_LANGUAGE_REFUSED);
      }
    }
  });

  it('attachUncertaintyDisclosure attaches canonical disclosure and freezes payload', () => {
    const rawPayload = { signalId: 'sig-001', asset: 'SOL', score: 95 };
    const attached = attachUncertaintyDisclosure(rawPayload);

    expect(attached.signalId).toBe('sig-001');
    expect(attached.disclosure).toBe(UNCERTAINTY_DISCLOSURE_TEXT);
    expect(Object.isFrozen(attached)).toBe(true);
  });
});

describe('Part D: Promotion Gate Nine-Stage Execution Order & Verdict Matrix (FR-OBJ-001…009, ADR-OBJ-03)', () => {
  const basePassingInput: PromotionGateInput = {
    hardConstraints: { passed: true, evidenceRef: 'ev-hard-001' },
    comparability: { passed: true, comparable: true, evidenceRef: 'ev-comp-001' },
    maturityEssMinimums: { passed: true, evidenceRef: 'ev-ess-001' },
    negativeControls: { passed: true, evidenceRef: 'ev-neg-001' },
    integrity: { passed: true, evidenceRef: 'ev-int-001' },
    lcbComparison: {
      passed: true,
      candidateLowerBoundMicros: 150000n,
      incumbentLowerBoundMicros: 100000n,
      evidenceRef: 'ev-lcb-001',
    },
    robustDelay: { passed: true, evidenceRef: 'ev-delay-001' },
    claimScope: { passed: true, evidenceRef: 'ev-scope-001' },
  };

  it('verifies all 9 stages in PromotionGateStage enum', () => {
    const stages = Object.values(PromotionGateStage);
    expect(stages).toHaveLength(9);
    expect(stages).toEqual([
      'HARD_CONSTRAINTS',
      'COMPARABILITY',
      'MATURITY_ESS_MINIMUMS',
      'NEGATIVE_CONTROLS',
      'INTEGRITY',
      'LCB_COMPARISON',
      'ROBUST_DELAY',
      'CLAIM_SCOPE',
      'VERDICT',
    ]);
  });

  it('yields PROMOTE when all 8 gate stages pass and candidate LCB exceeds incumbent', () => {
    const decision = evaluatePromotionGate(basePassingInput);
    expect(decision.verdict).toBe(PromotionVerdict.PROMOTE);
    expect(decision.trail).toHaveLength(9); // 8 stages + VERDICT
    expect(decision.trail[8]?.stage).toBe(PromotionGateStage.VERDICT);
    expect(decision.trail[8]?.passed).toBe(true);
    expect(decision.trail[8]?.reason).toBe(PromotionVerdict.PROMOTE);
  });

  it('yields HOLD_EXPLORATORY_ONLY solely on incomparability and short-circuits subsequent stages', () => {
    const incomparableInput: PromotionGateInput = {
      ...basePassingInput,
      comparability: { passed: true, comparable: false, evidenceRef: 'ev-comp-incomp' },
    };

    const decision = promotionGate(incomparableInput);
    expect(decision.verdict).toBe(PromotionVerdict.HOLD_EXPLORATORY_ONLY);
    // Trail stops at COMPARABILITY (stage 2) + VERDICT -> length 3
    expect(decision.trail).toHaveLength(3);
    expect(decision.trail[0]?.stage).toBe(PromotionGateStage.HARD_CONSTRAINTS);
    expect(decision.trail[1]?.stage).toBe(PromotionGateStage.COMPARABILITY);
    expect(decision.trail[1]?.passed).toBe(false);
    expect(decision.trail[2]?.stage).toBe(PromotionGateStage.VERDICT);
    expect(decision.trail[2]?.reason).toBe(PromotionVerdict.HOLD_EXPLORATORY_ONLY);
  });

  it('yields BLOCK and short-circuits at Stage 1 (HARD_CONSTRAINTS) failure', () => {
    const hardFailInput: PromotionGateInput = {
      ...basePassingInput,
      hardConstraints: { passed: false, reason: 'CRITICAL_SECURITY_FAILED' },
    };

    const decision = evaluatePromotionGate(hardFailInput);
    expect(decision.verdict).toBe(PromotionVerdict.BLOCK);
    // Trail stops at HARD_CONSTRAINTS (stage 1) + VERDICT -> length 2
    expect(decision.trail).toHaveLength(2);
    expect(decision.trail[0]?.stage).toBe(PromotionGateStage.HARD_CONSTRAINTS);
    expect(decision.trail[0]?.passed).toBe(false);
    expect(decision.trail[1]?.stage).toBe(PromotionGateStage.VERDICT);
    expect(decision.trail[1]?.reason).toBe(PromotionVerdict.BLOCK);
  });

  it('yields BLOCK for failures at each blocking stage in normative order', () => {
    // Stage 3: MATURITY_ESS_MINIMUMS failure
    const essFail: PromotionGateInput = {
      ...basePassingInput,
      maturityEssMinimums: { passed: false, reason: 'ESS_BELOW_MINIMUM' },
    };
    const essDecision = evaluatePromotionGate(essFail);
    expect(essDecision.verdict).toBe(PromotionVerdict.BLOCK);
    expect(essDecision.trail[2]?.stage).toBe(PromotionGateStage.MATURITY_ESS_MINIMUMS);
    expect(essDecision.trail[2]?.passed).toBe(false);

    // Stage 4: NEGATIVE_CONTROLS failure
    const negFail: PromotionGateInput = {
      ...basePassingInput,
      negativeControls: { passed: false, reason: 'PERMUTATION_TEST_FAILED' },
    };
    const negDecision = evaluatePromotionGate(negFail);
    expect(negDecision.verdict).toBe(PromotionVerdict.BLOCK);
    expect(negDecision.trail[3]?.stage).toBe(PromotionGateStage.NEGATIVE_CONTROLS);
    expect(negDecision.trail[3]?.passed).toBe(false);

    // Stage 5: INTEGRITY failure
    const intFail: PromotionGateInput = {
      ...basePassingInput,
      integrity: { passed: false, reason: 'DENOMINATOR_GAMING' },
    };
    const intDecision = evaluatePromotionGate(intFail);
    expect(intDecision.verdict).toBe(PromotionVerdict.BLOCK);
    expect(intDecision.trail[4]?.stage).toBe(PromotionGateStage.INTEGRITY);
    expect(intDecision.trail[4]?.passed).toBe(false);

    // Stage 6: LCB_COMPARISON candidate <= incumbent
    const lcbFail: PromotionGateInput = {
      ...basePassingInput,
      lcbComparison: {
        passed: true,
        candidateLowerBoundMicros: 90000n, // candidate lower than incumbent
        incumbentLowerBoundMicros: 100000n,
      },
    };
    const lcbDecision = evaluatePromotionGate(lcbFail);
    expect(lcbDecision.verdict).toBe(PromotionVerdict.BLOCK);
    expect(lcbDecision.trail[5]?.stage).toBe(PromotionGateStage.LCB_COMPARISON);
    expect(lcbDecision.trail[5]?.passed).toBe(false);

    // Stage 7: ROBUST_DELAY failure
    const delayFail: PromotionGateInput = {
      ...basePassingInput,
      robustDelay: { passed: false, reason: 'TAIL_SCENARIO_FAILED' },
    };
    const delayDecision = evaluatePromotionGate(delayFail);
    expect(delayDecision.verdict).toBe(PromotionVerdict.BLOCK);
    expect(delayDecision.trail[6]?.stage).toBe(PromotionGateStage.ROBUST_DELAY);
    expect(delayDecision.trail[6]?.passed).toBe(false);

    // Stage 8: CLAIM_SCOPE failure
    const scopeFail: PromotionGateInput = {
      ...basePassingInput,
      claimScope: { passed: false, reason: 'SCOPE_INCOMPLETE' },
    };
    const scopeDecision = evaluatePromotionGate(scopeFail);
    expect(scopeDecision.verdict).toBe(PromotionVerdict.BLOCK);
    expect(scopeDecision.trail[7]?.stage).toBe(PromotionGateStage.CLAIM_SCOPE);
    expect(scopeDecision.trail[7]?.passed).toBe(false);
  });
});
