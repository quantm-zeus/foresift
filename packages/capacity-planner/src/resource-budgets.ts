/** Six isolated, independently capped capacity dimensions (FR-COST-009/010). */
import { ResourceBudgetKind, type ResourceBudgetKind as BudgetKind } from '@foresift/domain';
import { ResourceBudgetSchema, type ResourceBudget } from '@foresift/shared-schemas';

export interface ResourceDemand {
  readonly kind: BudgetKind;
  readonly units: number;
  readonly dependentWorkload: string;
  readonly frozenEvidence?: boolean;
  readonly criticalRiskMonitoring?: boolean;
}

export interface ResourceAdmission {
  readonly allowed: boolean;
  readonly kind: BudgetKind;
  readonly reason: string;
  readonly degradeBehavior: string | null;
}

export class ResourceBudgetLedger {
  private readonly budgets = new Map<BudgetKind, ResourceBudget>();

  constructor(initial: readonly ResourceBudget[]) {
    for (const raw of initial) {
      const budget = ResourceBudgetSchema.parse(raw);
      if (this.budgets.has(budget.kind))
        throw new Error(`duplicate resource budget ${budget.kind}`);
      this.budgets.set(budget.kind, budget);
    }
  }

  get(kind: BudgetKind): ResourceBudget | undefined {
    return this.budgets.get(kind);
  }

  snapshot(): readonly ResourceBudget[] {
    return [...this.budgets.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  }

  admit(demand: ResourceDemand): ResourceAdmission {
    if (!Number.isFinite(demand.units) || demand.units < 0) {
      return {
        allowed: false,
        kind: demand.kind,
        reason: 'QUOTA_EXHAUSTED:INVALID_RESOURCE_DEMAND',
        degradeBehavior: null,
      };
    }
    const budget = this.budgets.get(demand.kind);
    if (budget === undefined) {
      return {
        allowed: false,
        kind: demand.kind,
        reason: `QUOTA_EXHAUSTED:UNBOUND_RESOURCE_BUDGET:${demand.kind}`,
        degradeBehavior: null,
      };
    }
    if (budget.used + demand.units <= budget.capLimit) {
      return {
        allowed: true,
        kind: demand.kind,
        reason: 'RESOURCE_ADMITTED',
        degradeBehavior: null,
      };
    }
    // Frozen evidence is never mutated/deleted, and critical risk monitoring
    // is never silently degraded; callers receive an explicit hard refusal.
    if (demand.frozenEvidence === true || demand.criticalRiskMonitoring === true) {
      return {
        allowed: false,
        kind: demand.kind,
        reason: `QUOTA_EXHAUSTED:PROTECTED_WORKLOAD:${demand.kind}`,
        degradeBehavior: null,
      };
    }
    return {
      allowed: false,
      kind: demand.kind,
      reason: `${budget.degradeBehavior}:${demand.kind}:${demand.dependentWorkload}`,
      degradeBehavior: budget.degradeBehavior,
    };
  }

  consume(demand: ResourceDemand): ResourceAdmission {
    const admission = this.admit(demand);
    if (!admission.allowed) return admission;
    const budget = this.budgets.get(demand.kind)!;
    this.budgets.set(demand.kind, { ...budget, used: budget.used + demand.units });
    return admission;
  }

  setForecast(kind: BudgetKind, forecastUsed: number): void {
    const budget = this.budgets.get(kind);
    if (budget === undefined) throw new Error(`resource budget ${kind} is unbound`);
    if (!Number.isFinite(forecastUsed) || forecastUsed < 0)
      throw new Error('forecast must be nonnegative');
    this.budgets.set(kind, { ...budget, forecastUsed });
  }

  /** The BYOK namespace cannot be read as a provider quota balance. */
  byokModelBudget(): ResourceBudget | undefined {
    return this.budgets.get(ResourceBudgetKind.MODEL_TOKENS_BYOK);
  }
}

export const RESOURCE_BUDGET_KINDS: readonly BudgetKind[] = Object.values(ResourceBudgetKind);

export { ResourceBudgetLedger as ResourceBudgets };
