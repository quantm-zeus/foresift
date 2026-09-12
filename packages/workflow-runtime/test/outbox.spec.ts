/**
 * Transactional outbox suite (T026, FR-WF-006/FR-WF-008, AC-011, AC-061;
 * PRD §26.5). Runs on a real SQL engine (PGlite) with the deterministic
 * `FakeNotificationChannel`.
 *
 * Proven here:
 * - the decision + alert + outbox commit is atomic (an outbox failure rolls the
 *   decision and alert rows back);
 * - claim -> crash before send -> lease expiry -> re-claim -> exactly one
 *   channel send;
 * - crash AFTER the channel accepted the send but BEFORE the SENT mark still
 *   yields exactly one unique delivery (channel idempotency);
 * - a stale claim refuses to send;
 * - a provider outage suppresses delivery while preserving the decision;
 * - a shadow run tags SUPPRESSED_SHADOW and a delivery attempt is refused.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
import {
  FakeNotificationChannel,
  OutboxCommitOutcome,
  assertNoOpportunityInfluence,
  claimOutboxBatch,
  commitDecisionWithOutbox,
  deliverClaimed,
  type OutboxClaim,
} from '../src/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from './helpers.ts';
import { LIFECYCLE_HASH_A, seedRun } from './lifecycle-fixtures.ts';

const T0 = '2026-06-01T12:00:00.000Z';
const T1 = '2026-06-01T12:00:30.000Z';
const LEASE_MS = 5_000;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

async function commit(
  runId: string,
  suffix: string,
  options: {
    readonly outboxId?: string;
    readonly outcome?: OutboxCommitOutcome;
    readonly influence?: 'OPPORTUNITY_NOTIFICATION' | 'POLICY_WRITE_BACK';
  } = {},
): Promise<Awaited<ReturnType<typeof commitDecisionWithOutbox>>> {
  return commitDecisionWithOutbox(tdb.engine, {
    runId,
    decision: {
      decisionId: `decision-${suffix}`,
      decisionKind: 'CANDIDATE_DECISION',
      payload: { decisionId: `decision-${suffix}`, verdict: 'NO_ACTION', confidence: 0.4 },
    },
    alert: {
      alertId: `alert-${suffix}`,
      alertClass: 'EARLY_WATCH',
      payload: { alertId: `alert-${suffix}`, headline: 'watch', ttlSeconds: 3600 },
    },
    outbox: {
      channel: 'admin-inbox',
      ...(options.outboxId === undefined ? {} : { outboxId: options.outboxId }),
    },
    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
    ...(options.influence === undefined ? {} : { influence: options.influence }),
    now: T0,
  });
}

describe('§26.5 atomic commit boundary (AC-011, AC-061)', () => {
  it('rolls the decision and alert back when the outbox insert fails', async () => {
    const { runId } = await seedRun(tdb.engine);
    const first = await commit(runId, 'rollback-first', { outboxId: 'outbox-rollback-duplicate' });
    expect(first.status).toBe('PENDING');

    // A second commit reusing the outbox primary key fails INSIDE the
    // transaction, so its own decision/alert rows must not survive.
    const { runId: secondRunId } = await seedRun(tdb.engine);
    await expect(
      commit(secondRunId, 'rollback-second', { outboxId: 'outbox-rollback-duplicate' }),
    ).rejects.toThrow();

    const decisions = await tdb.engine.query<{ count: string }>(
      `SELECT count(*) AS count FROM wf.decision_commits WHERE decision_id = $1`,
      ['decision-rollback-second'],
    );
    const alerts = await tdb.engine.query<{ count: string }>(
      `SELECT count(*) AS count FROM wf.alert_records WHERE alert_id = $1`,
      ['alert-rollback-second'],
    );
    expect(Number(decisions.rows[0]?.count)).toBe(0);
    expect(Number(alerts.rows[0]?.count)).toBe(0);
    // The first, successful commit is untouched.
    const survivor = await tdb.engine.query(
      `SELECT decision_id FROM wf.decision_commits WHERE decision_id = $1`,
      ['decision-rollback-first'],
    );
    expect(survivor.rows).toHaveLength(1);
  });

  it('routes a provider outage to SUPPRESSED_OUTAGE and preserves the decision', async () => {
    const { runId } = await seedRun(tdb.engine);
    const result = await commit(runId, 'outage', {
      outcome: OutboxCommitOutcome.PROVIDER_OUTAGE,
    });
    expect(result.status).toBe('SUPPRESSED_OUTAGE');
    expect(result.suppressed).toBe(true);

    const decision = await tdb.engine.query(
      `SELECT decision_id FROM wf.decision_commits WHERE decision_id = $1`,
      ['decision-outage'],
    );
    const alert = await tdb.engine.query(
      `SELECT alert_id FROM wf.alert_records WHERE alert_id = $1`,
      ['alert-outage'],
    );
    expect(decision.rows).toHaveLength(1);
    expect(alert.rows).toHaveLength(1);

    // Suppressed rows are never claimable and are refused at the send gate.
    const claims = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-outage',
      now: T0,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    expect(claims.map((c) => c.outboxId)).not.toContain(result.outboxId);
    const channel = new FakeNotificationChannel();
    const delivery = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-outage',
      now: T0,
      claims: [manualClaim(result.outboxId)],
    });
    expect(delivery.refusedSuppressed).toEqual([result.outboxId]);
    expect(channel.callCount).toBe(0);
  });

  it('tags a shadow run SUPPRESSED_SHADOW and refuses a delivery attempt', async () => {
    const { runId } = await seedRun(tdb.engine, { shadow: true });
    const result = await commit(runId, 'shadow');
    expect(result.status).toBe('SUPPRESSED_SHADOW');
    expect(result.suppressed).toBe(true);

    const decision = await tdb.engine.query(
      `SELECT decision_id FROM wf.decision_commits WHERE decision_id = $1`,
      ['decision-shadow'],
    );
    expect(decision.rows).toHaveLength(1);

    const claims = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-shadow',
      now: T0,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    expect(claims.map((c) => c.outboxId)).not.toContain(result.outboxId);

    const channel = new FakeNotificationChannel();
    const delivery = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-shadow',
      now: T0,
      claims: [manualClaim(result.outboxId)],
    });
    expect(delivery.refusedSuppressed).toEqual([result.outboxId]);
    expect(channel.callCount).toBe(0);
  });

  it('refuses a shadow policy write-back through the choke point', async () => {
    const { runId } = await seedRun(tdb.engine, { shadow: true });
    await expectForesiftError(
      commit(runId, 'shadow-policy', { influence: 'POLICY_WRITE_BACK' }),
      ErrorCode.WF_SHADOW_INFLUENCE_REFUSED,
    );
    // Evidence reads are always permitted for shadow runs.
    expect(() =>
      assertNoOpportunityInfluence({ runId, shadow: true }, 'EVIDENCE_READ'),
    ).not.toThrow();
    expect(() =>
      assertNoOpportunityInfluence({ runId, shadow: true }, 'OPPORTUNITY_NOTIFICATION'),
    ).toThrow();
  });
});

/** Build a claim with an arbitrary token for suppressed/stale assertions. */
function manualClaim(outboxId: string, fencingToken = 1): OutboxClaim {
  return {
    outboxId,
    decisionRef: `decision-${outboxId}`,
    alertRef: null,
    channel: 'admin-inbox',
    payloadHash: LIFECYCLE_HASH_A,
    fencingToken,
    claimedAt: T0,
    claimExpiresAt: T1,
    attempts: 0,
    enqueuedAt: T0,
  };
}

describe('§26.5 crash-safe delivery (AC-011)', () => {
  it('re-claims an orphaned claim after lease expiry and sends exactly once', async () => {
    const { runId } = await seedRun(tdb.engine);
    const committed = await commit(runId, 'crash-before-send');

    const first = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-a',
      now: T0,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const mine = first.find((c) => c.outboxId === committed.outboxId);
    expect(mine).toBeDefined();
    // worker-a "crashes" before sending: nothing is delivered.
    const channel = new FakeNotificationChannel();
    expect(channel.callCount).toBe(0);

    const second = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-b',
      now: '2026-06-01T12:00:10.000Z',
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const reclaimed = second.find((c) => c.outboxId === committed.outboxId);
    expect(reclaimed).toBeDefined();
    expect(reclaimed?.fencingToken).toBeGreaterThan(mine?.fencingToken ?? 0);

    const delivery = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-b',
      now: '2026-06-01T12:00:10.000Z',
      claims: [reclaimed!],
    });
    expect(delivery.sent).toEqual([committed.outboxId]);
    expect(channel.deliveryCount).toBe(1);
    const row = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(row.rows[0]?.status).toBe('SENT');
  });

  it('keeps exactly one unique delivery when the worker crashes after the send', async () => {
    const { runId } = await seedRun(tdb.engine);
    const committed = await commit(runId, 'crash-after-send');

    const claims = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-a',
      now: T0,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const mine = claims.find((c) => c.outboxId === committed.outboxId);
    expect(mine).toBeDefined();

    const channel = new FakeNotificationChannel();
    channel.crashAfter(1);
    await expectForesiftError(
      deliverClaimed(tdb.engine, channel, { workerId: 'worker-a', now: T0, claims: [mine!] }),
      ErrorCode.WF_NOTIFICATION_CHANNEL_CRASHED,
    );
    // The channel accepted the send; the worker died before marking SENT.
    expect(channel.deliveryCount).toBe(1);
    const stillClaimed = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(stillClaimed.rows[0]?.status).toBe('CLAIMED');

    // Recovery: re-claim after expiry and replay the same idempotency key.
    const recoveryNow = '2026-06-01T12:00:10.000Z';
    const reclaimed = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-b',
      now: recoveryNow,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const second = reclaimed.find((c) => c.outboxId === committed.outboxId);
    expect(second).toBeDefined();
    const delivery = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-b',
      now: recoveryNow,
      claims: [second!],
    });
    expect(delivery.sent).toEqual([committed.outboxId]);
    expect(channel.deliveryCount).toBe(1);
    expect(channel.deduplicatedCount).toBe(1);
    expect(channel.callCount).toBe(2);
  });

  it('refuses to send from a stale claim', async () => {
    const { runId } = await seedRun(tdb.engine);
    const committed = await commit(runId, 'stale-claim');

    const first = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-a',
      now: T0,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const mine = first.find((c) => c.outboxId === committed.outboxId);
    expect(mine).toBeDefined();

    const reclaimed = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-b',
      now: '2026-06-01T12:00:10.000Z',
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const fresh = reclaimed.find((c) => c.outboxId === committed.outboxId);
    expect(fresh).toBeDefined();

    // worker-a's token is no longer current: refuse to send.
    const channel = new FakeNotificationChannel();
    const refused = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-a',
      now: '2026-06-01T12:00:10.000Z',
      claims: [mine!],
    });
    expect(refused.stale).toEqual([committed.outboxId]);
    expect(channel.callCount).toBe(0);

    // The current holder may send.
    const accepted = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-b',
      now: '2026-06-01T12:00:10.000Z',
      claims: [fresh!],
    });
    expect(accepted.sent).toEqual([committed.outboxId]);
    expect(channel.deliveryCount).toBe(1);
  });

  it('returns a transient failure to PENDING and succeeds on the next attempt', async () => {
    const { runId } = await seedRun(tdb.engine);
    const committed = await commit(runId, 'transient');

    const channel = new FakeNotificationChannel();
    channel.failTransiently(1);
    const first = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-a',
      now: T0,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const mine = first.find((c) => c.outboxId === committed.outboxId);
    const failedOnce = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-a',
      now: T0,
      claims: [mine!],
      random: () => 0.5,
    });
    expect(failedOnce.retried).toEqual([committed.outboxId]);
    const pending = await tdb.engine.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(pending.rows[0]?.status).toBe('PENDING');
    expect(Number(pending.rows[0]?.attempts)).toBe(1);

    const retry = await claimOutboxBatch(tdb.engine, {
      workerId: 'worker-b',
      now: T1,
      leaseMs: LEASE_MS,
      limit: 10,
    });
    const back = retry.find((c) => c.outboxId === committed.outboxId);
    const delivered = await deliverClaimed(tdb.engine, channel, {
      workerId: 'worker-b',
      now: T1,
      claims: [back!],
    });
    expect(delivered.sent).toEqual([committed.outboxId]);
    expect(channel.deliveryCount).toBe(1);
  });

  it('marks FAILED once the outbox retry budget is exhausted', async () => {
    const { runId } = await seedRun(tdb.engine);
    const committed = await commit(runId, 'exhausted-delivery');

    const channel = new FakeNotificationChannel();
    let now = T0;
    let attempts = 0;
    for (let i = 0; i < 5; i += 1) {
      channel.failTransiently(1);
      const claims = await claimOutboxBatch(tdb.engine, {
        workerId: `worker-${i}`,
        now,
        leaseMs: LEASE_MS,
        limit: 10,
      });
      const claim = claims.find((c) => c.outboxId === committed.outboxId);
      expect(claim).toBeDefined();
      const report = await deliverClaimed(tdb.engine, channel, {
        workerId: `worker-${i}`,
        now,
        claims: [claim!],
        random: () => 0.5,
      });
      attempts = report.outcomes[0]?.attempts ?? attempts;
      now = new Date(Date.parse(now) + 60_000).toISOString();
    }
    expect(attempts).toBe(5);
    const row = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(row.rows[0]?.status).toBe('FAILED');
    expect(channel.deliveryCount).toBe(0);
  });
});
