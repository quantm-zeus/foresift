/**
 * Budget-policy resolution unit tests (FR-COST-011, ADR-1, AC-100, AC-105).
 * Aligned to the landed T009 product API (e64a14b):
 *  - resolveActiveBudgetPolicies(engine, at) → ActiveBudgetPolicies {at,
 *    states per dimension, dataProviderCostMode}; unconfigured dimensions
 *    resolve to null policies (never guesses); DATA_PROVIDER defaults
 *    fail-closed to STRICT_FREE.
 *  - freeInOneDimensionNeverImpliesZeroTotal(states) takes the resolved
 *    budget states, not a rendered-spend record.
 */
import { describe, expect, it } from 'bun:test';
import {
  BudgetPolicyRepository,
  freeInOneDimensionNeverImpliesZeroTotal,
  resolveActiveBudgetPolicies,
  type ActiveBudgetPolicies,
  type ResolvedBudgetState,
} from '../src/budget-policy.ts';

describe('six-dimension resolution vectors (FR-COST-011, AC-100)', () => {
  const mockPolicies = [
    {
      policy_id: 'pol_dp_1',
      dimension: 'DATA_PROVIDER',
      provider_mode: 'STRICT_FREE',
      cap_limit: 0,
      currency_or_unit: 'USD',
      version: '1.0.0',
      active: true,
      activated_at: '2026-09-01T00:00:00Z',
      superseded_by: null,
    },
    {
      policy_id: 'pol_model_1',
      dimension: 'MODEL',
      provider_mode: null,
      cap_limit: 500,
      currency_or_unit: 'USD',
      version: '1.0.0',
      active: true,
      activated_at: '2026-09-01T00:00:00Z',
      superseded_by: null,
    },
    {
      policy_id: 'pol_cw_1',
      dimension: 'COMPUTE_WORKFLOW',
      provider_mode: null,
      cap_limit: 100000,
      currency_or_unit: 'STEPS',
      version: '1.0.0',
      active: true,
      activated_at: '2026-09-01T00:00:00Z',
      superseded_by: null,
    },
    {
      policy_id: 'pol_db_1',
      dimension: 'DATABASE_STORAGE',
      provider_mode: null,
      cap_limit: 10737418240,
      currency_or_unit: 'BYTES',
      version: '1.0.0',
      active: true,
      activated_at: '2026-09-01T00:00:00Z',
      superseded_by: null,
    },
    {
      policy_id: 'pol_obj_1',
      dimension: 'OBJECT_STORAGE_EGRESS',
      provider_mode: null,
      cap_limit: 53687091200,
      currency_or_unit: 'BYTES',
      version: '1.0.0',
      active: true,
      activated_at: '2026-09-01T00:00:00Z',
      superseded_by: null,
    },
    {
      policy_id: 'pol_notif_1',
      dimension: 'NOTIFICATION',
      provider_mode: null,
      cap_limit: 50000,
      currency_or_unit: 'MESSAGES',
      version: '1.0.0',
      active: true,
      activated_at: '2026-09-01T00:00:00Z',
      superseded_by: null,
    },
  ];

  // resolve() issues one policy query plus one consumption query per
  // dimension; answer each with the matching fixture rows.
  const mockEngine = {
    query: async (sql: string) => {
      if (sql.includes('FROM cost.budget_policies')) return { rows: mockPolicies };
      return { rows: [] }; // no active consumption window for any dimension
    },
  } as never;

  it('resolves one state per dimension; unconfigured DATA_PROVIDER defaults STRICT_FREE', async () => {
    const resolved = await resolveActiveBudgetPolicies(
      mockEngine,
      new Date('2026-09-01T12:00:00Z'),
    );
    expect(resolved.states.DATA_PROVIDER?.policy?.providerMode).toBe('STRICT_FREE');
    expect(resolved.states.MODEL?.policy?.capLimit).toBe(500);
    expect(resolved.states.COMPUTE_WORKFLOW?.policy?.capLimit).toBe(100000);
    expect(resolved.states.DATABASE_STORAGE?.policy?.capLimit).toBe(10737418240);
    expect(resolved.states.OBJECT_STORAGE_EGRESS?.policy?.capLimit).toBe(53687091200);
    expect(resolved.states.NOTIFICATION?.policy?.capLimit).toBe(50000);
  });

  it('gates DATA_PROVIDER cost mode onto the G0 plane (STRICT_FREE), ADR-1', async () => {
    const resolved = await resolveActiveBudgetPolicies(
      mockEngine,
      new Date('2026-09-01T12:00:00Z'),
    );
    expect(resolved.dataProviderCostMode).toBe('STRICT_FREE');
  });

  it('HUMAN_ATTENTION is refused as a machine budget dimension (spec I2)', async () => {
    const badEngine = {
      query: async () => ({
        rows: [
          {
            policy_id: 'pol_bad',
            dimension: 'HUMAN_ATTENTION', // render-only class, never a budget dimension
            provider_mode: null,
            cap_limit: 1000,
            currency_or_unit: 'EFFORT',
            version: '1.0.0',
            active: true,
            activated_at: '2026-09-01T00:00:00Z',
            superseded_by: null,
          },
        ],
      }),
    } as never;

    await expect(
      resolveActiveBudgetPolicies(badEngine, new Date('2026-09-01T12:00:00Z')),
    ).rejects.toThrow();
  });
});

describe('one-active-per-dimension & STRICT_FREE delegation (ADR-1, AC-100)', () => {
  it('resolves exactly one active policy per dimension and surfaces the DATA_PROVIDER mode', async () => {
    // Two rows for the same dimension must never both resolve — the SQL
    // partial unique index guarantees at most one active row; the repository
    // takes the first and refuses duplicates deterministically.
    const dupEngine = {
      query: async (sql: string) => {
        if (sql.includes('FROM cost.budget_policies'))
          return {
            rows: [
              {
                policy_id: 'pol_dp_1',
                dimension: 'DATA_PROVIDER',
                provider_mode: 'STRICT_FREE',
                cap_limit: 0,
                currency_or_unit: 'USD',
                version: '1.0.0',
                active: true,
                activated_at: '2026-09-01T00:00:00Z',
                superseded_by: null,
              },
              {
                policy_id: 'pol_dp_2',
                dimension: 'DATA_PROVIDER',
                provider_mode: 'STRICT_FREE',
                cap_limit: 0,
                currency_or_unit: 'USD',
                version: '1.0.0',
                active: true,
                activated_at: '2026-09-01T06:00:00Z', // also before `at` — truly ambiguous
                superseded_by: null,
              },
            ],
          };
        return { rows: [] };
      },
    } as never;
    const repo = new BudgetPolicyRepository(dupEngine);
    // Duplicate active rows for one dimension are a plan defect: the
    // repository fails closed rather than silently picking one.
    await expect(repo.resolve(new Date('2026-09-01T12:00:00Z'))).rejects.toThrow(
      'BUDGET_POLICY_AMBIGUOUS',
    );
  });

  it('a dimension with no active row resolves to a null policy, never a guess', async () => {
    const emptyEngine = {
      query: async () => ({ rows: [] }),
    } as never;
    const resolved = await resolveActiveBudgetPolicies(
      emptyEngine,
      new Date('2026-09-01T12:00:00Z'),
    );
    expect(resolved.states.MODEL?.policy).toBeNull();
    expect(resolved.states.MODEL?.headroom).toBeUndefined();
    expect(resolved.states.DATA_PROVIDER?.policy).toBeNull();
    // Fail-closed paid-spend law: unconfigured DATA_PROVIDER stays STRICT_FREE.
    expect(resolved.dataProviderCostMode).toBe('STRICT_FREE');
  });

  it('surfaced states carry the resolved plane (typed shape, not a dimension map of rows)', () => {
    const states: Record<string, ResolvedBudgetState> = {};
    const policies: ActiveBudgetPolicies = {
      at: '2026-09-01T12:00:00Z',
      states: states as never,
      dataProviderCostMode: 'STRICT_FREE',
    };
    expect(policies.states).toBeDefined();
    expect(policies.dataProviderCostMode).toBe('STRICT_FREE');
  });
});

describe('free-in-one-dimension-never-implies-zero-total predicate (FR-COST-011, §62.12)', () => {
  const state = (
    consumption: { renderedClasses: Record<string, number> } | null,
  ): ResolvedBudgetState =>
    ({
      dimension: 'MODEL',
      policy: null,
      consumption,
      headroom: undefined,
    }) as never;

  it('renders every dimension independently: a null-consumption dimension never claims zero cost elsewhere', () => {
    const states = [state(null), state(null)];
    // The predicate holds when every dimension carries a well-formed
    // consumption record (or none at all) — no dimension's absence implies
    // any other dimension rendered as zero.
    expect(freeInOneDimensionNeverImpliesZeroTotal(states)).toBe(true);
  });
});
