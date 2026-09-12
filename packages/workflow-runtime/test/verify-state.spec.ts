/**
 * Read-only state verification suite (T026, T025 recovery seam; PRD §34,
 * AC-062/AC-260…264). Runs on PGlite.
 *
 * Proven here: every documented check returns a zero finding on a consistent
 * state, returns the expected finding on a seeded inconsistent state, and the
 * documented check list names only `wf`-qualified tables.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  WF_STATE_CHECKS,
  findOpenDeadLetters,
  runAllWfStateChecks,
  runWfStateCheck,
  type WfStateCheckName,
} from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';
import { seedInbox, seedOutboxRow, seedRun } from './lifecycle-fixtures.ts';

const T0 = '2026-06-01T12:00:00.000Z';
const ONE_HOUR = 60 * 60 * 1000;
const TWO_HOURS = 2 * ONE_HOUR;
const EARLIER = new Date(Date.parse(T0) - ONE_HOUR).toISOString();
const MUCH_EARLIER = new Date(Date.parse(T0) - TWO_HOURS).toISOString();
const LATER = new Date(Date.parse(T0) + ONE_HOUR).toISOString();

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('workflow state verification (T025 recovery seam)', () => {
  it('documents only wf-qualified tables for every check', () => {
    expect(WF_STATE_CHECKS.length).toBe(5);
    for (const check of WF_STATE_CHECKS) {
      expect(check.tables.length).toBeGreaterThan(0);
      for (const table of check.tables) expect(table.startsWith('wf.')).toBe(true);
    }
    expect(WF_STATE_CHECKS.map((c) => c.name)).toEqual([
      'orphaned_outbox_claims',
      'unprocessed_trigger_inbox',
      'outbox_lag',
      'dead_letter_backlog',
      'orphaned_step_leases',
    ]);
  });

  it('returns no finding on a consistent state', async () => {
    const run = await seedRun(tdb.engine, { receivedAt: T0 });
    // A recent inbox row and a recent PENDING outbox row are healthy.
    expect(run.inboxId.length).toBeGreaterThan(0);
    await seedOutboxRow(tdb.engine, {
      outboxId: 'outbox-consistent-pending',
      runId: run.runId,
      status: 'PENDING',
      enqueuedAt: T0,
    });
    // A live (unexpired, unreleased) step lease is healthy.
    await tdb.engine.query(
      `INSERT INTO wf.step_leases (resource_key, owner, acquired_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      ['lease-live', 'worker-live', T0, LATER],
    );

    const findings = await runAllWfStateChecks(tdb.engine, {
      now: T0,
      inboxMaxAgeMs: 5 * 60 * 1000,
      outboxMaxLagMs: 5 * 60 * 1000,
    });
    for (const finding of findings) {
      expect(finding.ok, `${finding.check} should be ok: ${JSON.stringify(finding.detail)}`).toBe(
        true,
      );
      expect(finding.count).toBe(0);
    }
  });

  it('finds every seeded inconsistency', async () => {
    const run = await seedRun(tdb.engine, { receivedAt: T0 });
    // 1. Orphaned outbox claim (CLAIMED past expiry), enqueued long ago so the
    //    lag check is exercised by a separate PENDING row below.
    await seedOutboxRow(tdb.engine, {
      outboxId: 'outbox-orphaned-claim',
      runId: run.runId,
      status: 'CLAIMED',
      claimOwner: 'worker-crashed',
      claimFencingToken: 42,
      claimExpiresAt: EARLIER,
      enqueuedAt: EARLIER,
    });
    // 2. Unprocessed inbox row older than the threshold.
    const staleInbox = await seedInbox(tdb.engine, run.scheduleId, { receivedAt: EARLIER });
    // 3. Outbox lag: PENDING row older than the threshold.
    await seedOutboxRow(tdb.engine, {
      outboxId: 'outbox-lagging',
      runId: run.runId,
      status: 'PENDING',
      enqueuedAt: EARLIER,
    });
    // 4. OPEN dead letter.
    await tdb.engine.query(
      `INSERT INTO wf.dead_letters
         (dead_letter_id, run_id, error_class, context, status, opened_at)
       VALUES ($1, $2, 'TIMEOUT_OR_5XX', '{"attempts":5,"reason":"exhausted"}'::jsonb, 'OPEN', $3)`,
      ['dead-letter-backlog', run.runId, EARLIER],
    );
    // 5. Orphaned step lease (unreleased past expiry).
    await tdb.engine.query(
      `INSERT INTO wf.step_leases (resource_key, owner, acquired_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      ['lease-orphaned', 'worker-gone', MUCH_EARLIER, EARLIER],
    );

    const findings = await runAllWfStateChecks(tdb.engine, {
      now: T0,
      inboxMaxAgeMs: 5 * 60 * 1000,
      outboxMaxLagMs: 5 * 60 * 1000,
    });
    const byName = new Map(findings.map((f) => [f.check, f]));
    for (const finding of findings) {
      expect(finding.ok, `${finding.check} should report a finding`).toBe(false);
      expect(finding.count).toBeGreaterThanOrEqual(1);
    }
    expect(String(JSON.stringify(byName.get('orphaned_outbox_claims')?.detail))).toContain(
      'outbox-orphaned-claim',
    );
    expect(String(JSON.stringify(byName.get('unprocessed_trigger_inbox')?.detail))).toContain(
      staleInbox,
    );
    expect(String(JSON.stringify(byName.get('outbox_lag')?.detail))).toContain('outbox-lagging');
    expect(String(JSON.stringify(byName.get('dead_letter_backlog')?.detail))).toContain(
      'dead-letter-backlog',
    );
    expect(String(JSON.stringify(byName.get('orphaned_step_leases')?.detail))).toContain(
      'lease-orphaned',
    );

    const openDeadLetters = await findOpenDeadLetters(tdb.engine, { limit: 10 });
    expect(openDeadLetters.map((d) => d.deadLetterId)).toContain('dead-letter-backlog');

    const single = await runWfStateCheck(tdb.engine, 'outbox_lag', {
      now: T0,
      outboxMaxLagMs: 5 * 60 * 1000,
    });
    expect(single.check).toBe('outbox_lag');
    expect(single.ok).toBe(false);
    expect(single.tables).toEqual(['wf.notification_outbox']);
  });

  it('refuses an unknown check name', async () => {
    await expectForesiftError(
      runWfStateCheck(tdb.engine, 'not_a_check' as WfStateCheckName, { now: T0 }),
      ErrorCode.WF_STATE_CHECK_UNKNOWN,
    );
  });
});
