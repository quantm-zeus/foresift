/**
 * Degradation order domain unit tests (FR-COST-015, AC-228, plan ADR-4).
 * Tests the canonical §62.8 degradation order (DEFAULT_POLICY_V1), PROTECTED_STEPS,
 * and pure deterministic resolution (resolveDegradation).
 */
import { describe, expect, it } from 'bun:test';
// @ts-expect-error - Product implementation pending in parallel wave (T003)
import { DEFAULT_POLICY_V1, type DegradationState, isProtectedStep, PROTECTED_STEPS, resolveDegradation } from '../src/degrade-order.ts';
// @ts-expect-error - Product vocabulary implementation pending in parallel wave (T001)
import type { DegradationStep } from '../src/capacity.ts';

describe('DEFAULT_POLICY_V1 canonical sequence (PRD §62.8, FR-COST-015, AC-228)', () => {
  it('contains exactly the 11 degradation steps in PRD §62.8 sequence', () => {
    expect(DEFAULT_POLICY_V1).toEqual([
      'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
      'REDUCE_SOCIAL_NARRATIVE_DEPTH',
      'REDUCE_WALLET_HISTORY_DEPTH',
      'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT',
      'EXTEND_LOW_PRIORITY_RECHECK_INTERVAL',
      'REDUCE_CHEAP_MONITOR_BREADTH',
      'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR',
      'USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT',
      'STOP_NEW_OPPORTUNITY_RESEARCH',
      'PRESERVE_CRITICAL_OBLIGATIONS',
      'RETURN_PARTIAL_INSUFFICIENT_DATA',
    ]);
  });

  it('starts with non-critical enrichment/social/analog reductions', () => {
    expect(DEFAULT_POLICY_V1[0]).toBe('SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL');
    expect(DEFAULT_POLICY_V1[1]).toBe('REDUCE_SOCIAL_NARRATIVE_DEPTH');
    expect(DEFAULT_POLICY_V1[2]).toBe('REDUCE_WALLET_HISTORY_DEPTH');
    expect(DEFAULT_POLICY_V1[3]).toBe('REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT');
  });

  it('ends with protected terminal steps', () => {
    expect(DEFAULT_POLICY_V1[9]).toBe('PRESERVE_CRITICAL_OBLIGATIONS');
    expect(DEFAULT_POLICY_V1[10]).toBe('RETURN_PARTIAL_INSUFFICIENT_DATA');
  });
});

describe('PROTECTED_STEPS definition', () => {
  it('identifies PRESERVE_CRITICAL_OBLIGATIONS and RETURN_PARTIAL_INSUFFICIENT_DATA as protected', () => {
    expect(PROTECTED_STEPS).toEqual([
      'PRESERVE_CRITICAL_OBLIGATIONS',
      'RETURN_PARTIAL_INSUFFICIENT_DATA',
    ]);
    expect(isProtectedStep('PRESERVE_CRITICAL_OBLIGATIONS')).toBe(true);
    expect(isProtectedStep('RETURN_PARTIAL_INSUFFICIENT_DATA')).toBe(true);
    expect(isProtectedStep('REDUCE_SOCIAL_NARRATIVE_DEPTH')).toBe(false);
    expect(isProtectedStep('REDUCE_CHEAP_MONITOR_BREADTH')).toBe(false);
  });
});

describe('resolveDegradation determinism & progression laws (ADR-4)', () => {
  it('resolves the first step when no steps are active yet', () => {
    const state: DegradationState = {
      activeSteps: [],
      currentPressure: 'EXHAUSTION_SIGNAL',
    };
    const nextStep = resolveDegradation(DEFAULT_POLICY_V1, state);
    expect(nextStep).toBe('SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL');
  });

  it('progresses sequentially through non-protected steps before entering protected steps', () => {
    const activeSteps: DegradationStep[] = [];
    for (let i = 0; i < DEFAULT_POLICY_V1.length; i++) {
      const step = resolveDegradation(DEFAULT_POLICY_V1, {
        activeSteps: [...activeSteps],
        currentPressure: 'EXHAUSTION_SIGNAL',
      });
      const expectedStep = DEFAULT_POLICY_V1[i];
      expect(step).toBe(expectedStep!);
      activeSteps.push(step);
    }
  });

  it('is completely deterministic (same input produces identical resolution)', () => {
    const state: DegradationState = {
      activeSteps: [
        'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
        'REDUCE_SOCIAL_NARRATIVE_DEPTH',
      ],
      currentPressure: 'EXHAUSTION_SIGNAL',
    };
    const res1 = resolveDegradation(DEFAULT_POLICY_V1, state);
    const res2 = resolveDegradation(DEFAULT_POLICY_V1, state);
    const res3 = resolveDegradation(DEFAULT_POLICY_V1, state);

    expect(res1).toBe('REDUCE_WALLET_HISTORY_DEPTH');
    expect(res2).toBe('REDUCE_WALLET_HISTORY_DEPTH');
    expect(res3).toBe('REDUCE_WALLET_HISTORY_DEPTH');
  });

  it('reaches terminal protected step and never escapes to paid operations or skips protected steps', () => {
    const allStepsActive: DegradationStep[] = [...DEFAULT_POLICY_V1];
    const finalStep = resolveDegradation(DEFAULT_POLICY_V1, {
      activeSteps: allStepsActive,
      currentPressure: 'CRITICAL_EXHAUSTION',
    });

    // Terminal step must remain RETURN_PARTIAL_INSUFFICIENT_DATA (never paid fallback)
    expect(finalStep).toBe('RETURN_PARTIAL_INSUFFICIENT_DATA');
    expect(isProtectedStep(finalStep)).toBe(true);
  });

  it('supports versioned re-resolution with custom order slice', () => {
    const customOrder: DegradationStep[] = [
      'REDUCE_CHEAP_MONITOR_BREADTH',
      'PRESERVE_CRITICAL_OBLIGATIONS',
      'RETURN_PARTIAL_INSUFFICIENT_DATA',
    ];
    const state: DegradationState = {
      activeSteps: ['REDUCE_CHEAP_MONITOR_BREADTH'],
      currentPressure: 'EXHAUSTION_SIGNAL',
    };

    const next = resolveDegradation(customOrder, state);
    expect(next).toBe('PRESERVE_CRITICAL_OBLIGATIONS');
  });
});
