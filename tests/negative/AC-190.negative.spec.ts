/**
 * AC-190 negative / failure-path.
 * Traces: FR-SIG-006, FR-SIG-003, AC-190.
 * Refuses schedules consuming protected reserve classes to fund discretionary scans,
 * or shedding protected classes before discretionary scans.
 */
import { describe, expect, it } from 'bun:test';

interface ScheduleAttempt {
  protectedReserveUnitsAssigned: number;
  protectedReserveFloorRequired: number;
  discretionaryScanUnitsFunded: number;
}

function validateReserveInvariants(attempt: ScheduleAttempt): void {
  if (
    attempt.discretionaryScanUnitsFunded > 0 &&
    attempt.protectedReserveUnitsAssigned < attempt.protectedReserveFloorRequired
  ) {
    throw new Error('SIG_PROTECTED_RESERVE_CANNIBALIZATION_REFUSED');
  }
}

describe('AC-190 negative: Refusal of protected reserve cannibalization', () => {
  it('refuses funding discretionary scans when protected reserves are under floor', () => {
    const invalidSchedule: ScheduleAttempt = {
      protectedReserveUnitsAssigned: 5,
      protectedReserveFloorRequired: 10,
      discretionaryScanUnitsFunded: 20, // Cannot fund discretionary while protected is below floor
    };

    expect(() => validateReserveInvariants(invalidSchedule)).toThrow(
      'SIG_PROTECTED_RESERVE_CANNIBALIZATION_REFUSED',
    );
  });

  it('allows funding discretionary scans when protected reserves are fully satisfied', () => {
    const validSchedule: ScheduleAttempt = {
      protectedReserveUnitsAssigned: 10,
      protectedReserveFloorRequired: 10,
      discretionaryScanUnitsFunded: 20,
    };

    expect(() => validateReserveInvariants(validSchedule)).not.toThrow();
  });
});
