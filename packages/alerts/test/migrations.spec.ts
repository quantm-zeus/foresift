/**
 * `alert`-family migration-shape suite (T011, FR-ALERT-001/004/005, AC-140, AC-141).
 *
 * Applies the whole migration set to a fresh PGlite database and proves the
 * SQL truth the alert layer will depend on:
 * - both `g2_alert_*` scripts apply cleanly, in order;
 * - `alert.alert_policies` immutability: exactly one legal transition
 *   (`superseded_by` NULL -> non-null with every other column identical),
 *   everything else — in-place policy rewrite (even combined with a
 *   legal-looking supersede), double supersede, NULL-out, DELETE, TRUNCATE — is
 *   refused;
 * - the ALERT-002 TTL law: a strictly positive whole TTL and an EARLY_WATCH TTL
 *   strictly shorter than the confirmed-opportunity default;
 * - the `(alert_class, version)` uniqueness guarantee;
 * - the update idempotency key is unique (a replayed update collapses);
 * - metric observations are class-scoped: a class-less observation, a
 *   cross-class metric key, and an out-of-range window are refused;
 * - no alert table exists unqualified in `public` (ADR-G2ALERT-1, AC-261 probe).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ALERT_CLASSES } from '@foresift/domain';
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

const ALERT_TABLES = [
  'alert_fingerprints',
  'alert_metric_observations',
  'alert_policies',
  'alert_records',
  'alert_updates',
] as const;

/** Every unqualified table name an alert family could accidentally create. */
const PUBLIC_LEAK_CANDIDATES = [
  'alert_policies',
  'alert_records',
  'alert_fingerprints',
  'alert_updates',
  'alert_metric_observations',
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

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  const report = await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
  applied = report.applied;
}, 120_000);

afterAll(async () => {
  await db.close();
});

/** Insert one immutable policy version pair; returns the ids and versions. */
async function seedPolicy(
  alertClass: string,
  ttlSeconds: number,
  tag: string,
): Promise<{
  policyId: string;
  nextPolicyId: string;
  version: number;
  nextVersion: number;
}> {
  seq += 1;
  const version = seq * 10 + 1;
  const nextVersion = seq * 10 + 2;
  const policyId = `policy-${tag}-${seq}`;
  const nextPolicyId = `policy-${tag}-${seq}-next`;
  await engine.query(
    `INSERT INTO alert.alert_policies
       (policy_id, alert_class, version, config_hash, config,
        ttl_seconds, cooldown_seconds, high_conviction_allowed,
        confirmed_denominator, thresholds)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, 300, false, false, '{}'::jsonb)`,
    [policyId, alertClass, version, HASH, ttlSeconds],
  );
  await engine.query(
    `INSERT INTO alert.alert_policies
       (policy_id, alert_class, version, config_hash, config,
        ttl_seconds, cooldown_seconds, high_conviction_allowed,
        confirmed_denominator, thresholds)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, 300, false, false, '{}'::jsonb)`,
    [nextPolicyId, alertClass, nextVersion, HASH_B, ttlSeconds],
  );
  return { policyId, nextPolicyId, version, nextVersion };
}

describe('g2_alert_* migrations apply to a fresh database', () => {
  it('applies both alert scripts in lexicographic order', () => {
    expect(applied).toContain('g2_alert_0001_alert_state');
    expect(applied).toContain('g2_alert_0002_updates_metrics');
    expect(applied.indexOf('g2_alert_0001_alert_state')).toBeLessThan(
      applied.indexOf('g2_alert_0002_updates_metrics'),
    );
  });

  it('creates every alert table in the alert schema and none in public', async () => {
    const rows = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'alert' ORDER BY table_name`,
    );
    expect(rows.rows.map((r) => r.table_name)).toEqual([...ALERT_TABLES]);

    const leaked = await engine.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [PUBLIC_LEAK_CANDIDATES],
    );
    expect(leaked.rows).toEqual([]);
  }, 120_000);
});

describe('§26.2 per-class policy versions are immutable except one supersede pointer', () => {
  it('allows exactly the NULL -> non-null supersede transition', async () => {
    const { policyId, nextPolicyId } = await seedPolicy('EARLY_WATCH', 900, 'supersede-ok');
    await engine.query(`UPDATE alert.alert_policies SET superseded_by = $1 WHERE policy_id = $2`, [
      nextPolicyId,
      policyId,
    ]);
    const rows = await engine.query<{ superseded_by: string | null }>(
      `SELECT superseded_by FROM alert.alert_policies WHERE policy_id = $1`,
      [policyId],
    );
    expect(rows.rows[0]?.superseded_by).toBe(nextPolicyId);
  }, 120_000);

  it('refuses an in-place policy rewrite', async () => {
    const { policyId } = await seedPolicy('CONFIRMED_OPPORTUNITY', 3600, 'rewrite');
    const error = await rejection(
      engine.query(`UPDATE alert.alert_policies SET ttl_seconds = 120 WHERE policy_id = $1`, [
        policyId,
      ]),
    );
    expect((error as { code?: string }).code).toBe('23001'); // restrict_violation
    expect(error.message).toMatch(/alert policy versions are immutable/);
  }, 120_000);

  it('refuses a policy rewrite combined with a legal-looking supersede', async () => {
    const { policyId, nextPolicyId } = await seedPolicy('RISK_ALERT', 7200, 'rewrite-supersede');
    const error = await rejection(
      engine.query(
        `UPDATE alert.alert_policies
            SET ttl_seconds = 120, superseded_by = $1
          WHERE policy_id = $2`,
        [nextPolicyId, policyId],
      ),
    );
    expect(error.message).toMatch(/alert policy versions are immutable/);
  }, 120_000);

  it('refuses re-pointing an already-set supersede pointer', async () => {
    const { policyId, nextPolicyId } = await seedPolicy('THESIS_WEAKENING', 1800, 'repoint');
    await engine.query(`UPDATE alert.alert_policies SET superseded_by = $1 WHERE policy_id = $2`, [
      nextPolicyId,
      policyId,
    ]);
    const error = await rejection(
      engine.query(
        `UPDATE alert.alert_policies SET superseded_by = 'policy-later' WHERE policy_id = $1`,
        [policyId],
      ),
    );
    expect(error.message).toMatch(/alert policy versions are immutable/);
  }, 120_000);

  it('refuses clearing a supersede pointer back to NULL', async () => {
    const { policyId } = await seedPolicy('THESIS_STRENGTHENING', 3600, 'null-out');
    const error = await rejection(
      engine.query(`UPDATE alert.alert_policies SET superseded_by = NULL WHERE policy_id = $1`, [
        policyId,
      ]),
    );
    expect(error.message).toMatch(/alert policy versions are immutable/);
  }, 120_000);

  it('refuses DELETE and TRUNCATE of a policy version row', async () => {
    const { policyId } = await seedPolicy('OPPORTUNITY_EXPIRED', 1800, 'delete');
    const deleted = await rejection(
      engine.query(`DELETE FROM alert.alert_policies WHERE policy_id = $1`, [policyId]),
    );
    expect(deleted.message).toMatch(/alert policy versions are immutable/);

    const truncated = await rejection(engine.query(`TRUNCATE alert.alert_policies CASCADE`));
    expect((truncated as { code?: string }).code).toBe('23001');
    expect(truncated.message).toMatch(/alert policy versions are immutable/);

    const survivors = await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alert.alert_policies`,
    );
    expect(Number(survivors.rows[0]?.n)).toBeGreaterThan(0);
  }, 120_000);

  it('refuses a duplicate (alert_class, version)', async () => {
    const { version } = await seedPolicy('EARLY_WATCH', 600, 'dup-version');
    const error = await rejection(
      engine.query(
        `INSERT INTO alert.alert_policies
           (policy_id, alert_class, version, config_hash, config,
            ttl_seconds, cooldown_seconds, high_conviction_allowed,
            confirmed_denominator, thresholds)
         VALUES ('policy-dup', 'EARLY_WATCH', $1, $2, '{}'::jsonb, 600, 300, false, false, '{}'::jsonb)`,
        [version, HASH],
      ),
    );
    expect(error.message).toMatch(/alert_policies_class_version_unique/);
  }, 120_000);

  it('refuses an unknown alert class and mirrors the domain vocabulary in SQL', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO alert.alert_policies
           (policy_id, alert_class, version, config_hash, config,
            ttl_seconds, cooldown_seconds, high_conviction_allowed,
            confirmed_denominator, thresholds)
         VALUES ('policy-bad-class', 'GUARANTEED_WIN', 1, $1, '{}'::jsonb, 600, 300, false, false, '{}'::jsonb)`,
        [HASH],
      ),
    );
    expect(error.message).toMatch(/alert_class/);

    const checks = await engine.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE contype = 'c'
         AND conrelid::regclass::text = 'alert.alert_policies'
         AND pg_get_constraintdef(oid) LIKE '%alert_class = ANY%'`,
    );
    const listed = new Set<string>();
    for (const { def } of checks.rows) {
      for (const match of def.matchAll(/'([A-Z][A-Z_]+)'/g)) {
        if (match[1] !== undefined) listed.add(match[1]);
      }
    }
    expect([...listed].sort()).toEqual([...ALL_ALERT_CLASSES].sort());
  }, 120_000);
});

describe('ALERT-002 TTL law is enforced in SQL', () => {
  it('refuses a non-positive TTL', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO alert.alert_policies
           (policy_id, alert_class, version, config_hash, config,
            ttl_seconds, cooldown_seconds, high_conviction_allowed,
            confirmed_denominator, thresholds)
         VALUES ('policy-zero-ttl', 'CONFIRMED_OPPORTUNITY', 1, $1, '{}'::jsonb, 0, 300, true, true, '{}'::jsonb)`,
        [HASH],
      ),
    );
    expect(error.message).toMatch(/ttl_seconds/);
  }, 120_000);

  it('refuses an EARLY_WATCH TTL that is not shorter than the confirmed default', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO alert.alert_policies
           (policy_id, alert_class, version, config_hash, config,
            ttl_seconds, cooldown_seconds, high_conviction_allowed,
            confirmed_denominator, thresholds)
         VALUES ('policy-long-watch', 'EARLY_WATCH', 1, $1, '{}'::jsonb, 3600, 300, false, false, '{}'::jsonb)`,
        [HASH],
      ),
    );
    expect(error.message).toMatch(/alert_policies_early_watch_short_ttl/);
  }, 120_000);
});

describe('§26.4 update notifications are idempotent under their key', () => {
  const insertUpdate = (updateId: string, idempotencyKey: string): Promise<unknown> =>
    engine.query(
      `INSERT INTO alert.alert_updates
         (update_id, prior_alert_ref, update_kind, fingerprint, idempotency_key, alert_ref)
       VALUES ($1, 'prior-alert-1', 'MATERIAL_DETERIORATION', $2, $3, 'alert-1')`,
      [updateId, HASH, idempotencyKey],
    );

  it('accepts one row and refuses a replayed idempotency key', async () => {
    await insertUpdate('update-1', 'update-key-1');
    const error = await rejection(insertUpdate('update-2', 'update-key-1'));
    expect(error.message).toMatch(/alert_updates_idempotency_unique/);
  }, 120_000);

  it('refuses an unknown update kind', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO alert.alert_updates
           (update_id, prior_alert_ref, update_kind, fingerprint, idempotency_key, alert_ref)
         VALUES ('update-bad-kind', 'prior-alert-1', 'PANIC', $1, 'update-key-2', 'alert-1')`,
        [HASH],
      ),
    );
    expect(error.message).toMatch(/update_kind/);
  }, 120_000);
});

describe('FR-ALERT-005 metric observations are class-scoped', () => {
  it('accepts a well-formed confirmed-opportunity observation', async () => {
    await engine.query(
      `INSERT INTO alert.alert_metric_observations
         (metric_id, alert_class, metric_key, numerator, denominator, sample_size,
          window_start, window_end)
       VALUES ('metric-ok', 'CONFIRMED_OPPORTUNITY', 'CONFIRMED_PRECISION', 3, 10, 10,
               '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
    );
    const rows = await engine.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alert.alert_metric_observations WHERE metric_id = 'metric-ok'`,
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  }, 120_000);

  it('refuses a class-less metric observation', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO alert.alert_metric_observations
           (metric_id, metric_key, numerator, denominator, sample_size,
            window_start, window_end)
         VALUES ('metric-classless', 'CONFIRMED_PRECISION', 3, 10, 10,
                 '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
      ),
    );
    expect(error.message).toMatch(/alert_class/);
  }, 120_000);

  it('refuses a cross-class metric key (EARLY_WATCH pooled into confirmed precision)', async () => {
    const error = await rejection(
      engine.query(
        `INSERT INTO alert.alert_metric_observations
           (metric_id, alert_class, metric_key, numerator, denominator, sample_size,
            window_start, window_end)
         VALUES ('metric-cross-class', 'EARLY_WATCH', 'CONFIRMED_PRECISION', 3, 10, 10,
                 '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
      ),
    );
    expect(error.message).toMatch(/alert_metric_observations_class_scope/);
  }, 120_000);

  it('refuses a numerator larger than its denominator and an inverted window', async () => {
    const numerator = await rejection(
      engine.query(
        `INSERT INTO alert.alert_metric_observations
           (metric_id, alert_class, metric_key, numerator, denominator, sample_size,
            window_start, window_end)
         VALUES ('metric-numerator', 'RISK_ALERT', 'RISK_PRECISION', 11, 10, 10,
                 '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
      ),
    );
    expect(numerator.message).toMatch(/numerator_within_denominator/);

    const window = await rejection(
      engine.query(
        `INSERT INTO alert.alert_metric_observations
           (metric_id, alert_class, metric_key, numerator, denominator, sample_size,
            window_start, window_end)
         VALUES ('metric-window', 'RISK_ALERT', 'RISK_RECALL', 1, 10, 10,
                 '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      ),
    );
    expect(window.message).toMatch(/window_order/);
  }, 120_000);
});

describe('§26.4 alert records carry a content-addressed fingerprint', () => {
  it('refuses a malformed fingerprint and a missing run ref', async () => {
    const badHash = await rejection(
      engine.query(
        `INSERT INTO alert.alert_records
           (alert_id, decision_ref, run_ref, alert_class, fingerprint, thesis_version,
            lifecycle_state, risk_state, severity, actionability_state, valid_until,
            execution_assumptions, evidence_refs, content_hash)
         VALUES ('record-bad-hash', 'decision-1', 'run-1', 'EARLY_WATCH', 'not-a-hash', 1,
                 'EMERGING', 'LOW', 0.4, 'ACTIONABLE', '2026-01-01T00:15:00Z',
                 '{}'::jsonb, '[]'::jsonb, $1)`,
        [HASH],
      ),
    );
    expect(badHash.message).toMatch(/fingerprint/);

    const missingRun = await rejection(
      engine.query(
        `INSERT INTO alert.alert_records
           (alert_id, decision_ref, alert_class, fingerprint, thesis_version,
            lifecycle_state, risk_state, severity, actionability_state, valid_until,
            execution_assumptions, evidence_refs, content_hash)
         VALUES ('record-no-run', 'decision-1', 'EARLY_WATCH', $1, 1,
                 'EMERGING', 'LOW', 0.4, 'ACTIONABLE', '2026-01-01T00:15:00Z',
                 '{}'::jsonb, '[]'::jsonb, $1)`,
        [HASH],
      ),
    );
    expect(missingRun.message).toMatch(/run_ref/);
  }, 120_000);
});
