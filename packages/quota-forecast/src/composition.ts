/** Single cost/capacity/forecast composition root consumed by contract probes. */
import type { DatabaseEngine } from '@foresift/persistence';
import type { ForecastSnapshot } from '@foresift/shared-schemas';
import type { LicensePolicySource, QuotaReservationAdapter } from '@foresift/tool-core';
import { createCostRouterComposition, type CostDeclarationSource } from '@foresift/cost-router';
import {
  CapacityPlanner,
  ResourceBudgetManager,
  type ManagedResourceBudget,
  type ResourceDemandResolver,
} from '@foresift/capacity-planner';
import { CapacityReplay } from './capacity-replay.ts';
import { CostForecast, type ForecastIncidentSink } from './forecast.ts';
import { PlanVerifier } from './plan-verifier.ts';

export interface CostCapacityCompositionOptions {
  readonly engine?: DatabaseEngine;
  readonly declarations?: CostDeclarationSource;
  readonly rightsSource?: LicensePolicySource;
  readonly planSnapshots?: readonly ForecastSnapshot[];
  readonly resourceBudgets?: readonly ManagedResourceBudget[];
  readonly resourceDemands?: ResourceDemandResolver;
  readonly incidentSink?: ForecastIncidentSink;
  readonly now?: () => string;
}

export interface CostCapacityComposition {
  readonly quotaAdapter: QuotaReservationAdapter;
  readonly licenseSource: LicensePolicySource;
  readonly planVerifier: PlanVerifier;
  readonly costForecast: CostForecast;
  readonly capacityReplay: CapacityReplay;
  readonly resourceBudgets: ResourceBudgetManager | null;
}

export function createCostCapacityComposition(
  options: CostCapacityCompositionOptions = {},
): CostCapacityComposition {
  const cost = createCostRouterComposition({
    ...(options.engine === undefined ? {} : { engine: options.engine }),
    ...(options.declarations === undefined ? {} : { declarations: options.declarations }),
    ...(options.rightsSource === undefined ? {} : { rightsSource: options.rightsSource }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const resources =
    options.resourceBudgets === undefined
      ? null
      : new ResourceBudgetManager(options.resourceBudgets);
  const quotaAdapter =
    resources === null
      ? cost.quotaAdapter
      : new CapacityPlanner(
          cost.quotaAdapter,
          resources,
          options.resourceDemands ?? (() => []),
        ).asQuotaAdapter();
  const planVerifier = new PlanVerifier(options.planSnapshots ?? [], options.now);
  return {
    quotaAdapter,
    licenseSource: cost.licenseSource,
    planVerifier,
    costForecast: new CostForecast(planVerifier, options.incidentSink),
    capacityReplay: new CapacityReplay(options.engine),
    resourceBudgets: resources,
  };
}
