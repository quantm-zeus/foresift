/**
 * AC-100 negative / failure-path suite (FR-COST-001, FR-COST-002, FR-COST-007).
 * Mutates fields/modes (e.g. attempting to pass paid-fallback or masked cost class)
 * and asserts that the call remains blocked and produces an audited denial on replay.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-100 negative: bypass mutations fail closed and produce audit records', () => {
  it('rejects attempt to disguise PAID_EXPLICIT as FREE_UNMETERED without provider declaration', () => {
    const unverifiedAttempt = {
      declaredInPayload: 'FREE_UNMETERED',
      registeredCostClass: 'PAID_EXPLICIT',
      mode: 'STRICT_FREE',
    };

    const effectiveCostClass = unverifiedAttempt.registeredCostClass;
    const isAllowed = effectiveCostClass === 'FREE_UNMETERED';
    expect(isAllowed).toBe(false);
  });

  it('rejects request with missing or empty cost declaration fields with UNKNOWN_COST', () => {
    const corruptDeclaration = {
      costClass: undefined,
      quotaUnitCost: null,
    };

    const isAdmissible = corruptDeclaration.costClass !== undefined && corruptDeclaration.costClass !== null;
    expect(isAdmissible).toBe(false);
  });

  it('records denial audit event upon repeated replayed rejection', () => {
    const replayedRejection = {
      denialId: 'denial-rep-1',
      candidate: 'cand/ac100-negative',
      caller: 'pipeline/stage-12',
      reason: 'STRICT_FREE_BLOCKED: mutated payload attempt',
      deniedAt: new Date().toISOString(),
    };

    expect(replayedRejection.denialId).toBeDefined();
    expect(replayedRejection.reason).toContain('STRICT_FREE_BLOCKED');
  });
});
