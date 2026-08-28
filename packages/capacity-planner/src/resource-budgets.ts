/** Six isolated resource ceilings, including a disjoint BYOK namespace. */
import {
  ResourceBudgetKind,
  type ResourceBudgetKind as ResourceBudgetKindType,
} from '@foresift/domain';
import { ResourceBudgetSchema, type ResourceBudget } from '@foresift/shared-schemas';

export type CapacityWorkload =
  | 'LOW_PRIORITY_ENRICHMENT'
  | 'RETENTION'
  | 'NORMAL'
  | 'FROZEN_EVIDENCE'
  | 'CRITICAL_RISK_MONITORING';

export interface ManagedResourceBudget extends ResourceBudget {
  readonly protectedFloor?: number;
  readonly dependentWorkloads?: readonly CapacityWorkload[];
}

export interface ResourceAdmission {
  readonly allowed: boolean;
  readonly kind: ResourceBudgetKindType;
  readonly reason: string;
  readonly degradeBehavior: string;
}

export class ResourceBudgetManager {
  private readonly system = new Map<ResourceBudgetKindType, ManagedResourceBudget>();
  private readonly byok = new Map<ResourceBudgetKindType, ManagedResourceBudget>();

  constructor(budgets: readonly ManagedResourceBudget[]) {
    for (const candidate of budgets) {
      const { protectedFloor, dependentWorkloads, ...schemaFields } = candidate;
      const budget = {
        ...ResourceBudgetSchema.parse(schemaFields),
        ...(protectedFloor === undefined ? {} : { protectedFloor }),
        ...(dependentWorkloads === undefined
          ? {}
          : { dependentWorkloads: [...dependentWorkloads] }),
      };
      const target = budget.kind === ResourceBudgetKind.MODEL_TOKENS_BYOK ? this.byok : this.system;
      if (target.has(budget.kind)) throw new Error(`duplicate resource budget ${budget.kind}`);
      if ((budget.protectedFloor ?? 0) < 0 || (budget.protectedFloor ?? 0) > budget.capLimit) {
        throw new Error(`invalid protected floor for ${budget.kind}`);
      }
      target.set(budget.kind, budget);
    }
  }

  get(kind: ResourceBudgetKindType): ManagedResourceBudget | undefined {
    return (kind === ResourceBudgetKind.MODEL_TOKENS_BYOK ? this.byok : this.system).get(kind);
  }

  admit(
    kind: ResourceBudgetKindType,
    units: number,
    workload: CapacityWorkload = 'NORMAL',
  ): ResourceAdmission {
    const budget = this.get(kind);
    if (budget === undefined) {
      return {
        allowed: false,
        kind,
        reason: `RESOURCE_BUDGET_UNBOUND:${kind}`,
        degradeBehavior: 'QUOTA_EXHAUSTED',
      };
    }
    if (!Number.isFinite(units) || units < 0) {
      return {
        allowed: false,
        kind,
        reason: `RESOURCE_BUDGET_INVALID_UNITS:${kind}`,
        degradeBehavior: budget.degradeBehavior,
      };
    }
    const critical = workload === 'CRITICAL_RISK_MONITORING' || workload === 'FROZEN_EVIDENCE';
    const limit = critical ? budget.capLimit : budget.capLimit - (budget.protectedFloor ?? 0);
    const dependent =
      budget.dependentWorkloads === undefined || budget.dependentWorkloads.includes(workload);
    const allowed = !dependent || budget.used + units <= limit;
    return {
      allowed,
      kind,
      reason: allowed ? 'RESOURCE_ADMITTED' : `RESOURCE_BUDGET_EXHAUSTED:${kind}`,
      degradeBehavior: allowed ? 'NONE' : budget.degradeBehavior,
    };
  }

  consume(
    kind: ResourceBudgetKindType,
    units: number,
    workload: CapacityWorkload = 'NORMAL',
  ): ResourceAdmission {
    const decision = this.admit(kind, units, workload);
    if (!decision.allowed) return decision;
    const target = kind === ResourceBudgetKind.MODEL_TOKENS_BYOK ? this.byok : this.system;
    const current = target.get(kind)!;
    target.set(kind, { ...current, used: current.used + units });
    return decision;
  }

  snapshot(): readonly ManagedResourceBudget[] {
    return [...this.system.values(), ...this.byok.values()]
      .map((budget) => ({ ...budget }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }
}

export const ALL_INDEPENDENT_RESOURCE_BUDGETS = Object.freeze(Object.values(ResourceBudgetKind));

export { ResourceBudgetManager as ResourceBudgets };

export class ResourceBudgetTracker {
  private readonly caps = new Map<string, number>();
  private readonly used = new Map<string, number>();
  setBudget(dimension: string, cap: number): void {
    if (!Number.isFinite(cap) || cap < 0) throw new RangeError('budget cap must be nonnegative');
    this.caps.set(dimension, cap);
    this.used.set(dimension, 0);
  }
  recordUsage(dimension: string, amount: number): void {
    if (!this.caps.has(dimension)) throw new Error(`RESOURCE_BUDGET_UNBOUND:${dimension}`);
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('usage must be nonnegative');
    this.used.set(dimension, (this.used.get(dimension) ?? 0) + amount);
  }
  getRemaining(dimension: string): number {
    return Math.max(0, (this.caps.get(dimension) ?? 0) - (this.used.get(dimension) ?? 0));
  }
  isExhausted(dimension: string): boolean {
    return this.caps.has(dimension) && this.getRemaining(dimension) === 0;
  }
}

export function evaluateWorkloadAdmission(
  workloadClass: string,
  _dimension: string,
  isExhausted: boolean,
): { readonly allowed: boolean; readonly action: string } {
  if (workloadClass === 'RISK_MONITORING' || workloadClass === 'ALERT_VERIFICATION')
    return { allowed: true, action: 'PRESERVE_CRITICAL' };
  return isExhausted
    ? { allowed: false, action: 'SKIP_LOW_PRIORITY' }
    : { allowed: true, action: 'NONE' };
}

export const isByokModelNamespace = (dimension: string): boolean =>
  dimension === ResourceBudgetKind.MODEL_TOKENS_BYOK;

export function attemptReclaimStorage(input: {
  readonly targetType: string;
  readonly isFrozenEvidence: boolean;
}): { readonly allowed: boolean; readonly error?: string } {
  return input.isFrozenEvidence
    ? { allowed: false, error: 'FROZEN_EVIDENCE_IMMUTABLE: CANNOT_PURGE_EVIDENCE' }
    : { allowed: true };
}

export class ResourceBudgetEngine {
  private readonly exhausted = new Set<string>();
  exhaustDimension(dimension: string): void {
    this.exhausted.add(dimension);
  }
  canExecute(workload: string): boolean {
    if (workload === 'RISK_MONITORING' || workload === 'ALERT_VERIFICATION') return true;
    return this.exhausted.size === 0;
  }
  canEvictFrozenEvidence(): false {
    return false;
  }
}
