/** One capacity-aware quota admission decision for tool-core stage 12. */
import type { ResourceBudgetKind, WorkloadClass } from '@foresift/domain';
import type {
  QuotaAdmissionDecision,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
  ReservationRequest,
} from '@foresift/tool-core';
import type { CapacityWorkload } from './resource-budgets.ts';
import { ResourceBudgetManager } from './resource-budgets.ts';

export interface ResourceDemand {
  readonly kind: ResourceBudgetKind;
  readonly units: number;
  readonly workload?: CapacityWorkload;
}

export type ResourceDemandResolver = (request: QuotaEstimateRequest) => readonly ResourceDemand[];

export class CapacityPlanner {
  constructor(
    private readonly cost: QuotaReservationAdapter,
    private readonly resources: ResourceBudgetManager,
    private readonly demands: ResourceDemandResolver = () => [],
  ) {}

  async admit(
    request: QuotaEstimateRequest & {
      readonly estimate: Awaited<ReturnType<QuotaReservationAdapter['estimate']>>;
    },
  ): Promise<QuotaAdmissionDecision> {
    const cost = await this.cost.admit(request);
    if (!cost.allowed) return cost;
    for (const demand of this.demands(request)) {
      const decision = this.resources.admit(
        demand.kind,
        demand.units,
        demand.workload ?? workloadOf(request.workloadClass),
      );
      if (!decision.allowed) {
        return { allowed: false, reason: `${decision.reason}:${decision.degradeBehavior}` };
      }
    }
    return { allowed: true, reason: 'COST_AND_CAPACITY_ADMITTED' };
  }

  asQuotaAdapter(): QuotaReservationAdapter {
    return {
      estimate: (request) => this.cost.estimate(request),
      admit: (request) => this.admit(request),
      reserve: async (request: ReservationRequest) => {
        // Consumption is recorded only once the provider-call reservation is won.
        for (const demand of this.demands(request)) {
          const decision = this.resources.consume(
            demand.kind,
            demand.units,
            demand.workload ?? workloadOf(request.workloadClass),
          );
          if (!decision.allowed) throw new Error(`${decision.reason}:${decision.degradeBehavior}`);
        }
        return this.cost.reserve(request);
      },
      commit: (request) => this.cost.commit(request),
      release: (request) => this.cost.release(request),
    };
  }
}

function workloadOf(workload: WorkloadClass): CapacityWorkload {
  return workload === 'RISK_MONITOR_HIGH'
    ? 'CRITICAL_RISK_MONITORING'
    : workload === 'EVALUATION_LOW' || workload === 'BACKFILL_LOW'
      ? 'LOW_PRIORITY_ENRICHMENT'
      : 'NORMAL';
}

export function createCapacityAwareQuotaAdapter(
  cost: QuotaReservationAdapter,
  resources: ResourceBudgetManager,
  demands?: ResourceDemandResolver,
): QuotaReservationAdapter {
  return new CapacityPlanner(cost, resources, demands).asQuotaAdapter();
}
