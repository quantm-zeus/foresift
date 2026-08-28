/** Production composition root for tool-core's quota and license seams (T031). */
import type { DatabaseEngine } from '@foresift/persistence';
import {
  UnverifiableRightsRefusedSource,
  type LicensePolicySource,
  type QuotaReservationAdapter,
} from '@foresift/tool-core';
import type { CostDeclarationSource } from './cost-declaration.ts';
import { CostModeLicensePolicySource, CostModePolicy } from './cost-mode.ts';
import { PaidPolicyStore } from './paid-policy.ts';
import { createQuotaReservationAdapter } from './quota-adapter.ts';

export interface CostRouterCompositionOptions {
  readonly engine?: DatabaseEngine;
  readonly declarations?: CostDeclarationSource;
  readonly rightsSource?: LicensePolicySource;
  readonly now?: () => string;
}

export interface CostRouterComposition {
  readonly quotaAdapter: QuotaReservationAdapter;
  readonly licenseSource: LicensePolicySource;
  readonly modes: CostModePolicy;
}

export function createCostRouterComposition(
  options: CostRouterCompositionOptions = {},
): CostRouterComposition {
  const rights = options.rightsSource ?? new UnverifiableRightsRefusedSource();
  if (options.engine === undefined) {
    const modes = new CostModePolicy();
    return {
      quotaAdapter: createQuotaReservationAdapter(),
      licenseSource: new CostModeLicensePolicySource(rights, modes),
      modes,
    };
  }
  const paidPolicies = new PaidPolicyStore(options.engine);
  const modes = new CostModePolicy(paidPolicies);
  return {
    quotaAdapter: createQuotaReservationAdapter({
      engine: options.engine,
      paidPolicies,
      modes,
      ...(options.declarations === undefined ? {} : { declarations: options.declarations }),
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
    licenseSource: new CostModeLicensePolicySource(rights, modes),
    modes,
  };
}
