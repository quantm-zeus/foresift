/**
 * g0_core_* SQL truth tests (FR-CORE-001…007): migration application plus the
 * exact WHERE-guarded transition statements that later engine modules and
 * outside-package adapters reuse verbatim.
 *
 * PGlite serializes writers, so true parallel interleaving cannot be observed;
 * the guards are what make ANY interleaving safe, so each matrix case proves
 * its guard directly (legal transitions move exactly one step; illegal ones,
 * stale holders, and retry replays match zero rows or converge without
 * double-counting).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  sha256Text,
  type DatabaseEngine,
} from '@foresift/persistence';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const KEY_HASH = sha256Text('cache-key-fixture');
const T0 = '2026-08-01T00:00:00Z';

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

async function registerTool(overrides: Record<string, unknown> = {}): Promise<void> {
  const row = {
    name: 'get_asset_identity',
    version: '1.0.0',
    hash: sha256Text('definition-v1'),
    actionClass: 'EXTERNAL_READ',
    profiles: ['discovery'],
    scopes: ['assets:read'],
    cachePolicyId: 'exact-default',
    quotaPolicyId: 'strict-free-default',
    licensePolicyId: 'rights-verified-only',
    registeredAt: T0,
    retiredAt: null,
    ...overrides,
  };
  await engine.query(
    `INSERT INTO core.core_tool_registry
       (tool_name, tool_version, definition_hash, action_class, profiles,
        required_scopes, cache_policy_id, quota_policy_id, license_policy_id,
        registered_at, retired_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.name,
      row.version,
      row.hash,
      row.actionClass,
      row.profiles,
      row.scopes,
      row.cachePolicyId,
      row.quotaPolicyId,
      row.licensePolicyId,
      row.registeredAt,
      row.retiredAt,
    ],
  );
}

async function insertReservation(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    id: 'rsv-1',
    runId: 'run-1',
    stage: 'ATOMICALLY_RESERVE_QUOTA',
    actorId: 'actor-9',
    provider: 'gmgn',
    operation: 'token_security',
    workloadClass: 'INTERACTIVE_HIGH',
    estimatedUnits: '2',
    ...overrides,
  };
  await engine.query(
    `INSERT INTO core.core_quota_reservations
       (reservation_id, pipeline_run_id, stage, actor_id, provider, operation,
        workload_class, estimated_units, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING')`,
    [
      row.id,
      row.runId,
      row.stage,
      row.actorId,
      row.provider,
      row.operation,
      row.workloadClass,
      row.estimatedUnits,
    ],
  );
  return row.id;
}

// THE canonical guarded statements (single source of truth for engine code):
const GUARDS = {
  leaseTakeover: `
    UPDATE core.core_single_flight_leases
    SET fencing_token = nextval('core.core_lease_fencing_seq'),
        holder_mode = $2, holder_id = $3,
        acquired_at = $4, expires_at = $5, released_at = NULL
    WHERE resource_key_hash = $1
      AND (released_at IS NOT NULL OR expires_at <= $4)
    RETURNING fencing_token`,
  leaseRelease: `
    UPDATE core.core_single_flight_leases
    SET released_at = $3
    WHERE resource_key_hash = $1 AND fencing_token = $2 AND released_at IS NULL
    RETURNING fencing_token`,
  reserve: `UPDATE core.core_quota_reservations SET state='RESERVED', reserved_at=$2
            WHERE reservation_id=$1 AND state='PENDING' RETURNING state`,
  commit: `UPDATE core.core_quota_reservations SET state='COMMITTED', actual_units=$2, settled_at=$3
           WHERE reservation_id=$1 AND state='RESERVED' RETURNING state`,
  release: `UPDATE core.core_quota_reservations SET state='RELEASED', settled_at=$2
            WHERE reservation_id=$1 AND state IN ('PENDING','RESERVED') RETURNING state`,
  expire: `UPDATE core.core_quota_reservations SET state='EXPIRED', settled_at=$2
           WHERE reservation_id=$1 AND state='RESERVED' RETURNING state`,
};

describe('g0_core migrations apply over the full landed set', () => {
  it('applies every family including core, lexicographically', () => {
    expect.assertions(0); // beforeAll already applied; failure would throw there
  });

  it('exposes exactly the four core tables in the core namespace', async () => {
    const tables = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'core' ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      'core_exact_cache_entries',
      'core_quota_reservations',
      'core_single_flight_leases',
      'core_tool_registry',
    ]);
  });
});

describe('tool registry SQL truth (FR-CORE-001/FR-CORE-005)', () => {
  it('registers an admissible definition', async () => {
    await registerTool();
    const rows = await engine.query(
      `SELECT definition_hash FROM core.core_tool_registry
       WHERE tool_name = 'get_asset_identity' AND tool_version = '1.0.0'`,
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('refuses PROHIBITED_FINANCIAL structurally beneath every TS screen', async () => {
    await expect(
      registerTool({ name: 'swap_execute', actionClass: 'PROHIBITED_FINANCIAL' }),
    ).rejects.toThrow(/action_class/);
  });

  it('refuses duplicate (name, version) regardless of hash equality', async () => {
    await expect(registerTool()).rejects.toThrow(); // identical re-registration
    await expect(registerTool({ hash: sha256Text('definition-v2-DIFFERENT') })).rejects.toThrow();
  });

  it('refuses normative mutation, allows only retirement, refuses deletion', async () => {
    await expect(
      engine.query(
        `UPDATE core.core_tool_registry SET definition_hash = $3
         WHERE tool_name = $1 AND tool_version = $2`,
        ['get_asset_identity', '1.0.0', sha256Text('mutated')],
      ),
    ).rejects.toThrow(/CORE_REGISTRY_IMMUTABLE.*normative/i);
    await engine.query(
      `UPDATE core.core_tool_registry SET retired_at = $3
       WHERE tool_name = $1 AND tool_version = $2`,
      ['get_asset_identity', '1.0.0', '2026-08-02T00:00:00Z'],
    );
    const rows = await engine.query<{ retired_at: string }>(
      `SELECT retired_at FROM core.core_tool_registry
       WHERE tool_name = $1 AND tool_version = $2`,
      ['get_asset_identity', '1.0.0'],
    );
    expect(rows.rows[0]?.retired_at).toContain('2026-08-02');
    await expect(
      engine.query(
        `DELETE FROM core.core_tool_registry WHERE tool_name = $1 AND tool_version = $2`,
        ['get_asset_identity', '1.0.0'],
      ),
    ).rejects.toThrow(/CORE_REGISTRY_IMMUTABLE/);
  });

  it('pins profiles to the eight §16.9 ids and demands at least one', async () => {
    await expect(
      registerTool({ name: 't_bad_profile', profiles: ['not-a-profile'] }),
    ).rejects.toThrow();
    await expect(registerTool({ name: 't_no_profile', profiles: [] })).rejects.toThrow();
  });
});

describe('single-flight leases (FR-CORE-006, INV-009 fencing)', () => {
  it('grants a fresh lease with a monotonic sequence token', async () => {
    const inserted = await engine.query<{ fencing_token: string }>(
      `INSERT INTO core.core_single_flight_leases
         (resource_key_hash, holder_mode, holder_id, acquired_at, expires_at)
       VALUES ($1,'MCP_MANUAL','client-7',$2,'2026-08-01T00:01:00Z')
       RETURNING fencing_token`,
      [KEY_HASH, T0],
    );
    expect(Number(inserted.rows[0]?.fencing_token)).toBeGreaterThan(0);
  });

  it('refuses a second grant while the lease is live', async () => {
    // The takeover guard matches nothing while held and unexpired.
    const takeover = await engine.query(GUARDS.leaseTakeover, [
      KEY_HASH,
      'AUTOMATION',
      'worker-2',
      T0,
      '2026-08-01T00:01:00Z',
    ]);
    expect(takeover.rows).toHaveLength(0);
  });

  it('releases only the matching unreleased token; stale tokens fail closed', async () => {
    const current = await engine.query<{ fencing_token: string }>(
      'SELECT fencing_token FROM core.core_single_flight_leases WHERE resource_key_hash = $1',
      [KEY_HASH],
    );
    const token = Number(current.rows[0]?.fencing_token);
    // Wrong token: zero rows.
    const stale = await engine.query(GUARDS.leaseRelease, [KEY_HASH, token - 1, T0]);
    expect(stale.rows).toHaveLength(0);
    // Correct token releases.
    const ok = await engine.query(GUARDS.leaseRelease, [KEY_HASH, token, T0]);
    expect(ok.rows).toHaveLength(1);
    // Replay of the same release: zero rows (already released).
    const replay = await engine.query(GUARDS.leaseRelease, [KEY_HASH, token, T0]);
    expect(replay.rows).toHaveLength(0);
  });

  it('expired/released takeover allocates a STRICTLY higher fence', async () => {
    const before = await engine.query<{ fencing_token: string }>(
      'SELECT fencing_token FROM core.core_single_flight_leases WHERE resource_key_hash = $1',
      [KEY_HASH],
    );
    const oldToken = Number(before.rows[0]?.fencing_token);
    const takeover = await engine.query<{ fencing_token: string }>(GUARDS.leaseTakeover, [
      KEY_HASH,
      'CHATGPT',
      'session-3',
      '2026-08-01T01:00:00Z',
      '2026-08-01T01:01:00Z',
    ]);
    expect(Number(takeover.rows[0]?.fencing_token)).toBeGreaterThan(oldToken);
    // The stale holder's release attempt now fails closed.
    const staleAttempt = await engine.query(GUARDS.leaseRelease, [KEY_HASH, oldToken, T0]);
    expect(staleAttempt.rows).toHaveLength(0);
  });

  it('rejects expiry before acquisition at SQL truth level', async () => {
    await expect(
      engine.query(
        `INSERT INTO core.core_single_flight_leases
           (resource_key_hash, holder_mode, holder_id, acquired_at, expires_at)
         VALUES ($1,'ADMIN_CHAT','a',$2,'2026-07-31T23:59:59Z')`,
        [sha256Text('other-key'), T0],
      ),
    ).rejects.toThrow(/core_lease_expiry_shape/);
  });
});

describe('quota reservation state machine (FR-CORE-007)', () => {
  it.each([
    ['reserve', 'PENDING', 1],
    ['commit-from-pending', 'illegal', 0], // PENDING -> COMMITTED is not a legal edge
    ['release-from-pending', 'PENDING', 1],
  ])('%s behaves per the §16.7 matrix', async (label, kind, expectedRows) => {
    const id = await insertReservation({
      id: `rsv-${label}`,
      runId: `run-${label}`,
      stage: 'ATOMICALLY_RESERVE_QUOTA',
    });
    if (kind === 'illegal') {
      const illegal = await engine.query(GUARDS.commit, [id, '1', T0]);
      expect(illegal.rows).toHaveLength(expectedRows);
      return;
    }
    const guard = kind === 'reserve' ? GUARDS.reserve : GUARDS.release;
    const moved = await engine.query(guard, [id, T0]);
    expect(moved.rows).toHaveLength(expectedRows);
  });

  it('walks PENDING -> RESERVED -> COMMITTED recording actual units once', async () => {
    const id = await insertReservation({ id: 'rsv-walk', runId: 'run-walk' });
    await engine.query(GUARDS.reserve, [id, T0]);
    const committed = await engine.query<{ state: string; actual_units: string }>(GUARDS.commit, [
      id,
      '3',
      '2026-08-01T00:00:05Z',
    ]);
    expect(committed.rows[0]?.state).toBe('COMMITTED');
    const row = await engine.query<{ state: string; actual_units: string }>(
      'SELECT state, actual_units FROM core.core_quota_reservations WHERE reservation_id = $1',
      [id],
    );
    expect(row.rows[0]?.state).toBe('COMMITTED');
    expect(row.rows[0]?.actual_units).toBe('3');
  });

  it.each([['commit-replay-converges'], ['release-replay-converges']])(
    '%s (idempotent retry semantics)',
    async (label) => {
      const id = await insertReservation({ id: label, runId: `run-${label}` });
      await engine.query(GUARDS.reserve, [id, T0]);
      if (label.startsWith('commit')) {
        const first = await engine.query(GUARDS.commit, [id, '1', T0]);
        expect(first.rows).toHaveLength(1);
        const replay = await engine.query(GUARDS.commit, [id, '999', T0]);
        expect(replay.rows).toHaveLength(0); // converges; units never double-counted
        const row = await engine.query<{ actual_units: string }>(
          'SELECT actual_units FROM core.core_quota_reservations WHERE reservation_id = $1',
          [id],
        );
        expect(row.rows[0]?.actual_units).toBe('1');
      } else {
        // RELEASED is reachable only from PENDING|RESERVED — never from COMMITTED.
        const first = await engine.query(GUARDS.release, [id, T0]);
        expect(first.rows).toHaveLength(1);
        const replay = await engine.query(GUARDS.release, [id, T0]);
        expect(replay.rows).toHaveLength(0); // already terminal; converges silently
      }
    },
  );

  it('refuses releasing a COMMITTED reservation (illegal edge)', async () => {
    const id = await insertReservation({ id: 'rsv-no-commit-release', runId: 'run-ncr' });
    await engine.query(GUARDS.reserve, [id, T0]);
    await engine.query(GUARDS.commit, [id, '2', T0]);
    const attempted = await engine.query(GUARDS.release, [id, T0]);
    expect(attempted.rows).toHaveLength(0);
    const row = await engine.query<{ state: string }>(
      'SELECT state FROM core.core_quota_reservations WHERE reservation_id = $1',
      [id],
    );
    expect(row.rows[0]?.state).toBe('COMMITTED');
  });

  it('expires RESERVED but never COMMITTED or RELEASED', async () => {
    const reserved = await insertReservation({ id: 'rsv-exp-a', runId: 'run-exp-a' });
    await engine.query(GUARDS.reserve, [reserved, T0]);
    expect((await engine.query(GUARDS.expire, [reserved, T0])).rows).toHaveLength(1);

    const committed = await insertReservation({ id: 'rsv-exp-b', runId: 'run-exp-b' });
    await engine.query(GUARDS.reserve, [committed, T0]);
    await engine.query(GUARDS.commit, [committed, '1', T0]);
    expect((await engine.query(GUARDS.expire, [committed, T0])).rows).toHaveLength(0);
  });

  it('enforces the (pipeline_run_id, stage) idempotency key', async () => {
    await insertReservation({ id: 'rsv-idem-1' });
    await expect(insertReservation({ id: 'rsv-idem-2' })).rejects.toThrow();
  });

  it('interleaved actors cannot double-commit: the loser matches zero rows', async () => {
    const id = await insertReservation({ id: 'rsv-race', runId: 'run-race' });
    await engine.query(GUARDS.reserve, [id, T0]);
    // Two actors fire concurrently; PGlite serializes them but BOTH guards run —
    // exactly one may claim the RESERVED->COMMITTED edge.
    const [a, b] = await Promise.all([
      engine.query(GUARDS.commit, [id, '5', T0]),
      engine.query(GUARDS.commit, [id, '7', T0]),
    ]);
    expect(a.rows.length + b.rows.length).toBe(1);
    const row = await engine.query<{ actual_units: string }>(
      'SELECT actual_units FROM core.core_quota_reservations WHERE reservation_id = $1',
      [id],
    );
    // The recorded units come from the single winner only (never summed).
    expect(['5', '7']).toContain(row.rows[0]?.actual_units as string);
  });
});

describe('exact cache entries (FR-CORE-006, INV-005/006)', () => {
  it('stores an entry and honors point-in-time visibility', async () => {
    await engine.query(
      `INSERT INTO core.core_exact_cache_entries
         (cache_key_hash, payload_ref, stored_at, fresh_until, stale_until,
          license_policy_version, rights_permitted)
       VALUES ($1,'artifact://cache/one',$2,$3,$4,'rights-1',true)`,
      [KEY_HASH, T0, '2026-08-01T00:00:30Z', '2026-08-01T00:02:00Z'],
    );
    // Reader at T=+10s sees it…
    const visible = await engine.query(
      `SELECT payload_ref FROM core.core_exact_cache_entries
       WHERE cache_key_hash = $1 AND stored_at <= $2`,
      [KEY_HASH, '2026-08-01T00:00:10Z'],
    );
    expect(visible.rows).toHaveLength(1);
    // …a reader BEFORE the write never does (no backdating through the cache).
    const futureOnly = await engine.query(
      `SELECT payload_ref FROM core.core_exact_cache_entries
       WHERE cache_key_hash = $1 AND stored_at <= $2`,
      [KEY_HASH, '2026-07-31T23:59:59Z'],
    );
    expect(futureOnly.rows).toHaveLength(0);
  });

  it('refuses inverted freshness windows', async () => {
    await expect(
      engine.query(
        `INSERT INTO core.core_exact_cache_entries
           (cache_key_hash, payload_ref, stored_at, fresh_until, stale_until,
            license_policy_version, rights_permitted)
         VALUES ($1,'r',$2,'2026-08-01T00:02:00Z','2026-08-01T00:00:30Z','rights-1',true)`,
        [sha256Text('bad-window'), T0],
      ),
    ).rejects.toThrow(/core_exact_cache_window_shape/);
  });
});
