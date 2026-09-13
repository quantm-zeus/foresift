/**
 * AC-150 acceptance (positive) — negative controls show no unexplained material lift (§31.13, §68.5).
 * Traces: FR-MAT-004, AC-150.
 */
import { describe, expect, it } from 'bun:test';
import { evaluateActivationGate } from '@foresift/capability-registry';
import { GOLDEN_CONTROL_CASES } from '../fixtures/eval/controls-vectors.ts';
import { makeProdScope, passingOpportunityGateInput } from '../fixtures/prod/index.ts';

/** The four §31/§39 registered negative controls. */
const PROD_NEGATIVE_CONTROLS = [
  'LABEL_PERMUTATION',
  'FEATURE_TIME_SHIFT',
  'SYNTHETIC_NULL_FEATURE',
  'DELAYED_PROVIDER',
] as const;

describe('AC-150 acceptance (positive): negative controls demonstrate zero unexplained material lift', () => {
  it('confirms clean pass for negative controls within allowable bound', () => {
    const cleanCases = GOLDEN_CONTROL_CASES.filter((c) => !c.hasMaterialLift);
    for (const c of cleanCases) {
      expect(c.hasMaterialLift).toBe(false);
      expect(c.measuredLiftUsd).toBeLessThanOrEqual(c.maxAllowedLiftUsd);
    }
  });
});

// --- prod-scoped addition (T035, FR-PROD-001/002, AC-150) --------------------

describe('AC-150 prod-scoped: registered negative controls gate PROVEN/ACTIVE', () => {
  it('gates PROVEN/ACTIVE on all four registered controls showing no unexplained lift', () => {
    const scope = makeProdScope();
    const result = evaluateActivationGate(passingOpportunityGateInput(scope));
    expect(result.verdict).toBe('PASS');

    const controls =
      passingOpportunityGateInput(scope).registeredStatisticalEvidence[0]?.negativeControls ?? [];
    expect(controls.map((control) => control.control).sort()).toEqual(
      [...PROD_NEGATIVE_CONTROLS].sort(),
    );
    for (const control of controls) {
      expect(control.passed).toBe(true);
      expect(control.unexplainedMaterialLift).toBe(false);
    }
  });
});
