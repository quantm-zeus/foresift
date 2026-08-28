/**
 * Cost declaration view units (FR-COST-001, PRD §38.13, §62.3).
 *
 * Asserts:
 * - Read view over prov_operations projects the 7 FR-COST-001 fields:
 *   1. costClass
 *   2. quotaUnitCost
 *   3. resetPolicyId
 *   4. batchCapability
 *   5. minimumCandidateStage
 *   6. protectedReserveEligible
 *   7. allowedInStrictFree
 * - Fails closed with machine rejection code UNKNOWN_COST when any field is absent or holds an unrecognized enum.
 */
import { describe, expect, it } from 'bun:test';

describe('cost-declaration projection and fail-closed validation (FR-COST-001)', () => {
  it('projects all 7 FR-COST-001 fields from a valid provider operation declaration', async () => {
    let CostDeclarationModule: Record<string, unknown>;
    try {
      CostDeclarationModule = (await import('../src/cost-declaration.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('COST_DECLARATION_NOT_IMPLEMENTED: src/cost-declaration.ts missing');
    }

    const projectCostDeclaration = CostDeclarationModule.projectCostDeclaration as (
      input: unknown,
    ) => Record<string, unknown>;
    expect(typeof projectCostDeclaration).toBe('function');

    const validRecord = {
      providerOperationId: 'gmgn:token_security',
      costClass: 'FREE_QUOTA',
      quotaUnitCost: 1,
      resetPolicyId: 'daily-midnight-utc',
      batchCapability: { maxBatchSize: 20, safeMaxUtilization: 0.8, keyFields: ['address'] },
      minimumCandidateStage: 'QUALIFIED',
      protectedReserveEligible: true,
      allowedInStrictFree: true,
      paidFallbackAllowed: false,
    };

    const projected = projectCostDeclaration(validRecord);
    expect(projected.costClass).toBe('FREE_QUOTA');
    expect(projected.quotaUnitCost).toBe(1);
    expect(projected.resetPolicyId).toBe('daily-midnight-utc');
    expect(projected.batchCapability).toEqual({
      maxBatchSize: 20,
      safeMaxUtilization: 0.8,
      keyFields: ['address'],
    });
    expect(projected.minimumCandidateStage).toBe('QUALIFIED');
    expect(projected.protectedReserveEligible).toBe(true);
    expect(projected.allowedInStrictFree).toBe(true);
  });

  it('fails closed with UNKNOWN_COST rejection when costClass is missing or unknown enum', async () => {
    let CostDeclarationModule: Record<string, unknown>;
    try {
      CostDeclarationModule = (await import('../src/cost-declaration.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('COST_DECLARATION_NOT_IMPLEMENTED: src/cost-declaration.ts missing');
    }

    const projectCostDeclaration = CostDeclarationModule.projectCostDeclaration as (
      input: unknown,
    ) => unknown;

    expect(() =>
      projectCostDeclaration({
        costClass: 'UNVERIFIED_TIER',
        quotaUnitCost: 1,
        resetPolicyId: 'daily',
      }),
    ).toThrow(/UNKNOWN_COST/);

    expect(() =>
      projectCostDeclaration({
        quotaUnitCost: 1,
        resetPolicyId: 'daily',
      }),
    ).toThrow(/UNKNOWN_COST/);
  });

  it('fails closed when required quota or reset fields are missing', async () => {
    let CostDeclarationModule: Record<string, unknown>;
    try {
      CostDeclarationModule = (await import('../src/cost-declaration.ts')) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error('COST_DECLARATION_NOT_IMPLEMENTED: src/cost-declaration.ts missing');
    }

    const projectCostDeclaration = CostDeclarationModule.projectCostDeclaration as (
      input: unknown,
    ) => unknown;

    expect(() =>
      projectCostDeclaration({
        costClass: 'FREE_QUOTA',
        // missing quotaUnitCost & resetPolicyId
      }),
    ).toThrow(/UNKNOWN_COST/);
  });
});
