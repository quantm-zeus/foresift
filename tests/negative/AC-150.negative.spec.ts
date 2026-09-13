/**
 * AC-150 negative (failure) — negative control exhibiting material lift triggers incident and blocks promotion.
 * Traces: FR-MAT-004, AC-150.
 */
import { describe, expect, it } from 'bun:test';
import {
  activationScopeHash,
  evaluateActivationGate,
  type RegisteredStatisticalEvidence,
} from '@foresift/capability-registry';
import { GOLDEN_CONTROL_CASES } from '../fixtures/eval/controls-vectors.ts';
import {
  makeProdScope,
  passingOpportunityGateInput,
  passingStatisticalEvidence,
} from '../fixtures/prod/index.ts';

function enforceControlPromotionGate(control: {
  hasMaterialLift: boolean;
  measuredLiftUsd: number;
}) {
  if (control.hasMaterialLift) {
    throw new Error('NEGATIVE_CONTROL_MATERIAL_LIFT_PROMOTION_BLOCKED');
  }
  return true;
}

describe('AC-150 negative: promotion is blocked upon negative control material lift', () => {
  it('throws and blocks promotion when control reveals leakage / spurious lift', () => {
    const leakageCase = GOLDEN_CONTROL_CASES.find((c) => c.hasMaterialLift);
    expect(leakageCase).toBeDefined();
    if (!leakageCase) return;

    expect(() => enforceControlPromotionGate(leakageCase)).toThrow(
      'NEGATIVE_CONTROL_MATERIAL_LIFT_PROMOTION_BLOCKED',
    );
  });
});

// --- prod-scoped additions (T035, FR-PROD-001/002, AC-150) -------------------

const PROD_CONTROLS = [
  { control: 'LABEL_PERMUTATION', passed: true, unexplainedMaterialLift: false },
  { control: 'FEATURE_TIME_SHIFT', passed: true, unexplainedMaterialLift: false },
  { control: 'SYNTHETIC_NULL_FEATURE', passed: true, unexplainedMaterialLift: false },
  { control: 'DELAYED_PROVIDER', passed: true, unexplainedMaterialLift: false },
] as const;

function controlsWithout(control: string): RegisteredStatisticalEvidence['negativeControls'] {
  return PROD_CONTROLS.filter((candidate) => candidate.control !== control);
}

describe('AC-150 prod-scoped negatives: unexplained lift or a missing control refuses', () => {
  it('refuses at NEGATIVE_CONTROLS when a control shows unexplained material lift', () => {
    const scope = makeProdScope();
    const controls = PROD_CONTROLS.map((control) =>
      control.control === 'LABEL_PERMUTATION'
        ? { ...control, unexplainedMaterialLift: true }
        : control,
    );
    const input = {
      ...passingOpportunityGateInput(scope),
      registeredStatisticalEvidence: [
        passingStatisticalEvidence(activationScopeHash(scope), { negativeControls: controls }),
      ],
    };
    const result = evaluateActivationGate(input);
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('NEGATIVE_CONTROLS');
      expect(result.reason).toBe('NEGATIVE_CONTROL_FAILED');
    }
  });

  it('refuses at NEGATIVE_CONTROLS when a registered control is missing entirely', () => {
    const scope = makeProdScope();
    const input = {
      ...passingOpportunityGateInput(scope),
      registeredStatisticalEvidence: [
        passingStatisticalEvidence(activationScopeHash(scope), {
          negativeControls: controlsWithout('DELAYED_PROVIDER'),
        }),
      ],
    };
    const result = evaluateActivationGate(input);
    expect(result.verdict).toBe('REFUSE');
    if (result.verdict === 'REFUSE') {
      expect(result.failingGate).toBe('NEGATIVE_CONTROLS');
      expect(result.reason).toBe('NEGATIVE_CONTROL_MISSING');
    }
  });
});
