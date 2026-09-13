/**
 * `prod`-family migration-shape suite
 * (T013, FR-PROD-001…006, AC-144, AC-152, AC-153, AC-278, AC-279).
 *
 * Applies the whole migration set to a fresh PGlite database and proves the SQL
 * truth the capability registry will depend on:
 * - all five `g2_prod_*` scripts apply cleanly, in order;
 * - every `prod` table lives in the dedicated `prod` schema and none leaks into
 *   `public` (ADR-G2PROD-1, AC-261 probe);
 * - module states are append-only with exactly one legal one-time supersede,
 *   and an `ACTIVE` row requires a gate-evaluation reference (AC-152);
 * - the governed state/classification/gate vocabularies mirror the domain;
 * - a draft MCP revision can never be the default and at most one revision is
 *   default (AC-144);
 * - a precomputed bound without ceilings is refused (§33.7);
 * - a best-effort declaration listing a protected dimension is refused
 *   (AC-153);
 * - a containment row allowing auto-reactivation is refused (AC-278).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_ACTIVATION_GATE_KINDS,
  ALL_CHANGE_CLASSIFICATIONS,
  ALL_MODULE_LIFECYCLE_STATES,
} from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

const PROTECTED = [
  'identity',
  'point_in_time',
  'audit',
  'duplicate_prevention',
  'security',
  'execution_semantics',
  'capacity',
  'critical_risk_monitoring',
  'claim_boundaries',
] as const;

const PROD_TABLES = [
  'activation_gate_evaluations',
  'artifact_boundary_assertions',
  'best_effort_declarations',
  'containment_events',
  'critical_dependencies',
  'dependency_groups',
  'live_path_alpha_reads',
  'mcp_compatibility_matrix',
  'mcp_conformance_runs',
  'mcp_revisions',
  'mcp_target_clients',
  'module_states',
  'precomputed_alpha_bounds',
  'rollback_events',
  'sla_register',
  'state_transitions',
] as const;

let db: PGlite;
let engine: DatabaseEngine;
let applied: readonly string[];
let seq = 0;

/** Capture a rejection so the assertion can inspect the message and SQLSTATE. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('expected the statement to be refused, but it succeeded');
}

const SCOPE = JSON.stringify({
  profile_version: 'profile-v1',
  policy_version: 'policy-v1',
  regime_scope: 'regime-v1',
  execution_scenario: 'scenario-v1',
  delay_policy: 'delay-v1',
  population_claim: 'population-v1',
  requires_proven: true,
});

/** Insert one module state row and return its id. */
async function seedModuleState(
  tag: string,
  lifecycleState = 'IMPLEMENTED',
  activationEventRef: string | null = null,
): Promise<string> {
  seq += 1;
  const stateRowId = `state-${tag}-${seq}`;
  await engine.query(
    `INSERT INTO prod.module_states
       (state_row_id, module_id, artifact_set_hash, scope, lifecycle_state,
        operational_readiness, distribution_readiness, activation_event_ref)
     VALUES ($1, 'module-1', $2, $3::jsonb, $4,
             'READY_FOR_COLLECTION', 'PRIVATE_ONLY', $5)`,
    [stateRowId, HASH, SCOPE, lifecycleState, activationEventRef],
  );
  return stateRowId;
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  applied = report.applied;
}, 180_000);

afterAll(async () => {
  await db.close();
});

describe('g2_prod_* migrations apply to a fresh database', () => {
  it('applies every prod script in lexicographic order', () => {
    const ids = [
      'g2_prod_0001_module_registry',
      'g2_prod_0002_dependency_posture',
      'g2_prod_0003_mcp_compat',
      'g2_prod_0004_alpha_boundary',
      'g2_prod_0005_activation_evidence',
    ] as const;
    for (const id of ids) expect(applied).toContain(id);
    for (let i = 1; i < ids.length; i += 1) {
      const previous = ids[i - 1];
      const current = ids[i];
      if (previous === undefined || current === undefined) throw new Error('unreachable');
      expect(applied.indexOf(previous)).toBeLessThan(applied.indexOf(current));
    }
  });

  it('creates every prod table in the prod schema and none in public', async () => {
    const rows = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'prod' ORDER BY table_name`,
    );
    expect(rows.rows.map((r) => r.table_name)).toEqual([...PROD_TABLES]);

    const leaked = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [PROD_TABLES],
    );
    expect(leaked.rows).toEqual([]);
  }, 120_000);
});

describe('governed module states are append-only and gate-backed', () => {
  it('refuses an ACTIVE row without a gate-evaluation reference', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO prod.module_states
           (state_row_id, module_id, artifact_set_hash, scope, lifecycle_state,
            operational_readiness, distribution_readiness, activation_event_ref)
         VALUES ('state-active-no-gate', 'module-1', $1, $2::jsonb, 'ACTIVE',
                 'READY_FOR_ACTIVE_PROFILE', 'PRIVATE_ONLY', NULL)`,
        [HASH, SCOPE],
      ),
    );
    expect(error.message).toMatch(/module_states_active_requires_gate_evaluation/);
  }, 120_000);

  it('refuses a raw ACTIVE INSERT with zero persisted gate rows (F2 bypass)', async () => {
    const rawHash = `sha256:${'d'.repeat(64)}`;
    const rawEvent = 'fabricated-event-never-evaluated';
    const before = await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM prod.activation_gate_evaluations
        WHERE scope_hash = $1 AND activation_event_ref = $2`,
      [rawHash, rawEvent],
    );
    expect(Number(before.rows[0]?.n)).toBe(0);

    const error = await rejection(
      engine.query(
        `INSERT INTO prod.module_states
           (state_row_id, module_id, artifact_set_hash, scope, scope_hash, lifecycle_state,
            operational_readiness, distribution_readiness, activation_event_ref)
         VALUES ('state-raw-bypass', 'module-1', $1, $2::jsonb, $3, 'ACTIVE',
                 'READY_FOR_ACTIVE_PROFILE', 'PRIVATE_ONLY', $4)`,
        [HASH, SCOPE, rawHash, rawEvent],
      ),
    );
    expect(error.message).toMatch(/all-PASS persisted gate evaluation set/);

    const rows = await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM prod.module_states WHERE state_row_id = 'state-raw-bypass'`,
    );
    expect(Number(rows.rows[0]?.n)).toBe(0);
  }, 120_000);

  it('allows a raw ACTIVE INSERT backed by a complete persisted all-PASS set', async () => {
    const rawHash = `sha256:${'e'.repeat(64)}`;
    const rawEvent = 'raw-legit-activation';
    for (const gate of ALL_ACTIVATION_GATE_KINDS) {
      await engine.query(
        `INSERT INTO prod.activation_gate_evaluations
           (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs,
            capacity_contract_ref, activation_event_ref, expires_at)
         VALUES ($1, $2, $3, 'PASS', NULL, '[]'::jsonb, NULL, $4, '2030-01-01T00:00:00Z')`,
        [`raw-${gate}`, rawHash, gate, rawEvent],
      );
    }
    await engine.query(
      `INSERT INTO prod.module_states
         (state_row_id, module_id, artifact_set_hash, scope, scope_hash, lifecycle_state,
          operational_readiness, distribution_readiness, activation_event_ref)
       VALUES ('state-raw-legit', 'module-1', $1, $2::jsonb, $3, 'ACTIVE',
               'READY_FOR_ACTIVE_PROFILE', 'PRIVATE_ONLY', $4)`,
      [HASH, SCOPE, rawHash, rawEvent],
    );
    const rows = await engine.query<{ lifecycle_state: string }>(
      `SELECT lifecycle_state FROM prod.module_states WHERE state_row_id = 'state-raw-legit'`,
    );
    expect(rows.rows[0]?.lifecycle_state).toBe('ACTIVE');
  }, 120_000);

  it('refuses an unknown lifecycle state and an incomplete scope', async () => {
    const state = await rejection(
      engine.query(
        `INSERT INTO prod.module_states
           (state_row_id, module_id, artifact_set_hash, scope, lifecycle_state,
            operational_readiness, distribution_readiness, activation_event_ref)
         VALUES ('state-bad', 'module-1', $1, $2::jsonb, 'DEPLOYED',
                 'READY_FOR_COLLECTION', 'PRIVATE_ONLY', NULL)`,
        [HASH, SCOPE],
      ),
    );
    expect(state.message).toMatch(/lifecycle_state/);

    const scope = await rejection(
      engine.query(
        `INSERT INTO prod.module_states
           (state_row_id, module_id, artifact_set_hash, scope, lifecycle_state,
            operational_readiness, distribution_readiness, activation_event_ref)
         VALUES ('state-scope', 'module-1', $1, '{"profile_version":"p"}'::jsonb, 'IMPLEMENTED',
                 'READY_FOR_COLLECTION', 'PRIVATE_ONLY', NULL)`,
        [HASH],
      ),
    );
    expect(scope.message).toMatch(/module_states_scope_complete/);
  }, 120_000);

  it('allows exactly the one-time supersede pointer', async () => {
    const first = await seedModuleState('supersede');
    const second = await seedModuleState('supersede-next');
    await engine.query(`UPDATE prod.module_states SET superseded_by = $1 WHERE state_row_id = $2`, [
      second,
      first,
    ]);
    const rows = await engine.query<{ superseded_by: string | null }>(
      `SELECT superseded_by FROM prod.module_states WHERE state_row_id = $1`,
      [first],
    );
    expect(rows.rows[0]?.superseded_by).toBe(second);
  }, 120_000);

  it('refuses an in-place module-state mutation, DELETE, and TRUNCATE', async () => {
    const stateRowId = await seedModuleState('immutable');
    const mutated = await rejection(
      engine.query(
        `UPDATE prod.module_states SET lifecycle_state = 'PAUSED' WHERE state_row_id = $1`,
        [stateRowId],
      ),
    );
    expect((mutated as { code?: string }).code).toBe('23001'); // restrict_violation
    expect(mutated.message).toMatch(/module states are append-only/);

    const superseded = await seedModuleState('immutable-next');
    const combined = await rejection(
      engine.query(
        `UPDATE prod.module_states SET lifecycle_state = 'PAUSED', superseded_by = $1
          WHERE state_row_id = $2`,
        [superseded, stateRowId],
      ),
    );
    expect(combined.message).toMatch(/module states are append-only/);

    const deleted = await rejection(
      engine.query(`DELETE FROM prod.module_states WHERE state_row_id = $1`, [stateRowId]),
    );
    expect(deleted.message).toMatch(/module states are append-only/);

    const truncated = await rejection(engine.query('TRUNCATE prod.module_states CASCADE'));
    expect((truncated as { code?: string }).code).toBe('23001');
    expect(truncated.message).toMatch(/module states are append-only/);

    const survivors = await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM prod.module_states`,
    );
    expect(Number(survivors.rows[0]?.n)).toBeGreaterThan(0);
  }, 120_000);

  it('refuses a transition mutation and a self-transition', async () => {
    const stateRowId = await seedModuleState('transition');
    await engine.query(
      `INSERT INTO prod.state_transitions
         (transition_id, state_row_id, from_state, to_state, change_classification,
          gate_evaluation_ref, reason, actor_ref)
       VALUES ('transition-1', $1, 'NOT_IMPLEMENTED', 'IMPLEMENTED', 'MATERIAL_OPERATIONAL',
               NULL, 'initial implementation', 'actor-1')`,
      [stateRowId],
    );
    const selfTransition = await rejection(
      engine.query(
        `INSERT INTO prod.state_transitions
           (transition_id, state_row_id, from_state, to_state, change_classification,
            gate_evaluation_ref, reason, actor_ref)
         VALUES ('transition-self', $1, 'IMPLEMENTED', 'IMPLEMENTED', 'MATERIAL_OPERATIONAL',
                 NULL, 'no-op', 'actor-1')`,
        [stateRowId],
      ),
    );
    expect(selfTransition.message).toMatch(/state_transitions_no_self_transition/);

    const mutated = await rejection(
      engine.query(
        `UPDATE prod.state_transitions SET reason = 'rewritten' WHERE transition_id = 'transition-1'`,
      ),
    );
    expect((mutated as { code?: string }).code).toBe('23001');
    expect(mutated.message).toMatch(/state transitions are append-only/);

    const truncated = await rejection(engine.query('TRUNCATE prod.state_transitions'));
    expect(truncated.message).toMatch(/state transitions are append-only/);
  }, 120_000);
});

describe('activation-gate evaluations are immutable and verdict-consistent', () => {
  it('accepts a PASS/REFUSE pair and refuses inconsistent verdicts', async () => {
    await engine.query(
      `INSERT INTO prod.activation_gate_evaluations
         (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs,
          capacity_contract_ref, expires_at)
       VALUES ('gate-pass', $1, 'PROVEN_PRESENT', 'PASS', NULL, '[]'::jsonb, NULL,
               '2027-01-01T00:00:00Z')`,
      [HASH_B],
    );
    await engine.query(
      `INSERT INTO prod.activation_gate_evaluations
         (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs,
          capacity_contract_ref, expires_at)
       VALUES ('gate-refuse', $1, 'CAPACITY_CONTRACT', 'REFUSE', 'CAPACITY_CONTRACT', '[]'::jsonb,
               'capacity-1', '2027-01-01T00:00:00Z')`,
      [HASH_B],
    );

    const badPass = await rejection(
      engine.query(
        `INSERT INTO prod.activation_gate_evaluations
           (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs, expires_at)
         VALUES ('gate-bad-pass', $1, 'PROVEN_PRESENT', 'PASS', 'PROVEN_PRESENT', '[]'::jsonb,
                 '2027-01-01T00:00:00Z')`,
        [HASH_B],
      ),
    );
    expect(badPass.message).toMatch(/activation_gate_evaluations_verdict_consistency/);

    const badRefuse = await rejection(
      engine.query(
        `INSERT INTO prod.activation_gate_evaluations
           (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs, expires_at)
         VALUES ('gate-bad-refuse', $1, 'PROVEN_PRESENT', 'REFUSE', NULL, '[]'::jsonb,
                 '2027-01-01T00:00:00Z')`,
        [HASH_B],
      ),
    );
    expect(badRefuse.message).toMatch(/activation_gate_evaluations_verdict_consistency/);

    const mutated = await rejection(
      engine.query(
        `UPDATE prod.activation_gate_evaluations SET verdict = 'REFUSE' WHERE evaluation_id = 'gate-pass'`,
      ),
    );
    expect(mutated.message).toMatch(/activation gate evaluations are immutable/);
    expect(
      await rejection(engine.query('TRUNCATE prod.activation_gate_evaluations')),
    ).toBeInstanceOf(Error);
  }, 120_000);
});

describe('§69.11 containment and rollback', () => {
  it('refuses a containment row allowing auto-reactivation', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO prod.containment_events
           (containment_id, module_id, scope_hash, action, trigger_gate_kind, reason,
            auto_reactivation_allowed)
         VALUES ('containment-auto', 'module-1', $1, 'PAUSED', 'CAPACITY_CONTRACT', 'breach', true)`,
        [HASH],
      ),
    );
    expect(error.message).toMatch(/containment_events_no_auto_reactivation/);

    await engine.query(
      `INSERT INTO prod.containment_events
         (containment_id, module_id, scope_hash, action, trigger_gate_kind, reason)
       VALUES ('containment-ok', 'module-1', $1, 'PAUSED', 'CAPACITY_CONTRACT', 'breach')`,
      [HASH],
    );
    const rows = await engine.query<{ auto_reactivation_allowed: boolean }>(
      `SELECT auto_reactivation_allowed FROM prod.containment_events WHERE containment_id = 'containment-ok'`,
    );
    expect(rows.rows[0]?.auto_reactivation_allowed).toBe(false);
  }, 120_000);

  it('requires a NEW activation event, history preservation, and no mutation', async () => {
    await engine.query(
      `INSERT INTO prod.rollback_events
         (rollback_id, module_id, restored_artifact_set_hash, prior_activation_event_ref,
          new_activation_event_ref, candidate_reevaluation_ref)
       VALUES ('rollback-1', 'module-1', $1, 'gate-pass', 'gate-new', 'reevaluation-1')`,
      [HASH],
    );
    const reused = await rejection(
      engine.query(
        `INSERT INTO prod.rollback_events
           (rollback_id, module_id, restored_artifact_set_hash, prior_activation_event_ref,
            new_activation_event_ref, candidate_reevaluation_ref)
         VALUES ('rollback-reused', 'module-1', $1, 'gate-pass', 'gate-pass', 'reevaluation-2')`,
        [HASH],
      ),
    );
    expect(reused.message).toMatch(/rollback_events_new_event_is_new/);

    const notPreserved = await rejection(
      engine.query(
        `INSERT INTO prod.rollback_events
           (rollback_id, module_id, restored_artifact_set_hash, prior_activation_event_ref,
            new_activation_event_ref, history_preserved, candidate_reevaluation_ref)
         VALUES ('rollback-unpreserved', 'module-1', $1, 'gate-pass', 'gate-other',
                 false, 'reevaluation-2')`,
        [HASH],
      ),
    );
    expect(notPreserved.message).toMatch(/rollback_events_history_preserved/);

    const mutated = await rejection(
      engine.query(
        `UPDATE prod.rollback_events SET candidate_reevaluation_ref = 'rewritten'
          WHERE rollback_id = 'rollback-1'`,
      ),
    );
    expect((mutated as { code?: string }).code).toBe('23001');
    expect(mutated.message).toMatch(/rollback events are append-only/);
  }, 120_000);
});

describe('§40 dependency groups and §69.6 posture declarations', () => {
  it('refuses a group that activates opportunities and an unknown group id', async () => {
    const activating = await rejection(
      engine.query(
        `INSERT INTO prod.dependency_groups
           (group_id, depends_on, status, manifest_requirement_count, evidence_refs,
            activates_opportunities)
         VALUES ('G6', '[]'::jsonb, 'IN_PROGRESS', 6, '[]'::jsonb, true)`,
      ),
    );
    expect(activating.message).toMatch(/dependency_groups_never_activate/);

    const unknown = await rejection(
      engine.query(
        `INSERT INTO prod.dependency_groups
           (group_id, depends_on, status, manifest_requirement_count, evidence_refs)
         VALUES ('G9', '[]'::jsonb, 'OPEN', 0, '[]'::jsonb)`,
      ),
    );
    expect(unknown.message).toMatch(/group_id/);
  }, 120_000);

  it('refuses a best-effort declaration listing a protected dimension', async () => {
    const weakening = await rejection(
      engine.query(
        `INSERT INTO prod.best_effort_declarations
           (declaration_id, posture, degraded_scope, missing_sla_refs, weakened_dimensions,
            protected_dimensions, reason)
         VALUES ('declaration-weakening', 'FREE_TIER_BEST_EFFORT', '{}'::jsonb, '[]'::jsonb,
                 ARRAY['audit']::text[], $1::text[], 'no SLA')`,
        [[...PROTECTED]],
      ),
    );
    expect(weakening.message).toMatch(
      /best_effort_declarations_never_weaken_protected|best_effort_declarations_weaken_only_relaxable/,
    );

    const slaBacked = await rejection(
      engine.query(
        `INSERT INTO prod.best_effort_declarations
           (declaration_id, posture, degraded_scope, missing_sla_refs, weakened_dimensions,
            protected_dimensions, reason)
         VALUES ('declaration-sla-backed', 'SLA_BACKED', '{}'::jsonb, '[]'::jsonb,
                 ARRAY['freshness']::text[], $1::text[], 'weakened anyway')`,
        [[...PROTECTED]],
      ),
    );
    expect(slaBacked.message).toMatch(/best_effort_declarations_sla_backed_no_weakening/);

    const incompleteProtected = await rejection(
      engine.query(
        `INSERT INTO prod.best_effort_declarations
           (declaration_id, posture, degraded_scope, missing_sla_refs, weakened_dimensions,
            protected_dimensions, reason)
         VALUES ('declaration-incomplete', 'FREE_TIER_BEST_EFFORT', '{}'::jsonb, '[]'::jsonb,
                 ARRAY['freshness']::text[], ARRAY['identity']::text[], 'incomplete')`,
      ),
    );
    expect(incompleteProtected.message).toMatch(/best_effort_declarations_protected_complete/);

    await engine.query(
      `INSERT INTO prod.best_effort_declarations
         (declaration_id, posture, degraded_scope, missing_sla_refs, weakened_dimensions,
          protected_dimensions, reason)
       VALUES ('declaration-ok', 'FREE_TIER_BEST_EFFORT', '{}'::jsonb, '["dep-1"]'::jsonb,
               ARRAY['freshness', 'alert_availability']::text[], $1::text[], 'no applicable SLA')`,
      [[...PROTECTED]],
    );
    const rows = await engine.query<{ posture: string; weakened_dimensions: string[] }>(
      `SELECT posture, weakened_dimensions FROM prod.best_effort_declarations
        WHERE declaration_id = 'declaration-ok'`,
    );
    expect(rows.rows[0]?.posture).toBe('FREE_TIER_BEST_EFFORT');
    expect(rows.rows[0]?.weakened_dimensions).toEqual(['freshness', 'alert_availability']);
  }, 120_000);
});

describe('§69.7 MCP compatibility matrix', () => {
  it('refuses a draft default and more than one default revision', async () => {
    await engine.query(
      `INSERT INTO prod.mcp_revisions
         (revision, channel, sdk_version, transport, origin_policy_ref, is_default)
       VALUES ('2025-11-25', 'STABLE', '1.2.0', 'STREAMABLE_HTTP', 'origin-1', true)`,
    );
    const draftDefault = await rejection(
      engine.query(
        `INSERT INTO prod.mcp_revisions
           (revision, channel, sdk_version, transport, origin_policy_ref, is_default)
         VALUES ('2026-01-01-rc.1', 'DRAFT', '2.0.0-rc.1', 'STREAMABLE_HTTP', 'origin-1', true)`,
      ),
    );
    expect(draftDefault.message).toMatch(/mcp_revisions_no_draft_default/);

    const secondDefault = await rejection(
      engine.query(
        `INSERT INTO prod.mcp_revisions
           (revision, channel, sdk_version, transport, origin_policy_ref, is_default)
         VALUES ('2026-02-02', 'STABLE', '1.3.0', 'STREAMABLE_HTTP', 'origin-1', true)`,
      ),
    );
    expect(secondDefault.message).toMatch(/mcp_revisions_single_default_idx/);
  }, 120_000);

  it('binds a matrix cell to a revision and client and keeps the pair unique', async () => {
    await engine.query(
      `INSERT INTO prod.mcp_target_clients
         (client_id, client_name, version, capabilities, auth_mode)
       VALUES ('client-a', 'Desktop Client', '0.9.0', '{}'::jsonb, 'OAUTH_2_1')`,
    );
    await engine.query(
      `INSERT INTO prod.mcp_compatibility_matrix
         (cell_id, revision, client_id, conformance_fixture_ref, live_test_date, result)
       VALUES ('cell-1', '2025-11-25', 'client-a', 'fixture-1', '2026-05-01T00:00:00Z', 'PASS')`,
    );
    const duplicate = await rejection(
      engine.query(
        `INSERT INTO prod.mcp_compatibility_matrix
           (cell_id, revision, client_id, conformance_fixture_ref, live_test_date, result)
         VALUES ('cell-2', '2025-11-25', 'client-a', 'fixture-2', '2026-05-01T00:00:00Z', 'FAIL')`,
      ),
    );
    expect(duplicate.message).toMatch(/mcp_compatibility_matrix_revision_client_unique/);

    const missingRevision = await rejection(
      engine.query(
        `INSERT INTO prod.mcp_compatibility_matrix
           (cell_id, revision, client_id, conformance_fixture_ref, live_test_date, result)
         VALUES ('cell-3', 'does-not-exist', 'client-a', 'fixture-1', '2026-05-01T00:00:00Z', 'PASS')`,
      ),
    );
    expect(missingRevision.message).toMatch(/mcp_compatibility_matrix_revision_fk/);
  }, 120_000);
});

describe('§33.7 bounded precomputed alpha and the import boundary', () => {
  it('refuses a bound without ceilings and a negative read', async () => {
    const missing = await rejection(
      engine.query(
        `INSERT INTO prod.precomputed_alpha_bounds
           (bound_id, live_path, artifact_ref, artifact_set_hash, max_rows, max_edges,
            max_latency_ms, max_cost_usd, dataset_cutoff, expires_at)
         VALUES ('bound-missing', 'live-path-1', 'artifact-1', $1, 100, 100, 100, 1,
                 '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
        [HASH],
      ),
    );
    expect(missing.message).toMatch(/max_candidates/);

    const zero = await rejection(
      engine.query(
        `INSERT INTO prod.precomputed_alpha_bounds
           (bound_id, live_path, artifact_ref, artifact_set_hash, max_candidates, max_rows,
            max_edges, max_latency_ms, max_cost_usd, dataset_cutoff, expires_at)
         VALUES ('bound-zero', 'live-path-1', 'artifact-1', $1, 0, 100, 100, 100, 1,
                 '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
        [HASH],
      ),
    );
    expect(zero.message).toMatch(/max_candidates/);

    await engine.query(
      `INSERT INTO prod.precomputed_alpha_bounds
         (bound_id, live_path, artifact_ref, artifact_set_hash, max_candidates, max_rows,
          max_edges, max_latency_ms, max_cost_usd, dataset_cutoff, expires_at)
       VALUES ('bound-ok', 'live-path-1', 'artifact-1', $1, 100, 100, 100, 100, 1,
               '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
      [HASH],
    );
    const inconsistent = await rejection(
      engine.query(
        `INSERT INTO prod.live_path_alpha_reads
           (read_id, live_path, bound_id, request_hash, served, refusal_reason)
         VALUES ('read-served-with-reason', 'live-path-1', 'bound-ok', $1, true, 'EXPIRED')`,
        [HASH_C],
      ),
    );
    expect(inconsistent.message).toMatch(/live_path_alpha_reads_outcome_consistency/);

    await engine.query(
      `INSERT INTO prod.live_path_alpha_reads
         (read_id, live_path, bound_id, request_hash, served, latency_ms)
       VALUES ('read-ok', 'live-path-1', 'bound-ok', $1, true, 12)`,
      [HASH_C],
    );
    const rows = await engine.query<{ served: boolean }>(
      `SELECT served FROM prod.live_path_alpha_reads WHERE read_id = 'read-ok'`,
    );
    expect(rows.rows[0]?.served).toBe(true);
  }, 120_000);

  it('binds the import reference to IMPORT_SHADOW_ONLY and references sec.import_artifacts', async () => {
    await engine.query(
      `INSERT INTO sec.import_artifacts
         (artifact_id, manifest_sha256, producer_key_id, format, byte_size, state,
          state_rank, step_up_approval_ref, received_at, state_changed_at)
       VALUES ('import-1', $1, 'producer-1', 'VERSIONED_JSON', 1024, 'RECEIVED', 0,
               'approval-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [HASH],
    );
    const missingRef = await rejection(
      engine.query(
        `INSERT INTO prod.artifact_boundary_assertions
           (assertion_id, live_path, assertion_kind, import_artifact_ref, verdict)
         VALUES ('assertion-missing-ref', 'live-path-1', 'IMPORT_SHADOW_ONLY', NULL, 'PASS')`,
      ),
    );
    expect(missingRef.message).toMatch(/artifact_boundary_assertions_import_ref_consistency/);

    const spuriousRef = await rejection(
      engine.query(
        `INSERT INTO prod.artifact_boundary_assertions
           (assertion_id, live_path, assertion_kind, import_artifact_ref, verdict)
         VALUES ('assertion-spurious-ref', 'live-path-1', 'NO_IMPORT', 'import-1', 'PASS')`,
      ),
    );
    expect(spuriousRef.message).toMatch(/artifact_boundary_assertions_import_ref_consistency/);

    await engine.query(
      `INSERT INTO prod.artifact_boundary_assertions
         (assertion_id, live_path, assertion_kind, import_artifact_ref, verdict)
       VALUES ('assertion-shadow', 'live-path-1', 'IMPORT_SHADOW_ONLY', 'import-1', 'PASS')`,
    );
    const rows = await engine.query<{ import_artifact_ref: string }>(
      `SELECT import_artifact_ref FROM prod.artifact_boundary_assertions
        WHERE assertion_id = 'assertion-shadow'`,
    );
    expect(rows.rows[0]?.import_artifact_ref).toBe('import-1');
  }, 120_000);
});

describe('SQL vocabularies mirror the domain authority', () => {
  async function checkList(table: string, column: string): Promise<string[]> {
    const checks = await engine.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE contype = 'c'
         AND conrelid::regclass::text = $1
         AND pg_get_constraintdef(oid) LIKE ('%' || $2 || ' = ANY%')`,
      [table, column],
    );
    const listed = new Set<string>();
    for (const { def } of checks.rows) {
      for (const match of def.matchAll(/'([A-Z][A-Z_]+)'/g)) {
        if (match[1] !== undefined) listed.add(match[1]);
      }
    }
    return [...listed].sort();
  }

  it('mirrors the nine governed module lifecycle states', async () => {
    expect(await checkList('prod.module_states', 'lifecycle_state')).toEqual(
      [...ALL_MODULE_LIFECYCLE_STATES].sort(),
    );
  }, 120_000);

  it('mirrors the activation gate kinds and change classifications', async () => {
    expect(await checkList('prod.activation_gate_evaluations', 'gate_kind')).toEqual(
      [...ALL_ACTIVATION_GATE_KINDS].sort(),
    );
    expect(await checkList('prod.state_transitions', 'change_classification')).toEqual(
      [...ALL_CHANGE_CLASSIFICATIONS].sort(),
    );
  }, 120_000);
});
