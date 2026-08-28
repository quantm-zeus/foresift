/** Per-call data-provider cost mode resolution (FR-COST-008/010). */
import { CostMode } from '@foresift/domain';
import type { CostMode as CostModeType } from '@foresift/domain';
import type { LicensePolicySource, LicenseQuery } from '@foresift/tool-core';
import type { LicenseVerdict } from '@foresift/shared-schemas';
import type { ActivePaidPolicySource } from './paid-policy.ts';

export const STRICT_FREE_DEFAULT: CostModeType = CostMode.STRICT_FREE;

export interface ResolvedCostMode {
  readonly mode: CostModeType;
  readonly policyId: string;
}

export class CostModePolicy {
  constructor(private readonly paidPolicies?: ActivePaidPolicySource) {}

  async resolve(provider: string, at?: string): Promise<ResolvedCostMode> {
    const policy = await this.paidPolicies?.activePolicy(provider, at);
    return policy === undefined || policy === null
      ? { mode: CostMode.STRICT_FREE, policyId: 'strict-free-default' }
      : { mode: CostMode.PAID_ENABLED, policyId: policy.policyId };
  }
}

/**
 * Decorates the actual rights source with the resolved cost-policy version so
 * exact cache keys cannot be reused across STRICT_FREE/paid-policy changes.
 */
export class CostModeLicensePolicySource implements LicensePolicySource {
  constructor(
    private readonly rights: LicensePolicySource,
    private readonly modes: CostModePolicy,
  ) {}

  async verdict(query: LicenseQuery): Promise<LicenseVerdict> {
    const rights = await this.rights.verdict(query);
    const mode = await this.modes.resolve(query.provider);
    return {
      allowed: rights.allowed,
      policyVersion: `${rights.policyVersion}|cost:${mode.policyId}`,
      reason: rights.allowed ? `${rights.reason}; cost mode ${mode.mode}` : rights.reason,
    };
  }
}

export { CostModePolicy as CostModePolicyHolder };
