import {
  ResourceBudgetKind,
  WorkloadClass,
  type ResourceBudgetKind as BudgetKind,
  type WorkloadClass as WorkloadClassType,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';

export interface ResourceBudgetState {
  readonly kind: BudgetKind;
  readonly capLimit: number;
  readonly used: number;
  readonly forecastUsed: number;
  readonly degradeBehavior: string;
  readonly ceilingExceededAt: string | null;
}
export interface ResourceBudgetDemand {
  readonly kind: BudgetKind;
  readonly units: number;
}
export interface ResourceBudgetDecision {
  readonly allowed: boolean;
  readonly exhausted: readonly BudgetKind[];
  readonly reason: string;
}

export class ResourceBudgetManager {
  private readonly budgets = new Map<BudgetKind, ResourceBudgetState>();
  constructor(initial: readonly ResourceBudgetState[] = []) {
    for (const budget of initial) this.set(budget);
  }
  set(budget: ResourceBudgetState): void {
    if (
      !Number.isFinite(budget.capLimit) ||
      !Number.isFinite(budget.used) ||
      budget.capLimit < 0 ||
      budget.used < 0 ||
      budget.used > budget.capLimit
    ) {
      throw new Error('RESOURCE_BUDGET_INVALID: used must be within its independent cap');
    }
    this.budgets.set(budget.kind, { ...budget });
  }
  get(kind: BudgetKind): ResourceBudgetState | undefined {
    return this.budgets.get(kind);
  }
  admit(
    demands: readonly ResourceBudgetDemand[],
    workloadClass?: WorkloadClassType,
  ): ResourceBudgetDecision {
    const exhausted = demands
      .filter((demand) => {
        const budget = this.budgets.get(demand.kind);
        return (
          budget === undefined ||
          demand.units < 0 ||
          budget.used + demand.units > budget.capLimit ||
          budget.forecastUsed > budget.capLimit
        );
      })
      .map((d) => d.kind);
    if (exhausted.length === 0)
      return { allowed: true, exhausted: [], reason: 'RESOURCE_BUDGETS_AVAILABLE' };
    const critical = workloadClass === WorkloadClass.RISK_MONITOR_HIGH;
    if (critical) {
      return {
        allowed: true,
        exhausted,
        reason: 'CRITICAL_RISK_MONITORING_PRESERVED: exhausted dimensions must degrade dependents',
      };
    }
    return {
      allowed: false,
      exhausted,
      reason: `SKIP_LOW_PRIORITY: resource budget ${exhausted.join(',')} exhausted`,
    };
  }
  consume(demands: readonly ResourceBudgetDemand[]): void {
    const decision = this.admit(demands);
    if (!decision.allowed) throw new Error(decision.reason);
    for (const demand of demands) {
      const budget = this.budgets.get(demand.kind)!;
      this.budgets.set(demand.kind, { ...budget, used: budget.used + demand.units });
    }
  }
  /** BYOK has its own map key and cannot alter any provider quota counter. */
  consumeByokModelTokens(units: number): void {
    this.consume([{ kind: ResourceBudgetKind.MODEL_TOKENS_BYOK, units }]);
  }
}

interface BudgetRow {
  kind: BudgetKind;
  cap_limit: string | number;
  used: string | number;
  forecast_used: string | number;
  degrade_behavior: string;
  ceiling_exceeded_at: string | Date | null;
}
export async function loadResourceBudgets(engine: DatabaseEngine): Promise<ResourceBudgetManager> {
  const rows = await engine.query<BudgetRow>(
    'SELECT * FROM cost.capacity_resource_budgets ORDER BY kind',
  );
  return new ResourceBudgetManager(
    rows.rows.map((row) => ({
      kind: row.kind,
      capLimit: Number(row.cap_limit),
      used: Number(row.used),
      forecastUsed: Number(row.forecast_used),
      degradeBehavior: row.degrade_behavior,
      ceilingExceededAt:
        row.ceiling_exceeded_at === null
          ? null
          : row.ceiling_exceeded_at instanceof Date
            ? row.ceiling_exceeded_at.toISOString()
            : row.ceiling_exceeded_at,
    })),
  );
}
