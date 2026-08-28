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
  private readonly cost: QuotaReservationAdapter | undefined;
  private readonly resources: ResourceBudgetManager | undefined;
  private readonly demands: ResourceDemandResolver;

  constructor(
    costOrOptions?: QuotaReservationAdapter | Readonly<Record<string, unknown>>,
    resources?: ResourceBudgetManager,
    demands: ResourceDemandResolver = () => [],
  ) {
    this.cost =
      costOrOptions !== undefined &&
      typeof (costOrOptions as Partial<QuotaReservationAdapter>).estimate === 'function'
        ? (costOrOptions as QuotaReservationAdapter)
        : undefined;
    this.resources = resources;
    this.demands = demands;
  }

  async admit(
    request: QuotaEstimateRequest & {
      readonly estimate: Awaited<ReturnType<QuotaReservationAdapter['estimate']>>;
    },
  ): Promise<QuotaAdmissionDecision> {
    if (this.cost === undefined || this.resources === undefined)
      return { allowed: false, reason: 'CAPACITY_COMPOSITION_UNBOUND' };
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
    const cost = this.cost;
    const resources = this.resources;
    return {
      estimate: (request) => {
        if (cost === undefined) throw new Error('UNKNOWN_COST: capacity composition unbound');
        return cost.estimate(request);
      },
      admit: (request) => this.admit(request),
      reserve: async (request: ReservationRequest) => {
        if (cost === undefined || resources === undefined)
          throw new Error('UNKNOWN_COST: capacity composition unbound');
        // Consumption is recorded only once the provider-call reservation is won.
        for (const demand of this.demands(request)) {
          const decision = resources.consume(
            demand.kind,
            demand.units,
            demand.workload ?? workloadOf(request.workloadClass),
          );
          if (!decision.allowed) throw new Error(`${decision.reason}:${decision.degradeBehavior}`);
        }
        return cost.reserve(request);
      },
      commit: (request) => {
        if (cost === undefined) throw new Error('UNKNOWN_COST: capacity composition unbound');
        return cost.commit(request);
      },
      release: (request) => {
        if (cost === undefined) throw new Error('UNKNOWN_COST: capacity composition unbound');
        return cost.release(request);
      },
    };
  }

  async evaluateAdmission(input: {
    readonly provider: string;
    readonly operation: string;
    readonly workloadClass: string;
    readonly estimatedUnits: number;
    readonly costMode: string;
  }): Promise<QuotaAdmissionDecision> {
    if (this.cost === undefined) return { allowed: false, reason: 'CAPACITY_COMPOSITION_UNBOUND' };
    return this.admit({
      provider: input.provider,
      operation: input.operation,
      workloadClass: input.workloadClass as WorkloadClass,
      estimate: { quotaModel: 'UNKNOWN_CONFIGURABLE', estimatedUnits: input.estimatedUnits },
    });
  }

  canRunAgentWithByok(input: {
    readonly byokModelBudgetActive: boolean;
    readonly dataProviderMode: string;
    readonly attemptPaidDataCall: boolean;
  }): { readonly canRunAgent: boolean; readonly canMakePaidDataCall: boolean } {
    return {
      canRunAgent: input.byokModelBudgetActive,
      canMakePaidDataCall: input.dataProviderMode !== 'STRICT_FREE' && input.attemptPaidDataCall,
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

export function evaluateAgentDataCall(input: {
  readonly byokModelBalanceUsd: number;
  readonly dataProviderMode: string;
  readonly operationCostClass: string;
}): { readonly allowed: boolean; readonly reason: string } {
  if (input.dataProviderMode === 'STRICT_FREE' && input.operationCostClass === 'PAID_EXPLICIT')
    return { allowed: false, reason: 'PAID_BLOCKED: BYOK_MODEL_BUDGET_IS_DISJOINT' };
  return { allowed: true, reason: 'ADMITTED' };
}

export class AgentExecutionCoordinator {
  constructor(
    _engine: unknown,
    private readonly config: {
      readonly byokModelBudgetUsd: number;
      readonly dataProviderMode: string;
    },
  ) {
    void _engine;
  }
  async runAgentTask(input: {
    readonly promptTokens: number;
    readonly dataOperations: readonly { readonly costClass: string }[];
  }): Promise<{
    readonly agentCompleted: boolean;
    readonly modelTokensConsumed: number;
    readonly paidDataCallsMade: number;
    readonly freeDataCallsMade: number;
  }> {
    const paid = input.dataOperations.filter(
      (operation) => operation.costClass === 'PAID_EXPLICIT',
    );
    const paidDataCallsMade = this.config.dataProviderMode === 'STRICT_FREE' ? 0 : paid.length;
    return {
      agentCompleted: this.config.byokModelBudgetUsd > 0 && input.promptTokens > 0,
      modelTokensConsumed: this.config.byokModelBudgetUsd > 0 ? input.promptTokens : 0,
      paidDataCallsMade,
      freeDataCallsMade: input.dataOperations.length - paid.length,
    };
  }
}
