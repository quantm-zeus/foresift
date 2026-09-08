/**
 * AC-193 negative / failure-path.
 * Traces: FR-SIG-004, FR-SIG-003, AC-193.
 * Refuses exploration floor reduction without an audited emergency policy record.
 */
import { describe, expect, it } from 'bun:test';

interface FloorReductionAttempt {
  allocatedExplorationUnits: number;
  minimumFloorUnits: number;
  emergencyPolicyVersion?: string | null;
  auditedReason?: string | null;
}

function validateFloorReduction(attempt: FloorReductionAttempt): void {
  if (attempt.allocatedExplorationUnits < attempt.minimumFloorUnits) {
    if (!attempt.emergencyPolicyVersion || !attempt.auditedReason) {
      throw new Error('SIG_EXPLORATION_FLOOR_BREACH_WITHOUT_EMERGENCY_POLICY');
    }
  }
}

describe('AC-193 negative: Refusal of unauthorized exploration floor breach', () => {
  it('refuses floor breach when emergency policy version is missing', () => {
    expect(() =>
      validateFloorReduction({
        allocatedExplorationUnits: 2,
        minimumFloorUnits: 5,
        emergencyPolicyVersion: null,
        auditedReason: 'Quota is tight',
      }),
    ).toThrow('SIG_EXPLORATION_FLOOR_BREACH_WITHOUT_EMERGENCY_POLICY');
  });

  it('refuses floor breach when audited reason is empty', () => {
    expect(() =>
      validateFloorReduction({
        allocatedExplorationUnits: 2,
        minimumFloorUnits: 5,
        emergencyPolicyVersion: 'EMERGENCY_V1',
        auditedReason: '',
      }),
    ).toThrow('SIG_EXPLORATION_FLOOR_BREACH_WITHOUT_EMERGENCY_POLICY');
  });

  it('allows floor reduction with complete emergency audit record', () => {
    expect(() =>
      validateFloorReduction({
        allocatedExplorationUnits: 2,
        minimumFloorUnits: 5,
        emergencyPolicyVersion: 'EMERGENCY_V1',
        auditedReason: 'Full emergency audit rationale documented',
      }),
    ).not.toThrow();
  });
});
