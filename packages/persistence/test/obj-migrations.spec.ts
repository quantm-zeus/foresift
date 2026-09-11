/**
 * PGlite migration tests for objective governance schema (T018, FR-OBJ-001, FR-OBJ-002, FR-OBJ-004, FR-OBJ-006, FR-OBJ-007).
 *
 * Tests the three G1 objective migrations:
 * - g1_obj_0001_objective_runs.sql: frozen runs, comparability dimensions, window ordering, immutability & new-run corrections
 * - g1_obj_0002_utility_ledger.sql: capital-day utility, 12-line integer micro reconciliation CHECK, foreign keys, immutability
 * - g1_obj_0003_integrity_claims.sql: append-only integrity incidents, claim scopes (ESS <= sample size), promotion decisions, output screens
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const VALID_HASH_1 = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_HASH_2 = 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const MANDATORY_DISCLOSURE =
  'Opportunity outputs are evidence-backed research signals whose realized outcome remains uncertain.';

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('g1_obj_0001_objective_runs: frozen runs and immutability (FR-OBJ-001, FR-OBJ-002)', () => {
  it('inserts valid COMPARABLE and EXPLORATORY_ONLY objective runs', async () => {
    // COMPARABLE run (exploratory_reason must be NULL)
    await engine.query(
      `INSERT INTO objective_runs (
        run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
        population_claim_id, capital_micros, window_start, window_end,
        execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
        data_cutoff, correlated_exposure_constraints, comparability, exploratory_reason,
        schema_registry_version
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17
      )`,
      [
        'run-test-comp-001',
        VALID_HASH_1,
        'univ-solana-top50',
        VALID_HASH_2,
        'pop-dex-swaps',
        10_000_000_000n,
        '2026-01-01T00:00:00Z',
        '2026-01-31T00:00:00Z',
        'scen-p50-slippage',
        '1.0.0',
        'delay-emp-100ms',
        '1.0.0',
        '2026-01-01T00:00:00Z',
        ['max_sector_20', 'max_single_token_10'],
        'COMPARABLE',
        null,
        1,
      ],
    );

    // EXPLORATORY_ONLY run (exploratory_reason must be NOT NULL)
    await engine.query(
      `INSERT INTO objective_runs (
        run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
        population_claim_id, capital_micros, window_start, window_end,
        execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
        data_cutoff, correlated_exposure_constraints, comparability, exploratory_reason,
        schema_registry_version
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17
      )`,
      [
        'run-test-expl-002',
        VALID_HASH_1,
        'univ-solana-top50',
        VALID_HASH_2,
        'pop-dex-swaps',
        10_000_000_000n,
        '2026-01-01T00:00:00Z',
        '2026-01-31T00:00:00Z',
        'scen-p50-slippage',
        '1.0.0',
        'delay-emp-100ms',
        '1.0.0',
        '2026-01-01T00:00:00Z',
        [],
        'EXPLORATORY_ONLY',
        'Non-standard execution scenario for exploratory research',
        1,
      ],
    );

    const rows = await engine.query<{ run_id: string; comparability: string }>(
      `SELECT run_id, comparability FROM objective_runs WHERE run_id IN ($1, $2) ORDER BY run_id`,
      ['run-test-comp-001', 'run-test-expl-002'],
    );
    expect(rows.rows.length).toBe(2);
    expect(rows.rows[0]?.comparability).toBe('COMPARABLE');
    expect(rows.rows[1]?.comparability).toBe('EXPLORATORY_ONLY');
  });

  it('enforces exploratory_reason consistency with comparability CHECK', async () => {
    // COMPARABLE with non-null reason -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO objective_runs (
          run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
          population_claim_id, capital_micros, window_start, window_end,
          execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
          data_cutoff, comparability, exploratory_reason, schema_registry_version
        ) VALUES (
          'run-invalid-comp-reason', $1, 'univ', $2,
          'pop', 1000000, '2026-01-01Z', '2026-01-02Z',
          'scen', '1', 'delay', '1',
          '2026-01-01Z', 'COMPARABLE', 'should not have reason', 1
        )`,
        [VALID_HASH_1, VALID_HASH_2],
      ),
    ).rejects.toThrow();

    // EXPLORATORY_ONLY with null reason -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO objective_runs (
          run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
          population_claim_id, capital_micros, window_start, window_end,
          execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
          data_cutoff, comparability, exploratory_reason, schema_registry_version
        ) VALUES (
          'run-invalid-expl-null', $1, 'univ', $2,
          'pop', 1000000, '2026-01-01Z', '2026-01-02Z',
          'scen', '1', 'delay', '1',
          '2026-01-01Z', 'EXPLORATORY_ONLY', NULL, 1
        )`,
        [VALID_HASH_1, VALID_HASH_2],
      ),
    ).rejects.toThrow();
  });

  it('enforces window ordering CHECK (window_end > window_start)', async () => {
    expect(
      engine.query(
        `INSERT INTO objective_runs (
          run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
          population_claim_id, capital_micros, window_start, window_end,
          execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
          data_cutoff, comparability, exploratory_reason, schema_registry_version
        ) VALUES (
          'run-bad-window', $1, 'univ', $2,
          'pop', 1000000, '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z',
          'scen', '1', 'delay', '1',
          '2026-01-01Z', 'COMPARABLE', NULL, 1
        )`,
        [VALID_HASH_1, VALID_HASH_2],
      ),
    ).rejects.toThrow();
  });

  it('enforces hash format, capital > 0, and schema_registry_version = 1 CHECKs', async () => {
    // Bad hash format
    expect(
      engine.query(
        `INSERT INTO objective_runs (
          run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
          population_claim_id, capital_micros, window_start, window_end,
          execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
          data_cutoff, comparability, exploratory_reason, schema_registry_version
        ) VALUES (
          'run-bad-hash', 'not-a-sha256', 'univ', $1,
          'pop', 1000000, '2026-01-01Z', '2026-01-02Z',
          'scen', '1', 'delay', '1',
          '2026-01-01Z', 'COMPARABLE', NULL, 1
        )`,
        [VALID_HASH_2],
      ),
    ).rejects.toThrow();

    // Capital <= 0
    expect(
      engine.query(
        `INSERT INTO objective_runs (
          run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
          population_claim_id, capital_micros, window_start, window_end,
          execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
          data_cutoff, comparability, exploratory_reason, schema_registry_version
        ) VALUES (
          'run-bad-capital', $1, 'univ', $2,
          'pop', 0, '2026-01-01Z', '2026-01-02Z',
          'scen', '1', 'delay', '1',
          '2026-01-01Z', 'COMPARABLE', NULL, 1
        )`,
        [VALID_HASH_1, VALID_HASH_2],
      ),
    ).rejects.toThrow();

    // Schema registry version != 1
    expect(
      engine.query(
        `INSERT INTO objective_runs (
          run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
          population_claim_id, capital_micros, window_start, window_end,
          execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
          data_cutoff, comparability, exploratory_reason, schema_registry_version
        ) VALUES (
          'run-bad-schema-ver', $1, 'univ', $2,
          'pop', 1000000, '2026-01-01Z', '2026-01-02Z',
          'scen', '1', 'delay', '1',
          '2026-01-01Z', 'COMPARABLE', NULL, 2
        )`,
        [VALID_HASH_1, VALID_HASH_2],
      ),
    ).rejects.toThrow();
  });

  it('guarantees run immutability (UPDATE and DELETE refuse via trigger, corrections are new runs)', async () => {
    // UPDATE must fail with immutable trigger exception
    expect(
      engine.query(
        `UPDATE objective_runs SET capital_micros = $1 WHERE run_id = 'run-test-comp-001'`,
        [20_000_000_000n],
      ),
    ).rejects.toThrow(/frozen objective records are immutable/);

    // DELETE must fail with immutable trigger exception
    expect(
      engine.query(`DELETE FROM objective_runs WHERE run_id = 'run-test-comp-001'`),
    ).rejects.toThrow(/frozen objective records are immutable/);

    // TRUNCATE must fail
    expect(engine.query(`TRUNCATE TABLE objective_runs CASCADE`)).rejects.toThrow();

    // New-run corrections pattern: insert a new run record instead of mutating
    await engine.query(
      `INSERT INTO objective_runs (
        run_id, config_content_hash, candidate_universe_id, candidate_universe_hash,
        population_claim_id, capital_micros, window_start, window_end,
        execution_scenario_id, execution_scenario_version, delay_policy_id, delay_policy_version,
        data_cutoff, comparability, exploratory_reason, schema_registry_version
      ) VALUES (
        'run-test-comp-001-corr1', $1, 'univ-solana-top50', $2,
        'pop-dex-swaps', $3, '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z',
        'scen-p50-slippage', '1.0.0', 'delay-emp-100ms', '1.0.0',
        '2026-01-01T00:00:00Z', 'COMPARABLE', NULL, 1
      )`,
      [VALID_HASH_1, VALID_HASH_2, 20_000_000_000n],
    );

    const original = await engine.query<{ capital_micros: string }>(
      `SELECT capital_micros FROM objective_runs WHERE run_id = 'run-test-comp-001'`,
    );
    expect(BigInt(original.rows[0]?.capital_micros ?? '0')).toBe(10_000_000_000n);
  });
});

describe('g1_obj_0002_utility_ledger: 12-line reconciliation and FKs (FR-OBJ-001, FR-OBJ-004)', () => {
  it('inserts valid capital_day_utility when twelve lines reconcile to daily_net_micros', async () => {
    // 500,000 - 50,000 - 10,000 - 20,000 - 15,000 + 5,000 - 8,000 - 4,000 - 3,000 - 2,000 - 1,000 - 2,000 = 390,000
    await engine.query(
      `INSERT INTO capital_day_utility (
        run_id, capital_day, gross_return_micros, execution_costs_micros,
        failed_partial_fills_micros, drawdown_micros, cvar_micros, capital_utilization_micros,
        turnover_micros, opportunity_cost_micros, concentration_micros,
        shared_liquidity_impact_micros, provider_model_infra_cost_micros, uncertainty_micros,
        daily_net_micros, consumed_ess_reference, lower_bound_utility_micros, schema_registry_version
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17, $18
      )`,
      [
        'run-test-comp-001',
        '2026-01-01',
        500_000n,
        -50_000n,
        -10_000n,
        -20_000n,
        -15_000n,
        5_000n,
        -8_000n,
        -4_000n,
        -3_000n,
        -2_000n,
        -1_000n,
        -2_000n,
        390_000n, // exactly matches sum
        'ess-ref-day-001',
        350_000n,
        1,
      ],
    );

    const rows = await engine.query<{ daily_net_micros: string }>(
      `SELECT daily_net_micros FROM capital_day_utility WHERE run_id = $1 AND capital_day = $2`,
      ['run-test-comp-001', '2026-01-01'],
    );
    expect(rows.rows.length).toBe(1);
    expect(BigInt(rows.rows[0]?.daily_net_micros ?? '0')).toBe(390_000n);
  });

  it('refuses insertion when 12 lines do not reconcile to daily_net_micros', async () => {
    // daily_net_micros is 999,999 which does NOT equal the line sum (390,000)
    expect(
      engine.query(
        `INSERT INTO capital_day_utility (
          run_id, capital_day, gross_return_micros, execution_costs_micros,
          failed_partial_fills_micros, drawdown_micros, cvar_micros, capital_utilization_micros,
          turnover_micros, opportunity_cost_micros, concentration_micros,
          shared_liquidity_impact_micros, provider_model_infra_cost_micros, uncertainty_micros,
          daily_net_micros, consumed_ess_reference, lower_bound_utility_micros, schema_registry_version
        ) VALUES (
          $1, '2026-01-02', 500000, -50000,
          -10000, -20000, -15000, 5000,
          -8000, -4000, -3000,
          -2000, -1000, -2000,
          999999, 'ess-ref-day-002', 350000, 1
        )`,
        ['run-test-comp-001'],
      ),
    ).rejects.toThrow();
  });

  it('enforces foreign key to objective_runs', async () => {
    expect(
      engine.query(
        `INSERT INTO capital_day_utility (
          run_id, capital_day, gross_return_micros, execution_costs_micros,
          failed_partial_fills_micros, drawdown_micros, cvar_micros, capital_utilization_micros,
          turnover_micros, opportunity_cost_micros, concentration_micros,
          shared_liquidity_impact_micros, provider_model_infra_cost_micros, uncertainty_micros,
          daily_net_micros, consumed_ess_reference, lower_bound_utility_micros, schema_registry_version
        ) VALUES (
          'non-existent-run', '2026-01-01', 0, 0,
          0, 0, 0, 0,
          0, 0, 0,
          0, 0, 0,
          0, 'ess-ref', 0, 1
        )`,
      ),
    ).rejects.toThrow();
  });

  it('guarantees capital_day_utility immutability (UPDATE and DELETE refuse)', async () => {
    expect(
      engine.query(
        `UPDATE capital_day_utility SET daily_net_micros = 400000 WHERE run_id = 'run-test-comp-001'`,
      ),
    ).rejects.toThrow(/frozen objective records are immutable/);

    expect(
      engine.query(
        `DELETE FROM capital_day_utility WHERE run_id = 'run-test-comp-001' AND capital_day = '2026-01-01'`,
      ),
    ).rejects.toThrow(/frozen objective records are immutable/);
  });
});

describe('g1_obj_0003_integrity_claims: integrity, claims, promotion, screens (FR-OBJ-006, FR-OBJ-007, FR-OBJ-010)', () => {
  it('inserts PASS and FAIL_BLOCKS_PROMOTION integrity incidents and enforces verdict_reason CHECK', async () => {
    // Valid PASS incident (reason is NULL)
    await engine.query(
      `INSERT INTO integrity_incidents (
        incident_id, run_id, signal, verdict, reason, evidence_refs, recorded_at
      ) VALUES (
        'inc-001', 'run-test-comp-001', 'DENOMINATOR_GAMING', 'PASS', NULL, '{}', now()
      )`,
    );

    // Valid FAIL_BLOCKS_PROMOTION incident (reason NOT NULL and cardinality(evidence_refs) > 0)
    await engine.query(
      `INSERT INTO integrity_incidents (
        incident_id, run_id, signal, verdict, reason, evidence_refs, recorded_at
      ) VALUES (
        'inc-002', 'run-test-comp-001', 'SELECTIVE_UNIVERSE_CHANGE', 'FAIL_BLOCKS_PROMOTION',
        'Universe filters retroactively modified', ARRAY['ref-log-123'], now()
      )`,
    );

    // FAIL_BLOCKS_PROMOTION with NULL reason -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO integrity_incidents (
          incident_id, run_id, signal, verdict, reason, evidence_refs, recorded_at
        ) VALUES (
          'inc-bad-1', 'run-test-comp-001', 'REDUCED_EXPLORATION', 'FAIL_BLOCKS_PROMOTION',
          NULL, ARRAY['ref-1'], now()
        )`,
      ),
    ).rejects.toThrow();

    // FAIL_BLOCKS_PROMOTION with empty evidence_refs -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO integrity_incidents (
          incident_id, run_id, signal, verdict, reason, evidence_refs, recorded_at
        ) VALUES (
          'inc-bad-2', 'run-test-comp-001', 'REDUCED_EXPLORATION', 'FAIL_BLOCKS_PROMOTION',
          'Reason given but no evidence refs', '{}', now()
        )`,
      ),
    ).rejects.toThrow();

    // PASS with non-null reason -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO integrity_incidents (
          incident_id, run_id, signal, verdict, reason, evidence_refs, recorded_at
        ) VALUES (
          'inc-bad-3', 'run-test-comp-001', 'DELAYED_OUTCOME_OMISSION', 'PASS',
          'Should not have reason on PASS', '{}', now()
        )`,
      ),
    ).rejects.toThrow();
  });

  it('accepts all seven closed integrity signals and rejects unknowns', async () => {
    const validSignals = [
      'DENOMINATOR_GAMING',
      'SELECTIVE_UNIVERSE_CHANGE',
      'REDUCED_EXPLORATION',
      'DELAYED_OUTCOME_OMISSION',
      'HORIZON_SWITCHING',
      'SCENARIO_CHERRY_PICKING',
      'REPEATED_HOLDOUT_INSPECTION',
    ];

    for (let i = 0; i < validSignals.length; i++) {
      const signal = validSignals[i]!;
      await engine.query(
        `INSERT INTO integrity_incidents (
          incident_id, run_id, signal, verdict, reason, evidence_refs, recorded_at
        ) VALUES (
          $1, 'run-test-comp-001', $2, 'PASS', NULL, '{}', now()
        )`,
        [`inc-sig-test-${i}`, signal],
      );
    }

    // Unknown signal fails enum CHECK
    expect(
      engine.query(
        `INSERT INTO integrity_incidents (
          incident_id, run_id, signal, verdict, reason, evidence_refs, recorded_at
        ) VALUES (
          'inc-unknown-sig', 'run-test-comp-001', 'UNKNOWN_GAMING_VECTOR', 'PASS', NULL, '{}', now()
        )`,
      ),
    ).rejects.toThrow();
  });

  it('enforces append-only semantics on integrity_incidents (UPDATE and DELETE refuse)', async () => {
    expect(
      engine.query(`UPDATE integrity_incidents SET verdict = 'PASS' WHERE incident_id = 'inc-002'`),
    ).rejects.toThrow(/frozen objective records are immutable/);

    expect(
      engine.query(`DELETE FROM integrity_incidents WHERE incident_id = 'inc-001'`),
    ).rejects.toThrow(/frozen objective records are immutable/);
  });

  it('inserts eleven-field claim scopes and enforces ess <= sample_size bound', async () => {
    // Valid 11-field claim scope with ess (450.5) <= sample_size (1000)
    await engine.query(
      `INSERT INTO claim_scope_records (
        scope_id, run_id, supported_population, profile, policy, execution_scenario,
        delay_distribution, calendar_interval, market_regimes, capability_state,
        sample_size, cluster_effective_sample_size, uncertainty_method
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13
      )`,
      [
        'scope-test-001',
        'run-test-comp-001',
        'USDC-SOL DEX pools with > $100k liquidity',
        'conservative-momentum-v1',
        'fixed-spread-v1',
        'scen-p50-slippage',
        'empirical-50ms-200ms',
        '2026-01-01/2026-01-31',
        ['HIGH_VOL', 'TRENDING'],
        'read-only-lcb-v1',
        1000,
        450.5,
        'CLUSTER_BOOTSTRAP',
      ],
    );

    // ESS > sample_size -> fails CHECK (claim_scope_records_ess_bounded)
    expect(
      engine.query(
        `INSERT INTO claim_scope_records (
          scope_id, run_id, supported_population, profile, policy, execution_scenario,
          delay_distribution, calendar_interval, market_regimes, capability_state,
          sample_size, cluster_effective_sample_size, uncertainty_method
        ) VALUES (
          'scope-bad-ess', 'run-test-comp-001', 'pop', 'prof', 'pol', 'scen',
          'delay', '2026-01-01/2026-01-31', ARRAY['REGIME_1'], 'state',
          500, 600.0, 'CLUSTER_BOOTSTRAP'
        )`,
      ),
    ).rejects.toThrow();

    // Unknown uncertainty method fails enum CHECK
    expect(
      engine.query(
        `INSERT INTO claim_scope_records (
          scope_id, run_id, supported_population, profile, policy, execution_scenario,
          delay_distribution, calendar_interval, market_regimes, capability_state,
          sample_size, cluster_effective_sample_size, uncertainty_method
        ) VALUES (
          'scope-bad-method', 'run-test-comp-001', 'pop', 'prof', 'pol', 'scen',
          'delay', '2026-01-01/2026-01-31', ARRAY['REGIME_1'], 'state',
          500, 400.0, 'STANDARD_BOOTSTRAP_IID'
        )`,
      ),
    ).rejects.toThrow();
  });

  it('inserts promotion decisions and validates verdict and gate_trail array CHECKs', async () => {
    // Valid PROMOTE decision
    await engine.query(
      `INSERT INTO promotion_decisions (
        decision_id, run_id, verdict, gate_trail, decided_at
      ) VALUES (
        'dec-001', 'run-test-comp-001', 'PROMOTE',
        '[{"gate": "COMPARABILITY", "verdict": "PASS"}, {"gate": "HARD_CONSTRAINTS", "verdict": "PASS"}]'::jsonb,
        now()
      )`,
    );

    // Empty gate_trail array -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO promotion_decisions (
          decision_id, run_id, verdict, gate_trail, decided_at
        ) VALUES (
          'dec-bad-empty-trail', 'run-test-comp-001', 'HOLD_EXPLORATORY_ONLY',
          '[]'::jsonb, now()
        )`,
      ),
    ).rejects.toThrow();

    // Invalid verdict -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO promotion_decisions (
          decision_id, run_id, verdict, gate_trail, decided_at
        ) VALUES (
          'dec-bad-verdict', 'run-test-comp-001', 'APPROVE_UNCONDITIONALLY',
          '[{"gate": "COMPARABILITY", "verdict": "PASS"}]'::jsonb, now()
        )`,
      ),
    ).rejects.toThrow();
  });

  it('inserts output language screens and enforces disclosure and pass_clean CHECKs', async () => {
    // Clean passed screen
    await engine.query(
      `INSERT INTO output_language_screens (
        screen_id, output_id, prohibited_claims_found, disclosure, screen_passed, screened_at
      ) VALUES (
        'screen-001', 'out-001', '{}', $1, true, now()
      )`,
      [MANDATORY_DISCLOSURE],
    );

    // Failed screen with detected prohibited claim
    await engine.query(
      `INSERT INTO output_language_screens (
        screen_id, output_id, prohibited_claims_found, disclosure, screen_passed, screened_at
      ) VALUES (
        'screen-002', 'out-002', ARRAY['GUARANTEED_PROFIT', 'RISK_FREE_PROFIT'], $1, false, now()
      )`,
      [MANDATORY_DISCLOSURE],
    );

    // screen_passed = true with prohibited claims found -> fails CHECK (output_language_screens_pass_clean)
    expect(
      engine.query(
        `INSERT INTO output_language_screens (
          screen_id, output_id, prohibited_claims_found, disclosure, screen_passed, screened_at
        ) VALUES (
          'screen-bad-pass', 'out-003', ARRAY['GUARANTEED_PROFIT'], $1, true, now()
        )`,
        [MANDATORY_DISCLOSURE],
      ),
    ).rejects.toThrow();

    // Missing required disclosure phrase -> fails CHECK
    expect(
      engine.query(
        `INSERT INTO output_language_screens (
          screen_id, output_id, prohibited_claims_found, disclosure, screen_passed, screened_at
        ) VALUES (
          'screen-bad-disc', 'out-004', '{}', 'Incomplete disclaimer text', true, now()
        )`,
      ),
    ).rejects.toThrow();

    // Unknown prohibited claim kind in array -> fails CHECK (<@ ARRAY[...])
    expect(
      engine.query(
        `INSERT INTO output_language_screens (
          screen_id, output_id, prohibited_claims_found, disclosure, screen_passed, screened_at
        ) VALUES (
          'screen-bad-claim', 'out-005', ARRAY['UNLIMITED_YIELD_PROMISE'], $1, false, now()
        )`,
        [MANDATORY_DISCLOSURE],
      ),
    ).rejects.toThrow();

    // Immutability on output_language_screens
    expect(
      engine.query(
        `UPDATE output_language_screens SET screen_passed = false WHERE screen_id = 'screen-001'`,
      ),
    ).rejects.toThrow(/frozen objective records are immutable/);

    expect(
      engine.query(`DELETE FROM output_language_screens WHERE screen_id = 'screen-001'`),
    ).rejects.toThrow(/frozen objective records are immutable/);

    expect(engine.query(`TRUNCATE TABLE output_language_screens`)).rejects.toThrow(
      /frozen objective records are immutable/,
    );
  });
});
