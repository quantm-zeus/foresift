/**
 * STRICT_FREE guard unit tests (FR-COST-002, AC-100).
 * Asserts every block prefix:
 * - PAID_BLOCKED:*
 * - UNKNOWN_COST:*
 * - QUOTA_EXHAUSTED:*
 * - AUTO_UPGRADE_BLOCKED:*
 * - PAID_FALLBACK_BLOCKED:*
 */
import { describe, expect, it } from 'bun:test';
import {
  evaluateStrictFreeGuard,
  type StrictFreeGuardInput,
} from '../src/strict-free-guard.ts';
import {
  AUTO_UPGRADE_OP,
  FREE_QUOTA_OP,
  FREE_UNMETERED_OP,
  PAID_EXPLICIT_OP,
  UNKNOWN_COST_OP,
} from '../../../tests/fixtures/cost/operations.ts';

describe('evaluateStrictFreeGuard', () => {
  const baseInput: StrictFreeGuardInput = {
    declaration: {
      providerId: FREE_QUOTA_OP.providerId,
      operationId: FREE_QUOTA_OP.operationId,
      version: FREE_QUOTA_OP.version,
      costClass: 'FREE_QUOTA',
      quotaModelId: 'REQUESTS_PER_PERIOD',
      quotaUnitCost: 1,
      resetPolicyId: 'DAILY_MIDNIGHT_UTC',
      batchCapability: null,
      minimumCandidateStage: 'DISCOVERED',
      protectedReserveEligible: true,
      allowedInStrictFree: true,
    },
    workloadClass: 'INTERACTIVE_HIGH',
    remainingUnits: 100,
    requestedUnits: 1,
    callerId: 'actor_alice:run_001',
    paidFallbackAttempted: false,
  };

  it('admits valid free quota operation within quota balance', () => {
    const verdict = evaluateStrictFreeGuard(baseInput);
    expect(verdict.allowed).toBe(true);
    expect(verdict.denial).toBeUndefined();
  });

  it('admits valid free unmetered operation', () => {
    const input: StrictFreeGuardInput = {
      ...baseInput,
      declaration: {
        ...baseInput.declaration,
        costClass: 'FREE_UNMETERED',
        quotaUnitCost: 0,
      },
      requestedUnits: 0,
    };
    const verdict = evaluateStrictFreeGuard(input);
    expect(verdict.allowed).toBe(true);
  });

  it('blocks PAID_EXPLICIT with PAID_BLOCKED prefix', () => {
    const input: StrictFreeGuardInput = {
      ...baseInput,
      declaration: {
        ...baseInput.declaration,
        costClass: 'PAID_EXPLICIT',
        allowedInStrictFree: false,
      },
    };
    const verdict = evaluateStrictFreeGuard(input);
    expect(verdict.allowed).toBe(false);
    expect(verdict.denial).toBeDefined();
    expect(verdict.denial!.reason).toMatch(/^PAID_BLOCKED:/);
  });

  it('blocks UNKNOWN_COST with UNKNOWN_COST prefix', () => {
    const input: StrictFreeGuardInput = {
      ...baseInput,
      declaration: {
        ...baseInput.declaration,
        costClass: 'UNKNOWN_COST',
        allowedInStrictFree: false,
      },
    };
    const verdict = evaluateStrictFreeGuard(input);
    expect(verdict.allowed).toBe(false);
    expect(verdict.denial).toBeDefined();
    expect(verdict.denial!.reason).toMatch(/^UNKNOWN_COST:/);
  });

  it('blocks over-quota with QUOTA_EXHAUSTED prefix', () => {
    const input: StrictFreeGuardInput = {
      ...baseInput,
      remainingUnits: 0,
      requestedUnits: 1,
    };
    const verdict = evaluateStrictFreeGuard(input);
    expect(verdict.allowed).toBe(false);
    expect(verdict.denial).toBeDefined();
    expect(verdict.denial!.reason).toMatch(/^QUOTA_EXHAUSTED:/);
  });

  it('blocks auto-upgrade paths with AUTO_UPGRADE_BLOCKED prefix', () => {
    const input: StrictFreeGuardInput = {
      ...baseInput,
      declaration: {
        ...baseInput.declaration,
        batchCapability: {
          maxBatchSize: 10,
          safeMaxUtilization: 0.8,
          keyFields: ['tokenAddress'],
          autoUpgrade: true,
        },
      },
    };
    const verdict = evaluateStrictFreeGuard(input);
    expect(verdict.allowed).toBe(false);
    expect(verdict.denial).toBeDefined();
    expect(verdict.denial!.reason).toMatch(/^AUTO_UPGRADE_BLOCKED:/);
  });

  it('blocks paid fallback attempts with PAID_FALLBACK_BLOCKED prefix', () => {
    const input: StrictFreeGuardInput = {
      ...baseInput,
      paidFallbackAttempted: true,
    };
    const verdict = evaluateStrictFreeGuard(input);
    expect(verdict.allowed).toBe(false);
    expect(verdict.denial).toBeDefined();
    expect(verdict.denial!.reason).toMatch(/^PAID_FALLBACK_BLOCKED:/);
  });

  it('populates complete denial record fields upon block', () => {
    const input: StrictFreeGuardInput = {
      ...baseInput,
      declaration: {
        ...baseInput.declaration,
        costClass: 'PAID_EXPLICIT',
        allowedInStrictFree: false,
      },
    };
    const verdict = evaluateStrictFreeGuard(input);
    expect(verdict.allowed).toBe(false);
    const denial = verdict.denial!;
    expect(denial.candidate).toContain(input.declaration.providerId);
    expect(denial.candidate).toContain(input.declaration.operationId);
    expect(denial.caller).toBe(input.callerId);
    expect(denial.alternative).toBeDefined();
  });
});
