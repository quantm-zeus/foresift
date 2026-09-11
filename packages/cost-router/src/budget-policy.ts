/**
 * Per-dimension budget-policy resolution (PRD §62.2, §62.12; FR-COST-011,
 * AC-100, AC-105, plan ADR-1).
 *
 * Budget policy is split into six independent dimensions. The DATA_PROVIDER
 * dimension carries the §62.2 provider mode (STRICT_FREE | FREE_FIRST |
 * PAID_ALLOWED) and gates ONLY the DATA_PROVIDER dimension: the mode is
 * delegated to the proven G0 strict-free-guard / CostModePolicy seam — this
 * module never re-implements a guard. "Free" in one dimension cannot imply
 * zero total cost: every resolved budget state renders the independent
 * dimension and its consumption actuals, never a single scalar (§62.12).
 * Unknown dimensions/modes fail closed with the domain vocabularies.
 */
import {
  ALL_BUDGET_DIMENSIONS,
  ALL_PROVIDER_MODES,
  BudgetDimension,
  ProviderMode,
  budgetDimension,
  providerMode,
  type BudgetDimension as BudgetDimensionType,
} from '@foresift/domain';
import {
  BudgetPolicySchema,
  BudgetConsumptionTotalsSchema,
  RenderedSpendClassesSchema,
  type BudgetPolicy,
  type BudgetConsumptionTotals,
} from '@foresift/shared-schemas';
import type { DatabaseEngine } from '@foresift/persistence';
import { CostMode } from '@foresift/domain';

interface BudgetPolicyRow {
  policy_id: string;
  dimension: string;
  provider_mode: string | null;
  cap_limit: string | number;
  currency_or_unit: string;
  version: string;
  active: boolean;
  activated_at: string | Date | null;
  superseded_by: string | null;
}

interface ConsumptionRow {
  dimension: string;
  period_window_start: string | Date;
  period_reset_at: string | Date;
  cap_limit: string | number;
  consumed: string | number;
  rendered_classes: string;
}

const iso = (value: string | Date): string => (value instanceof Date ? value.toISOString() : value);

/**
 * The §62.12 free-in-one-dimension-never-implies-zero-total predicate, as a
 * named law: a dimension whose provider mode is STRICT_FREE (or whose cap is
 * unmet) contributes no claim about ANY other dimension's cost. Compositions
 * that assert "free data ⇒ zero total" are refused in `composeCostTotals`
 * (composition.ts); this predicate is the positive statement the renderer
 * relies on — every dimension renders independently, always.
 */
export function freeInOneDimensionNeverImpliesZeroTotal(
  states: readonly ResolvedBudgetState[],
): boolean {
  return states.every(
    (state) =>
      RenderedSpendClassesSchema.safeParse(state.consumption?.renderedClasses).success ||
      state.consumption === null,
  );
}

/** One resolved budget dimension: its active policy row and consumption actuals. */
export interface ResolvedBudgetState {
  readonly dimension: BudgetDimensionType;
  readonly policy: BudgetPolicy | null;
  readonly consumption: BudgetConsumptionTotals | null;
  /**
   * Remaining headroom in the dimension's own currency_or_unit. A dimension
   * with no policy row has unconfigured (undefined) headroom — not infinite
   * headroom and not zero cost (§62.12: absence of a budget row never
   * renders any other dimension as free).
   */
  readonly headroom: number | undefined;
  /**
   * Whether the dimension's consumption is at or beyond its cap. Unconfigured
   * dimensions are never reported exhausted.
   */
  readonly exhausted: boolean;
}

export interface ActiveBudgetPolicies {
  readonly at: string;
  readonly states: Readonly<Record<BudgetDimensionType, ResolvedBudgetState>>;
  /**
   * The DATA_PROVIDER dimension's §62.2 mode, mapped onto the G0 two-value
   * CostMode plane for the strict-free-guard seam (plan ADR-1): STRICT_FREE
   * and FREE_FIRST map to G0 STRICT_FREE semantics admission-wise (free-first
   * still refuses paid calls while free quota remains), PAID_ALLOWED maps to
   * PAID_ENABLED. Unconfigured DATA_PROVIDER defaults to the proven G0
   * DEFAULT_COST_MODE (STRICT_FREE) — fail-closed for paid spend.
   */
  readonly dataProviderCostMode: CostMode;
}

const rowPolicy = (row: BudgetPolicyRow): BudgetPolicy =>
  BudgetPolicySchema.parse({
    policyId: row.policy_id,
    dimension: budgetDimension(row.dimension),
    providerMode: row.provider_mode === null ? null : providerMode(row.provider_mode),
    capLimit: Number(row.cap_limit),
    currencyOrUnit: row.currency_or_unit,
    version: row.version,
    active: row.active,
    activatedAt: row.activated_at === null ? null : iso(row.activated_at),
    supersededBy: row.superseded_by,
  });

const rowConsumption = (row: ConsumptionRow): BudgetConsumptionTotals =>
  BudgetConsumptionTotalsSchema.parse({
    dimension: budgetDimension(row.dimension),
    periodWindowStart: iso(row.period_window_start),
    periodResetAt: iso(row.period_reset_at),
    capLimit: Number(row.cap_limit),
    consumed: Number(row.consumed),
    renderedClasses: RenderedSpendClassesSchema.parse(JSON.parse(row.rendered_classes)),
  });

/** The active window holding the latest consumption actuals per dimension at `at`. */
const ACTIVE_CONSUMPTION_SQL = `
  SELECT DISTINCT ON (dimension)
         dimension, period_window_start, period_reset_at, cap_limit, consumed, rendered_classes
    FROM cost.budget_consumption_totals
   WHERE dimension = $1 AND period_window_start <= $2 AND period_reset_at > $2
   ORDER BY dimension, period_window_start DESC`;

export class BudgetPolicyRepository {
  constructor(private readonly engine: DatabaseEngine) {}

  /**
   * Resolve the active budget-policy plane at `at`: one active row per
   * dimension (SQL partial unique index guarantees at most one; a dimension
   * with no active row resolves to a null policy, never to a guess) plus the
   * current consumption window per dimension.
   */
  async resolve(at: Date = new Date()): Promise<ActiveBudgetPolicies> {
    const atIso = at.toISOString();
    const policyRows = await this.engine.query<BudgetPolicyRow>(
      `SELECT policy_id, dimension, provider_mode, cap_limit, currency_or_unit,
              version, active, activated_at, superseded_by
         FROM cost.budget_policies
        WHERE active = TRUE AND activated_at <= $1`,
      [atIso],
    );
    const policies = new Map<BudgetDimensionType, BudgetPolicy>();
    for (const row of policyRows.rows) {
      const policy = rowPolicy(row);
      if (policy.activatedAt !== null && Date.parse(policy.activatedAt) > Date.parse(atIso)) {
        continue;
      }
      const existing = policies.get(policy.dimension);
      // SQL law (budget_policies_one_active_idx) already admits at most one
      // active row per dimension; a second row here means the index was
      // dropped or bypassed — fail closed rather than pick silently.
      if (existing !== undefined) {
        throw new Error(
          `BUDGET_POLICY_AMBIGUOUS: multiple active policies for dimension ${policy.dimension}`,
        );
      }
      policies.set(policy.dimension, policy);
    }

    const states = {} as Record<BudgetDimensionType, ResolvedBudgetState>;
    for (const dimension of ALL_BUDGET_DIMENSIONS) {
      const policy = policies.get(dimension) ?? null;
      const consumptionRows = await this.engine.query<ConsumptionRow>(ACTIVE_CONSUMPTION_SQL, [
        dimension,
        atIso,
      ]);
      const consumption =
        consumptionRows.rows[0] === undefined ? null : rowConsumption(consumptionRows.rows[0]);
      states[dimension] = {
        dimension,
        policy,
        consumption,
        headroom:
          policy === null ? undefined : Math.max(0, policy.capLimit - (consumption?.consumed ?? 0)),
        exhausted:
          policy !== null && consumption !== null && consumption.consumed >= policy.capLimit,
      };
    }

    const dataProviderMode = states.DATA_PROVIDER.policy?.providerMode ?? null;
    return {
      at: atIso,
      states,
      dataProviderCostMode:
        dataProviderMode === ProviderMode.PAID_ALLOWED
          ? CostMode.PAID_ENABLED
          : CostMode.STRICT_FREE,
    };
  }
}

export function resolveActiveBudgetPolicies(
  engine: DatabaseEngine,
  at: Date = new Date(),
): Promise<ActiveBudgetPolicies> {
  return new BudgetPolicyRepository(engine).resolve(at);
}

/** Type-level guard: the three §62.2 modes, fail-closed against unknown strings. */
export function isProviderMode(value: string): value is ProviderMode {
  return (ALL_PROVIDER_MODES as readonly string[]).includes(value);
}

/** Type-level guard: the six FR-COST-011 dimensions, fail-closed against unknown strings. */
export function isBudgetDimension(value: string): value is BudgetDimension {
  return (ALL_BUDGET_DIMENSIONS as readonly string[]).includes(value);
}

export { budgetDimension as parseBudgetDimension, providerMode as parseProviderMode };
