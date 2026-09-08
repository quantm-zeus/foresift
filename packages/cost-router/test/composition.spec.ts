/**
 * Cost composition and attribution unit tests (FR-COST-011, FR-COST-017, AC-105, §62.12).
 * Tests:
 * - composeCostTotals exact 7-class requirement
 * - Total cost identity (total = sum(classes))
 * - Zero-overclaim invariant (zero paid data + nonzero other class => nonzero total)
 * - marginalCostAttribution per AttributionUnitKind
 */
import { describe, expect, it } from 'bun:test';
import { composeCostTotals, marginalCostAttribution, CostCompositionError } from '../src/composition.ts';
import { ForesiftError } from '@foresift/domain';
import type { RenderedSpendClasses } from '@foresift/shared-schemas';

const completeClasses: RenderedSpendClasses = {
  PAID_DATA_SPEND: 0,
  FREE_QUOTA_CONSUMPTION: 500,
  MODEL_SPEND: 12.5,
  INFRASTRUCTURE_SPEND: 5.0,
  STORAGE_EGRESS_SPEND: 2.1,
  NOTIFICATION_SPEND: 0.5,
  HUMAN_REVIEW_EFFORT: 0,
};

describe('composeCostTotals (FR-COST-011, FR-COST-017, §62.12)', () => {
  it('computes total cost exactly equal to the sum of all 7 spend classes', () => {
    const result = composeCostTotals(completeClasses);
    const expectedSum = 0 + 500 + 12.5 + 5.0 + 2.1 + 0.5 + 0;
    expect(result.totalCost).toBe(expectedSum);
    expect(result.renderedClasses).toEqual(completeClasses);
  });

  it('zero-overclaim law (§62.12): zero PAID_DATA_SPEND with nonzero MODEL_SPEND yields total > 0', () => {
    const zeroPaidDataSpend: RenderedSpendClasses = {
      PAID_DATA_SPEND: 0,
      FREE_QUOTA_CONSUMPTION: 0,
      MODEL_SPEND: 5.0,
      INFRASTRUCTURE_SPEND: 0,
      STORAGE_EGRESS_SPEND: 0,
      NOTIFICATION_SPEND: 0,
      HUMAN_REVIEW_EFFORT: 0,
    };

    const result = composeCostTotals(zeroPaidDataSpend);
    expect(result.renderedClasses.PAID_DATA_SPEND).toBe(0);
    expect(result.renderedClasses.MODEL_SPEND).toBe(5.0);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.totalCost).toBe(5.0);
  });

  it('refuses compositions missing any of the 7 RenderedSpendClass keys', () => {
    const missingHumanReview = { ...completeClasses };
    delete (missingHumanReview as Record<string, unknown>).HUMAN_REVIEW_EFFORT;

    expect(() => composeCostTotals(missingHumanReview as never)).toThrow(CostCompositionError);

    const missingPaidData = { ...completeClasses };
    delete (missingPaidData as Record<string, unknown>).PAID_DATA_SPEND;

    expect(() => composeCostTotals(missingPaidData as never)).toThrow(CostCompositionError);
  });

  it('refuses negative spend values in any class', () => {
    const negativeModel = {
      ...completeClasses,
      MODEL_SPEND: -1.0,
    };
    expect(() => composeCostTotals(negativeModel)).toThrow(CostCompositionError);
  });
});

describe('marginalCostAttribution per AttributionUnitKind (FR-COST-017)', () => {
  const unitKinds = [
    'RESEARCHED_CANDIDATE',
    'MATURE_OUTCOME',
    'USEFUL_ALERT',
    'PREVENTED_RISK_EVENT',
    'PORTFOLIO_UTILITY_UNIT',
  ] as const;

  for (const unitKind of unitKinds) {
    it(`composes marginal cost attribution for ${unitKind}`, () => {
      const attribution = marginalCostAttribution({
        contractId: 'cap_contract_v1_001',
        attributionId: `attr_${unitKind.toLowerCase()}_001`,
        unitKind,
        subjectId: `subj_${unitKind.toLowerCase()}_001`,
        totalCost: 520.1,
        renderedClasses: completeClasses,
        attributedAt: '2026-09-01T00:00:00Z',
      });

      expect(attribution.unitKind).toBe(unitKind);
      expect(attribution.marginalCost).toBe(520.1); // Σ of the 7 fixture classes
      expect(attribution.renderedClasses).toEqual(completeClasses);
    });
  }

  it('refuses unknown attribution unit kind', () => {
    expect(() =>
      marginalCostAttribution({
        attributionId: 'attr_unknown_001',
        contractId: 'cap_contract_v1_001',
        unitKind: 'UNKNOWN_UNIT_KIND' as never,
        subjectId: 'subj_001',
        totalCost: 520.1,
        attributedAt: '2026-09-01T00:00:00Z',
        renderedClasses: completeClasses,
      }),
    ).toThrow(ForesiftError);
  });
});
