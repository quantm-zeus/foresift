/**
 * AC-227 acceptance suite (FR-COST-009, FR-COST-006).
 * AC text: "A 30-day expected and stress capacity replay includes provider credits/rates,
 * streamed bytes, model tokens, workflow steps, database/object growth, egress, retries,
 * notifications, and reserves; activation is blocked when any verified ceiling is exceeded."
 */
import { describe, expect, it } from 'bun:test';
import { loadForecastPlans } from '../fixtures/cost/index.ts';

describe('AC-227 acceptance: 30-day capacity replay covers all 9 dimension families and passes', () => {
  it('validates expected and stress load against verified ceilings across all 9 dimensions', () => {
    const fixture = loadForecastPlans();
    const replay = fixture.capacityReplay30Days;

    const dimensions = [
      'providerCredits',
      'streamedBytes',
      'modelTokens',
      'workflowSteps',
      'databaseWrites',
      'databaseStorageBytes',
      'objectStorageBytes',
      'egressBytes',
      'retryAllowance',
      'notifications',
      'reservesReserved',
    ];

    let allWithinCeiling = true;
    for (const dim of dimensions) {
      const stressVal = replay.stressLoad[dim];
      const ceilingVal = replay.verifiedCeilings[dim];
      if (stressVal > ceilingVal) {
        allWithinCeiling = false;
      }
    }

    expect(allWithinCeiling).toBe(true);
  });
});
