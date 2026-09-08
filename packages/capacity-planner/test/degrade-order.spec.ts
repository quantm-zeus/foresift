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
  DegradationOrderDriftError,
  loadDegradationOrder,
  resolveNextReduceStep,
} from '../src/degrade-order.ts';
import { DEFAULT_POLICY_V1 } from '@foresift/domain';

describe('loadDegradationOrder & seed-parity check (FR-COST-015, ADR-4)', () => {
  it('loads seeded v1 order from database matching domain DEFAULT_POLICY_V1 exactly', async () => {
    const mockRows = (DEFAULT_POLICY_V1 as readonly string[]).map(
      (stepName: string, index: number) => ({
        policy_version: 'v1',
        step_index: index + 1,
        step_name: stepName,
        protected_class:
          stepName === 'PRESERVE_CRITICAL_OBLIGATIONS' ||
          stepName === 'RETURN_PARTIAL_INSUFFICIENT_DATA'
            ? 'RISK_MONITORING'
            : null,
      }),
    );

    const mockEngine = {
      query: async () => ({ rows: mockRows }),
    } as never;

    const loaded = await loadDegradationOrder(mockEngine, 'v1');
    expect(loaded.policyVersion).toBe('v1');
    expect(loaded.steps).toEqual(DEFAULT_POLICY_V1);
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

    // The drift refusal is its own typed error (seed-parity law, plan ADR-4).
    await expect(loadDegradationOrder(mockEngine, 'v1')).rejects.toThrow(
      DegradationOrderDriftError,
    );
  });
});

describe('Degradation resolver integration (AC-104, AC-228)', () => {
  it('returns the FIRST non-protected §62.8 step on initial exhaustion', () => {
    const next = resolveNextReduceStep({ order: DEFAULT_POLICY_V1, activeSteps: [] });
    expect(next).toBe('SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL');
  });

  it('skips PROTECTED_STEPS when proposing a reduction (never reduces critical work)', () => {
    // After the first step is active the resolver walks the versioned order;
    // PRESERVE_CRITICAL_OBLIGATIONS is protected and never proposed.
    const next = resolveNextReduceStep({
      order: DEFAULT_POLICY_V1,
      activeSteps: ['SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL'],
    });
    expect(next).toBe('REDUCE_SOCIAL_NARRATIVE_DEPTH');
    expect(next).not.toBe('PRESERVE_CRITICAL_OBLIGATIONS');
  });

  it('lands terminal on RETURN_PARTIAL_INSUFFICIENT_DATA without escaping to paid fallback', () => {
    // §62.8 closing law: with every non-protected step active, the resolution
    // lands on the terminal protected step — the system degrades honestly.
    const allNonProtected = DEFAULT_POLICY_V1.filter(
      (step) =>
        step !== 'PRESERVE_CRITICAL_OBLIGATIONS' && step !== 'RETURN_PARTIAL_INSUFFICIENT_DATA',
    );
    const next = resolveNextReduceStep({ order: DEFAULT_POLICY_V1, activeSteps: allNonProtected });
    expect(next).toBe('RETURN_PARTIAL_INSUFFICIENT_DATA');
  });
});
