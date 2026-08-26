/**
 * License-policy extension-point contract (FR-CORE-008; PRD §16.7). The
 * interface returns typed verdicts {allowed, policyVersion, reason}; the
 * shipped default source refuses EVERY call whose rights status cannot be
 * verified — fail-closed by construction, with no allow path whatsoever.
 * Implementations live outside packages/tool-core/** (g0-cost-capacity).
 *
 * The verdict feeds two consumers: execution admission and the license
 * component of the exact cache key.
 */
import type { LicenseVerdict } from '@foresift/shared-schemas';

export interface LicenseQuery {
  readonly licensePolicyId: string;
  readonly provider: string;
  readonly operation: string;
  /** When present, the caller pins the acceptable policy version. */
  readonly requestedVersion?: string;
}

export type { LicenseVerdict };

/**
 * THE license injection seam consumed by the composition root and by the
 * cache-key builder's `licensePolicyVersion` component.
 */
export interface LicensePolicySource {
  verdict(query: LicenseQuery): Promise<LicenseVerdict>;
}

/**
 * Default source: rights status is unverifiable ⇒ refuse. There is no
 * configuration that turns this into an allow; a real policy source must be
 * injected at composition time to admit anything.
 */
export class UnverifiableRightsRefusedSource implements LicensePolicySource {
  async verdict(query: LicenseQuery): Promise<LicenseVerdict> {
    return {
      allowed: false,
      policyVersion: query.requestedVersion ?? 'unverified',
      reason: `rights status could not be verified for ${query.provider}/${query.operation}`,
    };
  }
}
