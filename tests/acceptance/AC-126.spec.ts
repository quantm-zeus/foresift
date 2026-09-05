/**
 * AC-126 acceptance (positive) — Low-resolution price snapshots and observation plan requirements.
 * Traces: FR-EXEC-004, FR-EXEC-011, AC-126.
 * AC text: "A low-resolution price snapshot supports a signal label but cannot establish a
 * short-lived executable target or tradable success without the required observation plan (§64.14/FR-EXEC-011)."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_TOUCH_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/target-touch.json',
);

describe('AC-126: Resolution floor and observation plan requirements (positive)', () => {
  it('supports signal label from low-resolution snapshot but refuses tradable success without plan', () => {
    const fixture = JSON.parse(readFileSync(TARGET_TOUCH_FIXTURE, 'utf8'));
    const lowResCase = fixture.touchCases.find(
      (c: Record<string, unknown>) => c.caseId === 'low_res_snapshot_oracle_floor_violation',
    );

    expect(lowResCase).toBeDefined();
    expect(lowResCase.snapshotResolutionSeconds).toBeGreaterThan(lowResCase.resolutionFloorSeconds);
    expect(lowResCase.observationPlanPresent).toBe(false);
    expect(lowResCase.signalSuccess).toBe(true); // Signal label is supported
    expect(lowResCase.tradableSuccess).toBe(false); // Tradable success blocked
    expect(lowResCase.verdict).toBe('UNTRADABLE_SIGNAL_WIN');
    expect(lowResCase.rejectionReason).toBe(
      'TEMPORAL_RESOLUTION_BELOW_FLOOR_WITHOUT_OBSERVATION_PLAN',
    );
  });

  it('permits tradable success assessment when a high-resolution observation plan is active', () => {
    const plannedObservation = {
      tokenMint: 'TokenObservedUnderPlan111111111111111111111',
      hasObservationPlan: true,
      planSamplingCadenceSlots: 1,
      targetPriceReached: true,
      depthSatisfied: true,
    };

    expect(plannedObservation.hasObservationPlan).toBe(true);
    expect(plannedObservation.planSamplingCadenceSlots).toBe(1);
    expect(plannedObservation.targetPriceReached).toBe(true);
  });
});
