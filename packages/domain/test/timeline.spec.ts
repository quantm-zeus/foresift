import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as any;
const computeDeliveryEligibleAt = Domain.computeDeliveryEligibleAt;
const isTimelineMonotonic = Domain.isTimelineMonotonic;
const validateCounterfactualArm = Domain.validateCounterfactualArm;

describe('Decision delivery timeline predicates (FR-DATA-009, Appendix P, AC-240)', () => {
  it('derives delivery_eligible_at as max(decision_ready_at, policy_decided_at)', () => {
    const t1 = '2026-05-01T10:00:00Z';
    const t2 = '2026-05-01T10:05:00Z';

    expect(computeDeliveryEligibleAt(t1, t2)).toBe(t2);
    expect(computeDeliveryEligibleAt(t2, t1)).toBe(t2);
    expect(computeDeliveryEligibleAt(t1, t1)).toBe(t1);
  });

  it('validates timeline monotonicity for delivered decision arms', () => {
    const validDelivered = {
      decisionReadyAt: '2026-05-01T10:00:00Z',
      policyDecidedAt: '2026-05-01T10:02:00Z',
      workflowCompletedAt: '2026-05-01T10:03:00Z',
      deliveryEligibleAt: '2026-05-01T10:02:00Z',
      deliveredAt: '2026-05-01T10:04:00Z',
    };
    expect(isTimelineMonotonic(validDelivered)).toBe(true);

    const nonMonotonic = {
      decisionReadyAt: '2026-05-01T10:05:00Z',
      policyDecidedAt: '2026-05-01T10:02:00Z',
      workflowCompletedAt: '2026-05-01T10:03:00Z',
      deliveryEligibleAt: '2026-05-01T10:00:00Z', // earlier than decisionReadyAt!
      deliveredAt: '2026-05-01T10:04:00Z',
    };
    expect(isTimelineMonotonic(nonMonotonic)).toBe(false);
  });

  it('enforces versioned counterfactual delivery timestamp for non-delivered arms', () => {
    const validNonDelivered = {
      deliveredAt: null,
      counterfactualDeliveryAt: '2026-05-01T10:04:00Z',
      counterfactualVersion: 1,
      decisionReadyAt: '2026-05-01T10:00:00Z',
      policyDecidedAt: '2026-05-01T10:02:00Z',
      deliveryEligibleAt: '2026-05-01T10:02:00Z',
    };
    expect(validateCounterfactualArm(validNonDelivered)).toBe(true);

    const missingCounterfactual = {
      deliveredAt: null,
      counterfactualDeliveryAt: null,
      counterfactualVersion: null,
      decisionReadyAt: '2026-05-01T10:00:00Z',
      policyDecidedAt: '2026-05-01T10:02:00Z',
      deliveryEligibleAt: '2026-05-01T10:02:00Z',
    };
    expect(validateCounterfactualArm(missingCounterfactual)).toBe(false);
  });
});
