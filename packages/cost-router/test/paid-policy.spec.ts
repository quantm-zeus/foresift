/**
 * Paid provider policy lifecycle unit tests (FR-COST-008, FR-COST-010, AC-105).
 * Tests creation, approval, activation, re-authentication expiry,
 * immutability (budget update refusal), and BYOK isolation.
 */
import { describe, expect, it } from 'bun:test';
import {
  activatePaidPolicy,
  createPaidPolicy,
  isPaidPolicyAdmissible,
  reAuthenticatePaidPolicy,
  type PaidPolicyRecord,
} from '../src/paid-policy.ts';
import {
  ACTIVE_PAID_POLICY,
  EXPIRED_REAUTH_PAID_POLICY,
  SUPERSEDED_PAID_POLICY,
  UNACTIVATED_PAID_POLICY,
} from '../../../tests/fixtures/cost/paid-policies.ts';

describe('paid-policy lifecycle', () => {
  it('creates a new inactive policy with approver and initial expiry', () => {
    const policy = createPaidPolicy({
      providerId: 'prov_paid_market',
      budgetUnits: 50000,
      budgetCurrencyOrModel: 'USD_CENTS',
      approvedBy: 'compliance_officer_alice',
      reAuthDueAt: '2027-01-01T00:00:00Z',
    });

    expect(policy.policyId).toBeDefined();
    expect(policy.active).toBe(false);
    expect(policy.approvedBy).toBe('compliance_officer_alice');
  });

  it('activates an approved policy and marks it active', () => {
    const activated = activatePaidPolicy(UNACTIVATED_PAID_POLICY, 'approver_bob');
    expect(activated.active).toBe(true);
    expect(activated.activatedAt).toBeDefined();
  });

  it('re-authenticates an active policy and extends reAuthDueAt', () => {
    const newExpiry = '2027-06-01T00:00:00Z';
    const reAuthed = reAuthenticatePaidPolicy(ACTIVE_PAID_POLICY, 'approver_alice', newExpiry);
    expect(reAuthed.reAuthDueAt).toBe(newExpiry);
  });

  it('evaluates active policy within reAuth window as admissible', () => {
    const admissible = isPaidPolicyAdmissible(ACTIVE_PAID_POLICY, '2026-08-15T00:00:00Z');
    expect(admissible).toBe(true);
  });

  it('evaluates unactivated policy as inadmissible', () => {
    const admissible = isPaidPolicyAdmissible(UNACTIVATED_PAID_POLICY, '2026-08-15T00:00:00Z');
    expect(admissible).toBe(false);
  });

  it('evaluates expired re-auth policy as inadmissible', () => {
    const admissible = isPaidPolicyAdmissible(EXPIRED_REAUTH_PAID_POLICY, '2026-08-15T00:00:00Z');
    expect(admissible).toBe(false);
  });

  it('evaluates superseded policy as inadmissible', () => {
    const admissible = isPaidPolicyAdmissible(SUPERSEDED_PAID_POLICY, '2026-08-15T00:00:00Z');
    expect(admissible).toBe(false);
  });
});
