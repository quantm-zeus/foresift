/**
 * AC-011 negative (failure path).
 * Traces: FR-WF-001, FR-WF-006.
 * AC text (manifest §39.2): "A crash after decision commit but before Telegram
 * sends exactly one notification after recovery."
 *
 * Failure paths that must stay exactly-once:
 * - a second worker holding a STALE claim cannot send (the current holder can);
 * - a crash AFTER the channel accepted the send but BEFORE the SENT mark still
 *   yields exactly one unique delivery — the channel saw one unique
 *   idempotency key and deduplicated the replay;
 * - a shadow (`SUPPRESSED_SHADOW`) or provider-outage (`SUPPRESSED_OUTAGE`) row
 *   is never claimed and never sent, while its decision and alert records stay
 *   preserved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ErrorCode } from '@foresift/domain';
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
  buildManualClaim,
  buildScenarioChannel,
} from '../fixtures/wf/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T0 = WF_TEST_T0;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

/** CREATE + ENABLE an ACTIVE schedule, then start one run through the inbox. */
async function seedRun(
  scheduleId: string,
  messageId: string,
  options: { readonly shadow?: boolean } = {},
): Promise<string> {
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
      shadow: options.shadow ?? false,
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

async function claimOne(outboxId: string, workerId: string, now: string) {
  const claims = await claimOutboxBatch(tdb.engine, {
    workerId,
    now,
    leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
    limit: 200,
  });
  return claims.find((c) => c.outboxId === outboxId);
}

describe('AC-011 negative: stale claims and suppressed rows never deliver', () => {
  it('refuses to send from a stale claim while the current holder delivers once', async () => {
    const runId = await seedRun('ac011n-stale', 'ac011n-stale-1');
    const committed = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(runId, 'ac011n-stale'),
    );

    const mine = await claimOne(committed.outboxId, 'ac011n-worker-a', WF_OUTBOX_COMMIT_AT);
    expect(mine).toBeDefined();
    const fresh = await claimOne(committed.outboxId, 'ac011n-worker-b', WF_OUTBOX_RECOVERY_AT);
    expect(fresh).toBeDefined();
    expect(fresh?.fencingToken).toBeGreaterThan(mine?.fencingToken ?? 0);

    const channel = buildScenarioChannel(WF_OUTBOX_SCENARIOS.STALE_CLAIM);
    const refused = await deliverClaimed(tdb.engine, channel, {
      workerId: 'ac011n-worker-a',
      now: WF_OUTBOX_RECOVERY_AT,
      claims: [mine!],
    });
    expect(refused.stale).toEqual([committed.outboxId]);
    expect(refused.sent).toEqual([]);
    expect(channel.callCount).toBe(0);

    const accepted = await deliverClaimed(tdb.engine, channel, {
      workerId: 'ac011n-worker-b',
      now: WF_OUTBOX_RECOVERY_AT,
      claims: [fresh!],
    });
    expect(accepted.sent).toEqual([committed.outboxId]);
    expect(channel.deliveryCount).toBe(1);
  });

  it('keeps exactly one unique delivery when the worker crashes after the send', async () => {
    const runId = await seedRun('ac011n-after-send', 'ac011n-after-send-1');
    const committed = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(runId, 'ac011n-after-send'),
    );

    const mine = await claimOne(committed.outboxId, 'ac011n-worker-a', WF_OUTBOX_COMMIT_AT);
    expect(mine).toBeDefined();

    const channel = buildScenarioChannel(WF_OUTBOX_SCENARIOS.CRASH_AFTER_SEND);
    await expectForesiftError(
      deliverClaimed(tdb.engine, channel, {
        workerId: 'ac011n-worker-a',
        now: WF_OUTBOX_COMMIT_AT,
        claims: [mine!],
      }),
      ErrorCode.WF_NOTIFICATION_CHANNEL_CRASHED,
    );

    // The channel ACCEPTED the send before the simulated death; the outbox
    // row stayed CLAIMED because the SENT mark never ran.
    expect(channel.deliveryCount).toBe(1);
    const stillClaimed = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(stillClaimed.rows[0]?.status).toBe('CLAIMED');

    // Recovery re-claims and replays the SAME idempotency key.
    const fresh = await claimOne(committed.outboxId, 'ac011n-worker-b', WF_OUTBOX_RECOVERY_AT);
    expect(fresh).toBeDefined();
    const report = await deliverClaimed(tdb.engine, channel, {
      workerId: 'ac011n-worker-b',
      now: WF_OUTBOX_RECOVERY_AT,
      claims: [fresh!],
    });
    expect(report.sent).toEqual([committed.outboxId]);

    // THE idempotency assertion: one unique key, one unique delivery, and the
    // recovery send was recognised as a replay.
    expect(channel.deliveryCount).toBe(1);
    expect(channel.deliveries.map((d) => d.idempotencyKey)).toEqual([committed.outboxId]);
    expect(channel.deduplicatedCount).toBe(1);
    expect(channel.callCount).toBe(2);

    const finalRow = await tdb.engine.query<{ status: string }>(
      `SELECT status FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(finalRow.rows[0]?.status).toBe('SENT');
  });

  it('never claims or sends a shadow/suppressed row, and preserves its decision and alert', async () => {
    const shadowRun = await seedRun('ac011n-shadow', 'ac011n-shadow-1', { shadow: true });
    const shadowCommit = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(shadowRun, 'ac011n-shadow'),
    );
    expect(shadowCommit.status).toBe('SUPPRESSED_SHADOW');
    expect(shadowCommit.suppressed).toBe(true);

    const outageRun = await seedRun('ac011n-outage', 'ac011n-outage-1');
    const outageCommit = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(outageRun, 'ac011n-outage', {
        scenario: WF_OUTBOX_SCENARIOS.PROVIDER_OUTAGE,
      }),
    );
    expect(outageCommit.status).toBe('SUPPRESSED_OUTAGE');
    expect(outageCommit.suppressed).toBe(true);

    const claims = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac011n-suppression-worker',
      now: WF_OUTBOX_COMMIT_AT,
      leaseMs: WF_OUTBOX_CLAIM_LEASE_MS,
      limit: 200,
    });
    const claimIds = claims.map((c) => c.outboxId);
    expect(claimIds).not.toContain(shadowCommit.outboxId);
    expect(claimIds).not.toContain(outageCommit.outboxId);

    // Even a hand-built claim cannot force a suppressed row out of the gate.
    const channel = buildScenarioChannel(WF_OUTBOX_SCENARIOS.SHADOW);
    for (const outboxId of [shadowCommit.outboxId, outageCommit.outboxId]) {
      const report = await deliverClaimed(tdb.engine, channel, {
        workerId: 'ac011n-suppression-worker',
        now: WF_OUTBOX_COMMIT_AT,
        claims: [buildManualClaim(outboxId)],
      });
      expect(report.refusedSuppressed).toEqual([outboxId]);
      expect(report.sent).toEqual([]);
    }
    expect(channel.callCount).toBe(0);
    expect(channel.deliveryCount).toBe(0);

    // The decision and alert records survive suppression.
    for (const committed of [shadowCommit, outageCommit]) {
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
    }
  });
});
