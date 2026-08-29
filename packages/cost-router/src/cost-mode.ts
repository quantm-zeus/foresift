import { CostMode } from '@foresift/domain';
import type { LicensePolicySource, LicenseQuery } from '@foresift/tool-core';
import { PaidPolicyRepository } from './paid-policy.ts';

export const DEFAULT_COST_MODE = CostMode.STRICT_FREE;

export class CostModePolicy {
  constructor(private readonly paidPolicies?: PaidPolicyRepository) {}
  async resolve(providerId: string): Promise<CostMode> {
    if (this.paidPolicies === undefined) return DEFAULT_COST_MODE;
    return (await this.paidPolicies.activeForProvider(providerId)) === null
      ? CostMode.STRICT_FREE
      : CostMode.PAID_ENABLED;
  }
}

/** Paid-policy version source for tool-core's rights/cache-key seam. */
export class PaidPolicyLicenseSource implements LicensePolicySource {
  constructor(private readonly policies: PaidPolicyRepository) {}
  async verdict(query: LicenseQuery) {
    const policy = await this.policies.activeForProvider(query.provider);
    if (policy === null)
      return {
        allowed: false,
        policyVersion: 'strict-free',
        reason: `no current paid policy for ${query.provider}`,
      };
    const requestedMatches =
      query.requestedVersion === undefined || query.requestedVersion === policy.policyId;
    return {
      allowed: requestedMatches,
      policyVersion: policy.policyId,
      reason: requestedMatches
        ? 'active paid provider policy'
        : 'requested policy version is not active',
    };
  }
}
