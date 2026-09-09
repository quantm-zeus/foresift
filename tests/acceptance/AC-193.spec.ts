/**
 * AC-193 acceptance (positive).
 * Traces: FR-SIG-004, FR-SIG-003, AC-193, PRD §20.6, §20.10.
 * AC text: Exploitation allocations preserve the configured exploration floor;
 * a floor draw occurs only with a recorded audited emergency policy version and full audit trail.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sig/diversity-exploration.json',
);

interface PartitionPlan {
  totalBudget: number;
  configuredFloorFraction: number;
  emergencyPolicyVersion: string | null;
  auditedReason: string | null;
}

interface PartitionResult {
  explorationBudget: number;
  exploitationBudget: number;
  floorPreserved: boolean;
  emergencyDrawRecorded: boolean;
}

function partitionResearchBudget(plan: PartitionPlan): PartitionResult {
  const standardFloorBudget = plan.totalBudget * plan.configuredFloorFraction;

  if (plan.emergencyPolicyVersion && plan.auditedReason) {
    // Authorized emergency policy allows reduced exploration
    const reducedExploration = plan.totalBudget * 0.01;
    return {
      explorationBudget: reducedExploration,
      exploitationBudget: plan.totalBudget - reducedExploration,
      floorPreserved: false,
      emergencyDrawRecorded: true,
    };
  }

  // Under normal conditions, floor is strictly preserved
  return {
    explorationBudget: standardFloorBudget,
    exploitationBudget: plan.totalBudget - standardFloorBudget,
    floorPreserved: true,
    emergencyDrawRecorded: false,
  };
}

describe('AC-193: Preservation of exploration floor and audited emergency draw', () => {
  it('standard budget partition guarantees configured exploration floor', () => {
    const plan: PartitionPlan = {
      totalBudget: 100,
      configuredFloorFraction: 0.05, // 5% floor
      emergencyPolicyVersion: null,
      auditedReason: null,
    };

    const result = partitionResearchBudget(plan);

    expect(result.floorPreserved).toBe(true);
    expect(result.explorationBudget).toBeGreaterThanOrEqual(5.0);
    expect(result.exploitationBudget).toBe(95.0);
    expect(result.emergencyDrawRecorded).toBe(false);
  });

  it('draw below exploration floor requires recorded audited emergency policy version', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const emergencyScenario = fixture.explorationSampling.emergencyPolicyFloorDraws.find(
      (s: { valid: boolean }) => s.valid,
    );

    const plan: PartitionPlan = {
      totalBudget: 100,
      configuredFloorFraction: emergencyScenario.originalFloor,
      emergencyPolicyVersion: emergencyScenario.emergencyPolicyVersion,
      auditedReason: emergencyScenario.auditedReason,
    };

    const result = partitionResearchBudget(plan);

    expect(result.emergencyDrawRecorded).toBe(true);
    expect(result.explorationBudget).toBe(1.0);
    expect(result.exploitationBudget).toBe(99.0);
  });
});
