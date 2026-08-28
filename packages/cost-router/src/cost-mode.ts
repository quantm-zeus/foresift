/** Per-call free/paid policy resolution, STRICT_FREE by default (FR-COST-008/010). */
import { CostMode } from '@foresift/domain';
import type { LicensePolicySource, LicenseQuery } from '@foresift/tool-core';
import type { LicenseVerdict } from '@foresift/shared-schemas';
import type { ActivePaidPolicySource } from './paid-policy.ts';

export const DEFAULT_COST_MODE = CostMode.STRICT_FREE;

export interface CostModeResolution {
  readonly mode: CostMode;
  readonly policyVersion: string;
  readonly budgetUnits?: number;
}

export class CostModeResolver {
  constructor(private readonly paidPolicies: ActivePaidPolicySource | undefined) {}

  async resolve(providerId: string, requestedMode?: CostMode): Promise<CostModeResolution> {
    if (requestedMode !== CostMode.PAID_ENABLED) {
      return { mode: CostMode.STRICT_FREE, policyVersion: 'strict-free@1' };
    }
    const policy = await this.paidPolicies?.activeFor(providerId);
    if (policy === undefined) return { mode: CostMode.STRICT_FREE, policyVersion: 'strict-free@1' };
    return {
      mode: CostMode.PAID_ENABLED,
      policyVersion: policy.policyId,
      budgetUnits: policy.budgetUnits,
    };
  }
}

/** Cache-key policy source wiring point for a composed cost-mode policy. */
export class CostModeLicensePolicySource implements LicensePolicySource {
  constructor(private readonly modes: CostModeResolver) {}

  async verdict(query: LicenseQuery): Promise<LicenseVerdict> {
    const resolution = await this.modes.resolve(query.provider);
    return {
      allowed: true,
      policyVersion: resolution.policyVersion,
      reason: `cost mode ${resolution.mode}; rights must still be checked by the rights policy source`,
    };
  }
}

export { CostModeResolver as CostModePolicy };
