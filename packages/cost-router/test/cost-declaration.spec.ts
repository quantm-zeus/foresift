/**
 * Cost declaration read view unit tests (FR-COST-001, AC-100, AC-103).
 * Verifies all 7 fields projected from provider operations, and fail-closed
 * rejection on missing fields or unrecognized enums.
 */
import { describe, expect, it } from 'bun:test';
import {
  isCostDeclarationComplete,
  loadCostDeclaration,
  type OperationCostDeclaration,
} from '../src/cost-declaration.ts';
import {
  FREE_QUOTA_OP,
  FREE_UNMETERED_OP,
  PAID_EXPLICIT_OP,
  UNKNOWN_COST_OP,
} from '../../../tests/fixtures/cost/operations.ts';

describe('loadCostDeclaration', () => {
  it('loads valid declaration with all 7 FR-COST-001 fields', () => {
    const decl = loadCostDeclaration({
      provider_id: FREE_QUOTA_OP.providerId,
      operation_id: FREE_QUOTA_OP.operationId,
      version: FREE_QUOTA_OP.version,
      cost_class: FREE_QUOTA_OP.costClass,
      quota_model_id: FREE_QUOTA_OP.quotaModelId,
      estimated_quota_units: FREE_QUOTA_OP.estimatedQuotaUnits,
      quota_reset_policy_id: FREE_QUOTA_OP.quotaResetPolicyId,
      batch_capability: FREE_QUOTA_OP.batchCapability,
      minimum_candidate_stage: FREE_QUOTA_OP.minimumCandidateStage,
      protected_reserve_eligible: FREE_QUOTA_OP.protectedReserveEligible,
      allowed_in_strict_free: FREE_QUOTA_OP.allowedInStrictFree,
      verification_expires_at: FREE_QUOTA_OP.verificationExpiresAt,
    });

    expect(decl.costClass).toBe('FREE_QUOTA');
    expect(decl.quotaUnitCost).toBe(1);
    expect(decl.resetPolicyId).toBe('DAILY_MIDNIGHT_UTC');
    expect(decl.batchCapability).toEqual(FREE_QUOTA_OP.batchCapability);
    expect(decl.minimumCandidateStage).toBe('DISCOVERED');
    expect(decl.protectedReserveEligible).toBe(true);
    expect(decl.allowedInStrictFree).toBe(true);
  });

  it('fails closed when any of the 7 fields is missing', () => {
    const raw = {
      provider_id: 'prov_test',
      operation_id: 'op_test',
      version: '1.0.0',
      cost_class: 'FREE_QUOTA',
      quota_model_id: 'REQUESTS_PER_PERIOD',
      estimated_quota_units: 1,
      quota_reset_policy_id: 'DAILY_MIDNIGHT_UTC',
      batch_capability: null,
      minimum_candidate_stage: 'DISCOVERED',
      protected_reserve_eligible: true,
      allowed_in_strict_free: true,
    };

    const keysToOmit = [
      'cost_class',
      'estimated_quota_units',
      'quota_reset_policy_id',
      'minimum_candidate_stage',
      'protected_reserve_eligible',
      'allowed_in_strict_free',
    ] as const;

    for (const key of keysToOmit) {
      const copy = { ...raw };
      delete (copy as Record<string, unknown>)[key];
      expect(() => loadCostDeclaration(copy)).toThrow(/UNKNOWN_COST/);
    }
  });

  it('fails closed when costClass holds an unrecognized enum value', () => {
    const raw = {
      provider_id: 'prov_test',
      operation_id: 'op_test',
      version: '1.0.0',
      cost_class: 'SUPER_CHEAP_DISCOUNT', // invalid enum
      quota_model_id: 'REQUESTS_PER_PERIOD',
      estimated_quota_units: 1,
      quota_reset_policy_id: 'DAILY_MIDNIGHT_UTC',
      batch_capability: null,
      minimum_candidate_stage: 'DISCOVERED',
      protected_reserve_eligible: true,
      allowed_in_strict_free: true,
    };

    expect(() => loadCostDeclaration(raw)).toThrow(/UNKNOWN_COST/);
  });

  it('isCostDeclarationComplete correctly validates objects', () => {
    expect(isCostDeclarationComplete(FREE_UNMETERED_OP)).toBe(true);
    expect(isCostDeclarationComplete(FREE_QUOTA_OP)).toBe(true);
    expect(isCostDeclarationComplete(PAID_EXPLICIT_OP)).toBe(true);
    expect(isCostDeclarationComplete(UNKNOWN_COST_OP)).toBe(true);
    expect(isCostDeclarationComplete({ costClass: 'FREE_QUOTA' })).toBe(false);
  });
});
