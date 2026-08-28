/** Merge provider admission and independent capacity budgets at stage 12. */
import type {
  QuotaAdmissionDecision,
  QuotaEstimate,
  QuotaEstimateRequest,
  QuotaReservationAdapter,
  ReservationRequest,
} from '@foresift/tool-core';
import type { ResourceDemand, ResourceAdmission } from './resource-budgets.ts';
import { ResourceBudgetLedger } from './resource-budgets.ts';

export interface CombinedAdmissionDecision extends QuotaAdmissionDecision {
  readonly providerAdmission: QuotaAdmissionDecision;
  readonly resourceAdmissions: readonly ResourceAdmission[];
}

export class CapacityPlanner {
  constructor(
    private readonly providerQuota: QuotaReservationAdapter,
    private readonly resources: ResourceBudgetLedger,
  ) {}

  async admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
    demands: readonly ResourceDemand[],
  ): Promise<CombinedAdmissionDecision> {
    const providerAdmission = await this.providerQuota.admit(request);
    if (!providerAdmission.allowed) {
      return {
        allowed: false,
        reason: providerAdmission.reason,
        providerAdmission,
        resourceAdmissions: [],
      };
    }
    const resourceAdmissions = demands.map((demand) => this.resources.admit(demand));
    const refusal = resourceAdmissions.find((decision) => !decision.allowed);
    return {
      allowed: refusal === undefined,
      reason: refusal?.reason ?? 'ADMITTED',
      providerAdmission,
      resourceAdmissions,
    };
  }
}

export interface CapacityAwareAdapterDeps {
  readonly providerQuota: QuotaReservationAdapter;
  readonly resources: ResourceBudgetLedger;
  readonly demandsFor: (request: QuotaEstimateRequest) => readonly ResourceDemand[];
}

/** QuotaReservationAdapter binding consumed unchanged by tool-core stage 12. */
export class CapacityAwareQuotaAdapter implements QuotaReservationAdapter {
  private readonly planner: CapacityPlanner;

  constructor(private readonly deps: CapacityAwareAdapterDeps) {
    this.planner = new CapacityPlanner(deps.providerQuota, deps.resources);
  }

  estimate(request: QuotaEstimateRequest): Promise<QuotaEstimate> {
    return this.deps.providerQuota.estimate(request);
  }

  async admit(
    request: QuotaEstimateRequest & { readonly estimate: QuotaEstimate },
  ): Promise<QuotaAdmissionDecision> {
    return this.planner.admit(request, this.deps.demandsFor(request));
  }

  reserve(request: ReservationRequest): Promise<string> {
    return this.deps.providerQuota.reserve(request);
  }

  commit(request: { readonly reservationId: string; readonly actualUnits: number }): Promise<void> {
    return this.deps.providerQuota.commit(request);
  }

  release(request: { readonly reservationId: string }): Promise<void> {
    return this.deps.providerQuota.release(request);
  }
}
