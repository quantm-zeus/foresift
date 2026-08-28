/** Concrete cost/capacity composition accepted by tool-core extension seams. */
import {
  CapacityAwareQuotaAdapter,
  ResourceBudgetLedger,
  type ResourceDemand,
} from '@foresift/capacity-planner';
import {
  CostModeLicensePolicySource,
  CostModeResolver,
  CostQuotaReservationAdapter,
  PaidProviderPolicyStore,
  ProviderOperationCostDeclarationSource,
  type QuotaAdapterRequestFlags,
} from '@foresift/cost-router';
import { ErrorCode, ForesiftError } from '@foresift/domain';
import { createEngine, type DatabaseEngine, type RawSqlClient } from '@foresift/persistence';
import type { ResourceBudget } from '@foresift/shared-schemas';
import type {
  LicensePolicySource,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
  ReservationRequest,
} from '@foresift/tool-core';
import { PlanVerifier } from './plan-verifier.ts';

export interface CostCapacityComposition {
  readonly quotaAdapter: QuotaReservationAdapter;
  readonly licensePolicySource: LicensePolicySource;
  readonly paidPolicies: PaidProviderPolicyStore;
  readonly resourceBudgets: ResourceBudgetLedger;
  readonly planVerifier: PlanVerifier;
}

export interface CostCapacityCompositionOptions {
  readonly engine: DatabaseEngine;
  readonly resourceBudgets: readonly ResourceBudget[];
  readonly demandsFor?: (request: QuotaEstimateRequest) => readonly ResourceDemand[];
  readonly flags?: (request: QuotaEstimateRequest) => QuotaAdapterRequestFlags;
  readonly now?: () => Date;
}

export function createCostCapacityComposition(
  options: CostCapacityCompositionOptions,
): CostCapacityComposition {
  const paidPolicies = new PaidProviderPolicyStore(options.engine, options.now);
  const modes = new CostModeResolver(paidPolicies);
  const declarations = new ProviderOperationCostDeclarationSource(options.engine);
  const providerQuota = new CostQuotaReservationAdapter({
    engine: options.engine,
    declarations,
    costModes: modes,
    ...(options.flags === undefined ? {} : { flags: options.flags }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const resourceBudgets = new ResourceBudgetLedger(options.resourceBudgets);
  const quotaAdapter = new CapacityAwareQuotaAdapter({
    providerQuota,
    resources: resourceBudgets,
    demandsFor: options.demandsFor ?? (() => []),
  });
  return {
    quotaAdapter,
    licensePolicySource: new CostModeLicensePolicySource(modes),
    paidPolicies,
    resourceBudgets,
    planVerifier: new PlanVerifier(options.engine, options.now),
  };
}

/** Convenience binding for PGlite-compatible test clients without importing the driver here. */
export function createPGliteCostCapacityComposition(
  client: RawSqlClient,
  options: Omit<CostCapacityCompositionOptions, 'engine'>,
): CostCapacityComposition {
  return createCostCapacityComposition({ ...options, engine: createEngine(client, 'pglite') });
}

/** Explicit production-safe value for a missing composition seam. */
export class DenyClosedCostQuotaAdapter implements QuotaReservationAdapter {
  async estimate(_request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'no cost-capacity composition is bound');
  }

  async admit(_request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate }) {
    return { allowed: false, reason: 'UNKNOWN_COST:cost-capacity composition is unbound' } as const;
  }

  async reserve(_request: ReservationRequest): Promise<string> {
    throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'unbound adapter refuses reservation');
  }

  async commit(_request: {
    readonly reservationId: string;
    readonly actualUnits: number;
  }): Promise<void> {
    throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'unbound adapter refuses commit');
  }

  async release(_request: { readonly reservationId: string }): Promise<void> {
    throw new ForesiftError(ErrorCode.UNKNOWN_COST, 'unbound adapter refuses release');
  }
}
