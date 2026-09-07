/**
 * Capacity planner degradation order persistence and resolution unit tests (FR-COST-015, AC-104, AC-228).
 * Tests:
 * - loadDegradationOrder from cost.degradation_order_steps
 * - Seed-parity assertion against domain DEFAULT_POLICY_V1
 * - Integration resolver with admission control
 * - Mapping of G0 LOW_PRIORITY_DEGRADE_ORDER families into full order indices
 */
import { describe, expect, it } from 'bun:test';
import {
  getDegradationStepForFamily,
  loadDegradationOrder,
  resolveNextDegradationStep,
} from '../src/degrade-order.ts';
import { DEFAULT_POLICY_V1, ForesiftError } from '@foresift/domain';

describe('loadDegradationOrder & seed-parity check (FR-COST-015, ADR-4)', () => {
  it('loads seeded v1 order from database matching domain DEFAULT_POLICY_V1 exactly', async () => {
    const mockRows = DEFAULT_POLICY_V1.map((stepName, index) => ({
      policy_version: 'v1',
      step_index: index + 1,
      step_name: stepName,
      protected_class:
        stepName === 'PRESERVE_CRITICAL_OBLIGATIONS' ||
        stepName === 'RETURN_PARTIAL_INSUFFICIENT_DATA'
          ? 'RISK_MONITORING'
          : null,
    }));

    const mockEngine = {
      query: async () => ({ rows: mockRows }),
    } as never;

    const loaded = await loadDegradationOrder(mockEngine, 'v1');
    expect(loaded.policyVersion).toBe('v1');
    expect(loaded.steps.map((s) => s.stepName)).toEqual(DEFAULT_POLICY_V1);
  });

  it('refuses drift between database order and domain DEFAULT_POLICY_V1', async () => {
    const driftedRows = [
      {
        policy_version: 'v1',
        step_index: 1,
        step_name: 'PRESERVE_CRITICAL_OBLIGATIONS', // Drifted! Protected step at index 1!
        protected_class: 'RISK_MONITORING',
      },
    ];

    const mockEngine = {
      query: async () => ({ rows: driftedRows }),
    } as never;

    await expect(loadDegradationOrder(mockEngine, 'v1')).rejects.toThrow(ForesiftError);
  });
});

describe('Degradation resolver integration (AC-104, AC-228)', () => {
  it('returns next non-critical reduction step on initial exhaustion', () => {
    const next = resolveNextDegradationStep({
      order: DEFAULT_POLICY_V1,
      currentlyActiveSteps: [],
    });
    expect(next).toBe('SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL');
  });

  it('progresses to terminal protected steps only after all non-critical steps active', () => {
    const nonProtectedSteps = DEFAULT_POLICY_V1.slice(0, 9);
    const next = resolveNextDegradationStep({
      order: DEFAULT_POLICY_V1,
      currentlyActiveSteps: nonProtectedSteps,
    });
    expect(next).toBe('PRESERVE_CRITICAL_OBLIGATIONS');
  });

  it('stays on terminal RETURN_PARTIAL_INSUFFICIENT_DATA without jumping to paid fallback', () => {
    const allSteps = [...DEFAULT_POLICY_V1];
    const next = resolveNextDegradationStep({
      order: DEFAULT_POLICY_V1,
      currentlyActiveSteps: allSteps,
    });
    expect(next).toBe('RETURN_PARTIAL_INSUFFICIENT_DATA');
  });
});

describe('G0 LOW_PRIORITY_DEGRADE_ORDER family mapping (plan ADR-4)', () => {
  it('maps low-priority families to specific degradation steps in full order', () => {
    expect(getDegradationStepForFamily('SOCIAL')).toBe('REDUCE_SOCIAL_NARRATIVE_DEPTH');
    expect(getDegradationStepForFamily('ANALOG')).toBe(
      'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
    );
    expect(getDegradationStepForFamily('WALLET_HISTORY')).toBe('REDUCE_WALLET_HISTORY_DEPTH');
    expect(getDegradationStepForFamily('EXPLORATION')).toBe(
      'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR',
    );
    expect(getDegradationStepForFamily('BROAD_SCAN')).toBe('REDUCE_CHEAP_MONITOR_BREADTH');
  });
});
