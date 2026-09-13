/**
 * PGlite migration-shape tests for the `adm` admin-control family
 * (T010, FR-ADM-001/003/007, AC-014, AC-063, AC-260, AC-262).
 *
 * Proves the three `g2_adm_*` scripts apply cleanly on a fresh database, that
 * every guard is enforced by SQL truth (not convention), and that the admin
 * tables live ONLY in the dedicated `adm` schema. The AC-261 recovery probe
 * asserts the absence of unqualified tables, so `public` must stay untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { DatabaseEngine } from '@foresift/persistence';
import {
  closeTestDatabase,
  makeTestDatabase,
  type TestDatabase,
} from '../../../../../tests/acceptance/helpers.ts';

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const AT = '2026-09-01T00:00:00Z';
const LATER = '2026-10-01T00:00:00Z';
const SCOPE = { scopeKind: 'GLOBAL', scopeRef: 'global' };

const ADM_TABLES = [
  'kill_switch_states',
  'kill_switch_events',
  'configuration_versions',
  'resolved_config_previews',
  'overview_snapshots',
  'admin_action_audit',
] as const;

let tdb: TestDatabase;
let engine: DatabaseEngine;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  engine = tdb.engine;
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

async function insertConfigurationVersion(id: string): Promise<void> {
  await engine.query(
    `INSERT INTO adm.configuration_versions
       (config_version_id, config_kind, config_id, version, owner_version_ref,
        config_hash, lifecycle_state, resolved_config, resolved_config_hash,
        approved_by_ref, created_at)
     VALUES ($1, 'SCHEDULE', $2, 1, NULL, $3, 'DRAFT', '{}'::jsonb, $4, NULL, $5)`,
    [id, `config-${id}`, HASH, HASH_B, AT],
  );
}

async function insertAllowedAudit(actionId: string, idempotencyKey: string): Promise<void> {
  await engine.query(
    `INSERT INTO adm.admin_action_audit
       (action_id, action_kind, target_ref, actor_ref, step_up_ref, csrf_ref,
        idempotency_key, reason, outcome, audit_ref, recorded_at)
     VALUES ($1, 'KILL_SWITCH_ENGAGE', 'DISABLE_ALL_AUTOMATION', 'admin@example.com',
             'proof-1', 'csrf-1', $2, 'engaging after an incident', 'ALLOWED', 'audit-1', $3)`,
    [actionId, idempotencyKey, AT],
  );
}

async function insertKillSwitchState(input: {
  stateRowId: string;
  state: 'ENGAGED' | 'DISENGAGED';
  scopeRef: string;
  reason: string | null;
  actorRef: string | null;
}): Promise<void> {
  const scopeHash = `sha256:${createHash('sha256').update(input.scopeRef, 'utf8').digest('hex')}`;
  await engine.query(
    `INSERT INTO adm.kill_switch_states
       (state_row_id, switch_kind, scope, scope_hash, state, reason, actor_ref, created_at)
     VALUES ($1, 'DISABLE_ALL_AUTOMATION', $2::jsonb, $3, $4, $5, $6, $7)`,
    [
      input.stateRowId,
      JSON.stringify({ scopeKind: 'GLOBAL', scopeRef: input.scopeRef }),
      scopeHash,
      input.state,
      input.reason,
      input.actorRef,
      AT,
    ],
  );
}

describe('adm migration family shape', () => {
  it('applies the three adm scripts cleanly in lexicographic order', async () => {
    const recorded = await engine.query<{ id: string }>(
      `SELECT id FROM _foresift_schema_migrations WHERE id LIKE 'g2_adm_%' ORDER BY id`,
    );
    expect(recorded.rows.map((row) => row.id)).toEqual([
      'g2_adm_0001_kill_switches',
      'g2_adm_0002_configuration_versions',
      'g2_adm_0003_overview_audit',
    ]);
  });

  it('keeps every adm table in the dedicated schema and none in public', async () => {
    const adm = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'adm' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [[...ADM_TABLES]],
    );
    expect(adm.rows.map((row) => row.table_name)).toEqual([...ADM_TABLES].sort());

    const leaked = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...ADM_TABLES]],
    );
    expect(leaked.rows).toEqual([]);
  });
});

describe('adm SQL CHECKs refuse fail-open state', () => {
  it('refuses a non-zero provider-call counter and a non-zero external write counter', async () => {
    const insertSnapshot = (providerCalls: number, externalWrites: number) =>
      engine.query(
        `INSERT INTO adm.overview_snapshots
           (snapshot_id, generated_at, system_mode, sections, source_refs,
            section_hashes, read_model_hash, provider_calls_triggered, external_write_attempts)
         VALUES ($1, $2, 'ACTIVE', $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8)`,
        [
          `snap-${providerCalls}-${externalWrites}`,
          AT,
          JSON.stringify([{ sectionKey: 'SYSTEM_MODE' }]),
          JSON.stringify([]),
          JSON.stringify({}),
          HASH,
          providerCalls,
          externalWrites,
        ],
      );

    await insertSnapshot(0, 0);
    await expect(insertSnapshot(1, 0)).rejects.toThrow(/provider_calls_triggered/);
    await expect(insertSnapshot(0, 1)).rejects.toThrow(/external_write_attempts/);
  });

  it('refuses an in-place configuration mutation and an illegal lifecycle jump', async () => {
    await insertConfigurationVersion('cfg-immutable-1');
    await expect(
      engine.query(
        `UPDATE adm.configuration_versions SET config_hash = $1 WHERE config_version_id = $2`,
        [HASH_B, 'cfg-immutable-1'],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      engine.query(
        `UPDATE adm.configuration_versions SET lifecycle_state = 'ACTIVE' WHERE config_version_id = $1`,
        ['cfg-immutable-1'],
      ),
    ).rejects.toThrow(/lifecycle/);
    // The governed transition itself is legal and persists.
    await engine.query(
      `UPDATE adm.configuration_versions SET lifecycle_state = 'VALIDATED' WHERE config_version_id = $1`,
      ['cfg-immutable-1'],
    );
    const row = await engine.query<{ lifecycle_state: string; config_hash: string }>(
      `SELECT lifecycle_state, config_hash FROM adm.configuration_versions WHERE config_version_id = $1`,
      ['cfg-immutable-1'],
    );
    expect(row.rows[0]?.lifecycle_state).toBe('VALIDATED');
    expect(row.rows[0]?.config_hash).toBe(HASH);
  });

  it('refuses an ENGAGED switch without an actor and reason', async () => {
    await expect(
      insertKillSwitchState({
        stateRowId: 'ks-engaged-no-actor',
        state: 'ENGAGED',
        scopeRef: 'global-no-actor',
        reason: 'engaging after an incident',
        actorRef: null,
      }),
    ).rejects.toThrow(/engaged_evidence/);
    await expect(
      insertKillSwitchState({
        stateRowId: 'ks-engaged-no-reason',
        state: 'ENGAGED',
        scopeRef: 'global-no-reason',
        reason: null,
        actorRef: 'admin@example.com',
      }),
    ).rejects.toThrow(/engaged_evidence/);
    // A DISENGAGED row needs no actor/reason, and a fully-evidenced ENGAGED row is accepted.
    await insertKillSwitchState({
      stateRowId: 'ks-disengaged',
      state: 'DISENGAGED',
      scopeRef: 'global-disengaged',
      reason: null,
      actorRef: null,
    });
    await insertKillSwitchState({
      stateRowId: 'ks-engaged',
      state: 'ENGAGED',
      scopeRef: 'global-engaged',
      reason: 'engaging after an incident',
      actorRef: 'admin@example.com',
    });
  });

  it('refuses a duplicate action idempotency key', async () => {
    await insertAllowedAudit('action-dup-1', 'idem-dup');
    await expect(insertAllowedAudit('action-dup-2', 'idem-dup')).rejects.toThrow(
      /admin_action_audit_idempotency_key_key|duplicate key/,
    );
  });

  it('refuses a preview whose precedence chain is out of §28.4 order', async () => {
    const insertPreview = (previewId: string, precedence: readonly string[]) =>
      engine.query(
        `INSERT INTO adm.resolved_config_previews
           (preview_id, config_version_id, precedence, resolved_config,
            resolved_hash, computed_at, expires_at)
         VALUES ($1, 'cfg-immutable-1', $2::jsonb, '{}'::jsonb, $3, $4, $5)`,
        [previewId, JSON.stringify(precedence), HASH, AT, LATER],
      );

    await insertPreview('preview-ordered', ['SYSTEM_DEFAULTS', 'WORKFLOW_VERSION']);
    await expect(
      insertPreview('preview-unordered', ['SCHEDULE_VERSION', 'WORKFLOW_VERSION']),
    ).rejects.toThrow(/precedence/);
    await expect(insertPreview('preview-empty', [])).rejects.toThrow(/precedence/);
  });

  it('refuses delete and truncate of append-only adm audit state', async () => {
    await engine.query(
      `INSERT INTO adm.kill_switch_events
         (event_id, switch_kind, from_state, to_state, scope, scope_hash, reason,
          actor_ref, step_up_ref, csrf_ref, idempotency_key, audit_ref, occurred_at)
       VALUES ('event-delete-me', 'DISABLE_ALL_AUTOMATION', 'DISENGAGED', 'ENGAGED',
               $1::jsonb, $2, 'engaging after an incident', 'admin@example.com',
               'proof-1', 'csrf-1', 'idem-delete-me', 'audit-1', $3)`,
      [JSON.stringify(SCOPE), HASH, AT],
    );
    await expect(engine.query(`DELETE FROM adm.kill_switch_events`)).rejects.toThrow(/append-only/);
    await expect(engine.query(`DELETE FROM adm.admin_action_audit`)).rejects.toThrow(/append-only/);
    await expect(engine.query(`TRUNCATE adm.overview_snapshots`)).rejects.toThrow(/immutable/);
  });
});

describe('adm failure typing', () => {
  it('a no-op transition is refused by SQL rather than silently recorded', async () => {
    let caught: unknown;
    try {
      await engine.query(
        `INSERT INTO adm.kill_switch_events
           (event_id, switch_kind, from_state, to_state, scope, scope_hash, reason,
            actor_ref, step_up_ref, csrf_ref, idempotency_key, audit_ref, occurred_at)
         VALUES ('event-noop', 'DISABLE_ALL_AUTOMATION', 'ENGAGED', 'ENGAGED', $1::jsonb, $2,
                 'reason', 'admin@example.com', 'proof-1', 'csrf-1', 'idem-noop', 'audit-1', $3)`,
        [JSON.stringify(SCOPE), HASH, AT],
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/state_change/);
  }, 120_000);
});
