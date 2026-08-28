import type {
  QuotaReservationAdapter as ToolQuotaAdapter,
  QuotaEstimateRequest,
  QuotaEstimate,
  QuotaAdmissionDecision,
  ReservationRequest,
  LicensePolicySource,
} from '@foresift/tool-core';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  QuotaReservationAdapter,
  PaidPolicyRepository,
  PaidPolicyLicenseSource,
  CostModePolicy,
  type PlanFreshnessSource,
} from '@foresift/cost-router';
import { ResourceBudgetManager, type ResourceBudgetDemand } from './resource-budgets.ts';

export type ResourceDemandSource = (
  request: QuotaEstimateRequest,
) => readonly ResourceBudgetDemand[];
export class CapacityPlannerAdapter implements ToolQuotaAdapter {
  constructor(
    private readonly costAdapter: ToolQuotaAdapter,
    private readonly budgets: ResourceBudgetManager,
    private readonly demandSource: ResourceDemandSource = () => [],
  ) {}
  estimate(request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    return this.costAdapter.estimate(request);
  }
  async admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision> {
    const cost = await this.costAdapter.admit(request);
    if (!cost.allowed) return cost;
    const capacity = this.budgets.admit(this.demandSource(request), request.workloadClass);
    return capacity.allowed ? cost : { allowed: false, reason: capacity.reason };
  }
  reserve(request: ReservationRequest): Promise<string> {
    return this.costAdapter.reserve(request);
  }
  commit(request: { readonly reservationId: string; readonly actualUnits: number }): Promise<void> {
    return this.costAdapter.commit(request);
  }
  release(request: { readonly reservationId: string }): Promise<void> {
    return this.costAdapter.release(request);
  }
}

export interface CostCapacityCompositionOptions {
  readonly engine: DatabaseEngine;
  readonly budgets?: ResourceBudgetManager;
  readonly demandSource?: ResourceDemandSource;
  readonly planFreshness?: PlanFreshnessSource;
}
export interface CostCapacityComposition {
  readonly quotaAdapter: ToolQuotaAdapter;
  readonly licensePolicySource: LicensePolicySource;
  readonly paidPolicies: PaidPolicyRepository;
  readonly resourceBudgets: ResourceBudgetManager;
}
export function createCostCapacityComposition(
  options: CostCapacityCompositionOptions,
): CostCapacityComposition {
  const paidPolicies = new PaidPolicyRepository(options.engine);
  const raw = new QuotaReservationAdapter({
    engine: options.engine,
    costMode: new CostModePolicy(paidPolicies),
    ...(options.planFreshness === undefined ? {} : { planFreshness: options.planFreshness }),
  });
  const resourceBudgets = options.budgets ?? new ResourceBudgetManager();
  return {
    quotaAdapter: new CapacityPlannerAdapter(raw, resourceBudgets, options.demandSource),
    licensePolicySource: new PaidPolicyLicenseSource(paidPolicies),
    paidPolicies,
    resourceBudgets,
  };
}
