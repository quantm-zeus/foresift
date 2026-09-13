/**
 * TEMPORARY third-round re-review scratch file. Deleted before finishing.
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
} from '@foresift/persistence';
import { evaluateProdConformance } from './packages/release-conformance/src/prod-rules.ts';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations');
const HASH = `sha256:${'a'.repeat(64)}`;
const SCOPE = JSON.stringify({
  profile_version: 'profile-v1',
  policy_version: 'policy-v1',
  regime_scope: 'regime-v1',
  execution_scenario: 'scenario-v1',
  delay_policy: 'delay-v1',
  population_claim: 'population-v1',
  requires_proven: true,
});

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 240_000);

afterAll(async () => {
  await db.close();
});

const validMcp = {
  revisions: [{ revision: '2025-11-25', channel: 'STABLE', isDefault: true }],
  clients: [],
  cells: [],
  now: '2026-06-01T00:00:00Z',
};

describe('round3 H2 malformed input', () => {
  it('exact previous repro now fails closed', () => {
    const report = evaluateProdConformance({
      activationClaims: 'not-an-array',
      postureDeclarations: '',
      mcpCompatibility: validMcp,
      livePaths: '',
      distributionAuthorizations: '',
    } as never);
    console.log(
      'malformed:',
      report.overall,
      report.findings.length,
      report.findings.map((f) => f.path).join(','),
    );
    expect(report.overall).toBe('FAILED');
    expect(report.findings).toHaveLength(4);
    expect(report.findings.every((f) => f.rule === 'PROD_CONFORMANCE_INPUT_MISSING')).toBe(true);
  });

  it('array mcpCompatibility fails closed', () => {
    const report = evaluateProdConformance({
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: [] as never,
      livePaths: [],
      distributionAuthorizations: [],
    } as never);
    console.log('array-mcp:', report.overall, report.findings.length);
    expect(report.overall).toBe('FAILED');
    expect(report.findings.some((f) => f.path === 'mcpCompatibility')).toBe(true);
  });

  it('all-malformed categories yield five findings', () => {
    const report = evaluateProdConformance({
      activationClaims: 'x',
      postureDeclarations: 'x',
      mcpCompatibility: 'x' as never,
      livePaths: 'x',
      distributionAuthorizations: 'x',
    } as never);
    console.log('all-malformed:', report.overall, report.findings.length);
    expect(report.overall).toBe('FAILED');
    expect(report.findings).toHaveLength(5);
  });

  it('legit empty arrays still pass (by design)', () => {
    const report = evaluateProdConformance({
      activationClaims: [],
      postureDeclarations: [],
      mcpCompatibility: validMcp,
      livePaths: [],
      distributionAuthorizations: [],
    } as never);
    console.log('empty-arrays:', report.overall, report.findings.length);
    expect(report.overall).toBe('PASSED');
  });
});

describe('round3 SQL PROVEN-state check', () => {
  it('raw ACTIVE with forged PROVEN_PRESENT PASS and NO PROVEN row is refused', async () => {
    const rawHash = `sha256:${'9'.repeat(64)}`;
    const event = 'raw-forged-proven-round3';
    const required = [
      'IMPLEMENTED_PRESENT',
      'AVAILABLE_EVIDENCE',
      'PROVEN_PRESENT',
      'VERIFIED_GATE_EVIDENCE',
      'CAPACITY_CONTRACT',
      'NO_OPEN_CONTAINMENT',
    ];
    for (const gate of required) {
      await engine.query(
        `INSERT INTO prod.activation_gate_evaluations
           (evaluation_id, scope_hash, gate_kind, verdict, failing_gate, evidence_refs,
            capacity_contract_ref, activation_event_ref, expires_at, activation_kind)
         VALUES ($1, $2, $3, 'PASS', NULL, '[]'::jsonb, NULL, $4, '2030-01-01T00:00:00Z',
                 'OPERATIONAL')`,
        [`r3-ev-${gate}`, rawHash, gate, event],
      );
    }

    let message = 'NO_THROW';
    try {
      await engine.query(
        `INSERT INTO prod.module_states
           (state_row_id, module_id, artifact_set_hash, scope, scope_hash, lifecycle_state,
            operational_readiness, distribution_readiness, activation_event_ref, activation_kind)
         VALUES ('r3-state-forged', 'module-1', $1, $2::jsonb, $3, 'ACTIVE',
                 'READY_FOR_COLLECTION', 'PRIVATE_ONLY', $4, 'OPERATIONAL')`,
        [HASH, SCOPE, rawHash, event],
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    console.log('forged ACTIVE (no PROVEN row) refusal:', message);
    expect(message).toMatch(/persisted PROVEN state/);

    // Seed the PROVEN row the SQL law requires and retry the SAME insert: it
    // now succeeds, proving the PROVEN-state check (not a missing gate) refused.
    await engine.query(
      `INSERT INTO prod.module_states
         (state_row_id, module_id, artifact_set_hash, scope, scope_hash, lifecycle_state,
          operational_readiness, distribution_readiness, activation_event_ref, activation_kind)
       VALUES ('r3-proven', 'module-1', $1, $2::jsonb, $3, 'PROVEN',
               'READY_FOR_ACTIVE_PROFILE', 'PRIVATE_ONLY', NULL, NULL)`,
      [HASH, SCOPE, rawHash],
    );
    const retry = await engine.query(
      `INSERT INTO prod.module_states
         (state_row_id, module_id, artifact_set_hash, scope, scope_hash, lifecycle_state,
          operational_readiness, distribution_readiness, activation_event_ref, activation_kind)
       VALUES ('r3-state-forged-2', 'module-1', $1, $2::jsonb, $3, 'ACTIVE',
               'READY_FOR_COLLECTION', 'PRIVATE_ONLY', $4, 'OPERATIONAL')`,
      [HASH, SCOPE, rawHash, event],
    );
    console.log('retry with PROVEN row: rows inserted =', retry.rows.length, '(0 expected)');
    expect(retry.rows.length).toBe(0);
  }, 120_000);
});
