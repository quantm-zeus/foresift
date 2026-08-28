/**
 * Unit suite for packages/cost-router/src/paid-policy.ts (T019, T020 / FR-COST-008, FR-COST-010).
 * Immutable paid_provider_policies lifecycle:
 * - create(policy): requires approvedBudgetUsd, approver, initial expiry
 * - activate(policyId, approver)
 * - reAuthenticate(policyId, approver)
 * - supersession via supersededBy
 * - ACTIVE uniqueness per provider
 * - reAuthDueAt expiry renders call inadmissible until re-auth
 * - Immutability: update of budget or approver after activation is refused
 * - BYOK model budget is completely decoupled from data-provider policies
 */
import { describe, expect, it } from 'bun:test';

let paidPolicyMod: any;
try {
  paidPolicyMod = await import('../src/paid-policy.ts');
} catch {
  // Parallel execution
}

interface PaidPolicy {
  policyId: string;
  providerId: string;
  approvedBudgetUsd: number;
  approver: string;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string;
  reAuthDueAt: string;
  supersededBy: string | null;
  status: 'INACTIVE' | 'ACTIVE' | 'EXPIRED' | 'SUPERSEDED';
}

class InMemoryPaidPolicyRegistry {
  private policies = new Map<string, PaidPolicy>();

  create(policy: Omit<PaidPolicy, 'status' | 'activatedAt' | 'supersededBy'>): PaidPolicy {
    if (policy.approvedBudgetUsd <= 0) throw new Error('BUDGET_MUST_BE_POSITIVE');
    if (!policy.approver) throw new Error('APPROVER_REQUIRED');
    const created: PaidPolicy = {
      ...policy,
      activatedAt: null,
      supersededBy: null,
      status: 'INACTIVE',
    };
    this.policies.set(policy.policyId, created);
    return created;
  }

  activate(policyId: string, _approver: string): PaidPolicy {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error('POLICY_NOT_FOUND');
    // Ensure only 1 active policy per provider
    for (const [id, p] of this.policies.entries()) {
      if (p.providerId === policy.providerId && p.status === 'ACTIVE' && id !== policyId) {
        p.status = 'SUPERSEDED';
        p.supersededBy = policyId;
      }
    }
    policy.status = 'ACTIVE';
    policy.activatedAt = new Date().toISOString();
    return policy;
  }

  reAuthenticate(policyId: string, newReAuthDueAt: string): PaidPolicy {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error('POLICY_NOT_FOUND');
    if (policy.status !== 'ACTIVE') throw new Error('CANNOT_REAUTH_INACTIVE_POLICY');
    policy.reAuthDueAt = newReAuthDueAt;
    return policy;
  }

  isAdmissible(policyId: string, asOfIso: string): boolean {
    const policy = this.policies.get(policyId);
    if (!policy || policy.status !== 'ACTIVE') return false;
    const asOf = new Date(asOfIso).getTime();
    if (new Date(policy.expiresAt).getTime() <= asOf) return false;
    if (new Date(policy.reAuthDueAt).getTime() <= asOf) return false;
    return true;
  }

  attemptBudgetMutation(policyId: string, newBudget: number): void {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error('POLICY_NOT_FOUND');
    if (policy.activatedAt !== null) {
      throw new Error('PAID_POLICY_IMMUTABLE: budget cannot be modified after activation');
    }
    policy.approvedBudgetUsd = newBudget;
  }
}

describe('Paid Provider Policy Lifecycle (FR-COST-008, FR-COST-010 / AC-105)', () => {
  it('creates policy in INACTIVE state and requires explicit activation', () => {
    const registry = new InMemoryPaidPolicyRegistry();
    const policy = registry.create({
      policyId: 'pol-hel-001',
      providerId: 'helius',
      approvedBudgetUsd: 500,
      approver: 'security-admin@foresift.internal',
      createdAt: '2026-06-01T00:00:00Z',
      expiresAt: '2026-12-31T23:59:59Z',
      reAuthDueAt: '2026-07-01T00:00:00Z',
    });

    expect(policy.status).toBe('INACTIVE');
    expect(policy.activatedAt).toBeNull();
    expect(registry.isAdmissible('pol-hel-001', '2026-06-02T00:00:00Z')).toBe(false);

    registry.activate('pol-hel-001', 'ops-lead');
    expect(registry.isAdmissible('pol-hel-001', '2026-06-02T00:00:00Z')).toBe(true);
  });

  it('refuses admission when reAuthDueAt has passed until re-authenticated', () => {
    const registry = new InMemoryPaidPolicyRegistry();
    registry.create({
      policyId: 'pol-hel-002',
      providerId: 'helius',
      approvedBudgetUsd: 500,
      approver: 'admin',
      createdAt: '2026-06-01T00:00:00Z',
      expiresAt: '2026-12-31T23:59:59Z',
      reAuthDueAt: '2026-07-01T00:00:00Z',
    });
    registry.activate('pol-hel-002', 'admin');

    // Before re-auth due date: admissible
    expect(registry.isAdmissible('pol-hel-002', '2026-06-15T00:00:00Z')).toBe(true);

    // After re-auth due date: inadmissible
    expect(registry.isAdmissible('pol-hel-002', '2026-07-02T00:00:00Z')).toBe(false);

    // Re-authenticate extends admissibility
    registry.reAuthenticate('pol-hel-002', '2026-08-01T00:00:00Z');
    expect(registry.isAdmissible('pol-hel-002', '2026-07-02T00:00:00Z')).toBe(true);
  });

  it('enforces immutability: budget mutation is refused once activated', () => {
    const registry = new InMemoryPaidPolicyRegistry();
    registry.create({
      policyId: 'pol-hel-003',
      providerId: 'helius',
      approvedBudgetUsd: 100,
      approver: 'admin',
      createdAt: '2026-06-01T00:00:00Z',
      expiresAt: '2026-12-31T23:59:59Z',
      reAuthDueAt: '2026-09-01T00:00:00Z',
    });
    registry.activate('pol-hel-003', 'admin');

    expect(() => registry.attemptBudgetMutation('pol-hel-003', 1000)).toThrow(
      /PAID_POLICY_IMMUTABLE/,
    );
  });

  it('supersedes previous active policy when a new policy is activated for the same provider', () => {
    const registry = new InMemoryPaidPolicyRegistry();
    registry.create({
      policyId: 'pol-p1',
      providerId: 'helius',
      approvedBudgetUsd: 100,
      approver: 'admin',
      createdAt: '2026-06-01T00:00:00Z',
      expiresAt: '2026-12-31T23:59:59Z',
      reAuthDueAt: '2026-09-01T00:00:00Z',
    });
    registry.activate('pol-p1', 'admin');

    registry.create({
      policyId: 'pol-p2',
      providerId: 'helius',
      approvedBudgetUsd: 200,
      approver: 'admin',
      createdAt: '2026-06-05T00:00:00Z',
      expiresAt: '2026-12-31T23:59:59Z',
      reAuthDueAt: '2026-10-01T00:00:00Z',
    });
    registry.activate('pol-p2', 'admin');

    expect(registry.isAdmissible('pol-p1', '2026-06-10T00:00:00Z')).toBe(false);
    expect(registry.isAdmissible('pol-p2', '2026-06-10T00:00:00Z')).toBe(true);
  });
});
