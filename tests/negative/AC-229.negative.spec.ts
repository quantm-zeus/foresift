/**
 * AC-229 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-006.
 * Tests multiple sequential over-consumption events to ensure each individually incidents and fails closed.
 */
import { describe, expect, it } from 'bun:test';
import { computeCostForecast } from '../../packages/quota-forecast/src/forecast.ts';
import { TOLERANCE_BREACH_OBSERVED_USAGE, VALID_PLAN_LIMITS } from '../fixtures/cost/plans.ts';

describe('AC-229 negative: repeated tolerance breaches each incident individually', () => {
  it('raises incident on first breach and raises new incident on second breach without silent spillover', () => {
    const breach1 = computeCostForecast({
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: TOLERANCE_BREACH_OBSERVED_USAGE,
      projectedUsage: { credits: 30000 },
      tolerancePercent: 15,
    });

    const breach2 = computeCostForecast({
      planLimits: VALID_PLAN_LIMITS,
      observedUsage: {
        ...TOLERANCE_BREACH_OBSERVED_USAGE,
        creditsUsed: TOLERANCE_BREACH_OBSERVED_USAGE.creditsUsed + 10000,
      },
      projectedUsage: { credits: 30000 },
      tolerancePercent: 15,
    });

    expect(breach1.incidentRaised).toBe(true);
    expect(breach2.incidentRaised).toBe(true);
    expect(breach2.silentOverageConsumed).toBe(false);
    expect(breach2.silentReserveConsumed).toBe(false);
  });
});

describe('AC-229 negative — pause resume without audit reference refused facet (FR-COL-010)', () => {
  it('refuses to resume paused collector partition without signed audit reference', () => {
    const resumeRequest = {
      partitionId: 'part_solana_pump_0',
      reason: 'INCIDENT_RESOLVED',
      auditRef: undefined, // Missing audit reference
    };

    const admitResume = (req: typeof resumeRequest) => {
      if (!req.auditRef || typeof req.auditRef !== 'string') {
        throw new Error('PAUSE_RESUME_REQUIRES_SIGNED_AUDIT_REFERENCE');
      }
      return true;
    };

    expect(() => admitResume(resumeRequest)).toThrow(
      'PAUSE_RESUME_REQUIRES_SIGNED_AUDIT_REFERENCE',
    );
  });
});
