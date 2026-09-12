/**
 * AC-011 acceptance (positive).
 * Traces: FR-WF-001, FR-WF-006.
 * AC text (manifest §39.2): "A crash after decision commit but before Telegram
 * sends exactly one notification after recovery."
 *
 * The §26.5 boundary commits the decision, the alert, and the notification
 * outbox entry in ONE transaction; the delivery worker then claims the row
 * with a fresh fencing token. When the claiming worker dies BEFORE handing the
 * notification to the channel, the orphaned claim becomes re-claimable once
 * its lease expires, and exactly one worker sends exactly one notification.
 * The assertion surface is the channel's unique-delivery ledger.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  applyScheduleControl,
  claimOutboxBatch,
  commitDecisionWithOutbox,
  deliverClaimed,
  recordTriggerDelivery,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_OUTBOX_CLAIM_LEASE_MS,
  WF_OUTBOX_COMMIT_AT,
  WF_OUTBOX_RECOVERY_AT,
  WF_OUTBOX_SCENARIOS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_T0,
  buildDecisionCommitInput,
  buildScenarioChannel,
} from '../fixtures/wf/index.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T0 = WF_TEST_T0;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

/** CREATE + ENABLE an ACTIVE schedule, then start one run through the inbox. */
async function seedRun(scheduleId: string, messageId: string): Promise<string> {
  await applyScheduleControl(tdb.engine, {
    action: 'CREATE',
    scheduleId,
    now: T0,
    config: {
      name: `schedule ${scheduleId}`,
      cron: '*/5 * * * *',
      timezone: 'UTC',
      destination: 'https://internal.example.test/wf/trigger',
      concurrencyPolicy: 'ALLOW_PARALLEL',
    },
  });
  await applyScheduleControl(tdb.engine, {
    action: 'ENABLE',
    scheduleId,
    now: T0,
    forecast: WF_FORECASTS.FRESH,
  });
  const delivery = await recordTriggerDelivery(tdb.engine, {
    source: 'qstash',
    externalMessageId: messageId,
    scheduleId,
    scheduledFor: T0,
    payloadHash: WF_TEST_PAYLOAD_HASH_A,
    receivedAt: T0,
    verifiedAt: T0,
  });
  if (delivery.runId === null) throw new Error('fixture run did not start');
  return delivery.runId;
}

describe('AC-011: crash before send yields exactly one notification after recovery', () => {
  it('commits decision + alert + outbox in one transaction, then recovers to one unique delivery', async () => {
    const runId = await seedRun('ac011-before-send', 'ac011-before-send-1');
    const scenario = WF_OUTBOX_SCENARIOS.CRASH_BEFORE_SEND;

    const committed = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(runId, 'ac011-before-send', { scenario }),
    );
    expect(committed.status).toBe('PENDING');
    expect(committed.suppressed).toBe(false);

    // The atomic boundary: all three rows exist and the outbox references the
    // decision that references the run.
    const graph = await tdb.engine.query<{
      decision_run: string;
      alert_id: string;
      outbox_status: string;
      outbox_alert_ref: string | null;
    }>(
      `SELECT d.run_id AS decision_run, a.alert_id AS alert_id,
              o.status AS outbox_status, o.alert_ref AS outbox_alert_ref
         FROM wf.notification_outbox o
         JOIN wf.decision_commits d ON d.decision_id = o.decision_ref
         JOIN wf.alert_records a ON a.alert_id = o.alert_ref
        WHERE o.outbox_id = $1`,
      [committed.outboxId],
    );
    expect(graph.rows).toHaveLength(1);
    expect(graph.rows[0]?.decision_run).toBe(runId);
    expect(graph.rows[0]?.alert_id).toBe(committed.alertId);
    expect(graph.rows[0]?.outbox_status).toBe('PENDING');
    expect(graph.rows[0]?.outbox_alert_ref).toBe(committed.alertId);

    // Worker A claims the row, then "crashes" before ever calling the channel.
    const firstClaims = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac011-worker-a',
      now: WF_OUTBOX_COMMIT_AT,
      leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
      limit: 200,
    });
    const claimed = firstClaims.find((c) => c.outboxId === committed.outboxId);
    expect(claimed).toBeDefined();

    const channel = buildScenarioChannel(scenario);
    // Crash BEFORE send = the send is never attempted.
    expect(channel.callCount).toBe(0);
    expect(channel.deliveryCount).toBe(0);

    const midFlight = await tdb.engine.query<{ status: string; claim_owner: string | null }>(
      `SELECT status, claim_owner FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(midFlight.rows[0]?.status).toBe('CLAIMED');
    expect(midFlight.rows[0]?.claim_owner).toBe('ac011-worker-a');

    // Recovery worker B re-claims the orphaned row after the lease expired.
    const recoveryClaims = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac011-worker-b',
      now: WF_OUTBOX_RECOVERY_AT,
      leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
      limit: 200,
    });
    const reclaimed = recoveryClaims.find((c) => c.outboxId === committed.outboxId);
    expect(reclaimed).toBeDefined();
    expect(reclaimed?.fencingToken).toBeGreaterThan(claimed?.fencingToken ?? 0);

    const report = await deliverClaimed(tdb.engine, channel, {
      workerId: 'ac011-worker-b',
      now: WF_OUTBOX_RECOVERY_AT,
      claims: [reclaimed!],
    });
    expect(report.sent).toEqual([committed.outboxId]);
    expect(report.stale).toEqual([]);
    // THE exactly-once assertion: the channel saw exactly one unique delivery.
    expect(channel.deliveryCount).toBe(1);
    expect(channel.deliveries[0]?.idempotencyKey).toBe(committed.outboxId);

    const finalRow = await tdb.engine.query<{ status: string; sent_at: string | null }>(
      `SELECT status, sent_at FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(finalRow.rows[0]?.status).toBe('SENT');
    expect(finalRow.rows[0]?.sent_at).not.toBeNull();

    // The decision and alert records are preserved unchanged.
    const decision = await tdb.engine.query(
      `SELECT decision_id FROM wf.decision_commits WHERE decision_id = $1`,
      [committed.decisionId],
    );
    const alert = await tdb.engine.query(
      `SELECT alert_id FROM wf.alert_records WHERE alert_id = $1`,
      [committed.alertId],
    );
    expect(decision.rows).toHaveLength(1);
    expect(alert.rows).toHaveLength(1);
  });

  it('never lets a second live worker claim a row while the first claim is unexpired', async () => {
    const runId = await seedRun('ac011-single-claim', 'ac011-single-claim-1');
    const committed = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(runId, 'ac011-single-claim'),
    );

    const first = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac011-holder',
      now: WF_OUTBOX_COMMIT_AT,
      leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
      limit: 200,
    });
    expect(first.find((c) => c.outboxId === committed.outboxId)).toBeDefined();

    // A second worker scanning INSIDE the lease window (one second after the
    // claim) must not see the row.
    const insideLeaseAt = '2026-06-01T12:00:01.000Z';
    const second = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac011-intruder',
      now: insideLeaseAt,
      leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
      limit: 200,
    });
    expect(second.find((c) => c.outboxId === committed.outboxId)).toBeUndefined();
  });

  it('recovers from a transient channel fault to exactly one unique delivery', async () => {
    const runId = await seedRun('ac011-transient', 'ac011-transient-1');
    const committed = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(runId, 'ac011-transient'),
    );

    const claims = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac011-transient-a',
      now: WF_OUTBOX_COMMIT_AT,
      leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
      limit: 200,
    });
    const claim = claims.find((c) => c.outboxId === committed.outboxId);
    expect(claim).toBeDefined();

    // The fake channel faults transiently on the first attempt: nothing is
    // delivered and the row returns to PENDING for a later worker.
    const channel = buildScenarioChannel(WF_OUTBOX_SCENARIOS.CRASH_BEFORE_SEND);
    channel.failTransiently(1);
    const first = await deliverClaimed(tdb.engine, channel, {
      workerId: 'ac011-transient-a',
      now: WF_OUTBOX_COMMIT_AT,
      claims: [claim!],
      random: () => 0.5,
    });
    expect(first.retried).toEqual([committed.outboxId]);
    expect(first.sent).toEqual([]);
    expect(channel.deliveryCount).toBe(0);

    const retriedRow = await tdb.engine.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(retriedRow.rows[0]?.status).toBe('PENDING');
    expect(Number(retriedRow.rows[0]?.attempts)).toBe(1);

    // The recovery attempt delivers exactly once.
    const retryClaims = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac011-transient-b',
      now: WF_OUTBOX_RECOVERY_AT,
      leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
      limit: 200,
    });
    const retry = retryClaims.find((c) => c.outboxId === committed.outboxId);
    expect(retry).toBeDefined();
    const report = await deliverClaimed(tdb.engine, channel, {
      workerId: 'ac011-transient-b',
      now: WF_OUTBOX_RECOVERY_AT,
      claims: [retry!],
    });
    expect(report.sent).toEqual([committed.outboxId]);
    expect(channel.deliveryCount).toBe(1);
  });
});
