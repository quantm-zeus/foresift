/**
 * AC-061 negative / failure-path.
 * Traces: FR-DATA-005, FR-DR-001.
 * Fabricating a success-shaped output over an outage is impossible at every
 * layer: silent absences are refused (repository AND SQL), the success
 * vocabulary cannot explain a null, and an outage decision can never be
 * patched into a completed retrieval after the fact.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AcquisitionState, ErrorCode, utcTimestamp, type UtcTimestamp } from '@foresift/domain';
import {
  appendObservation,
  completeRetrieval,
  recordAcquisitionDecision,
  recordFieldQuality,
} from '@foresift/persistence';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  seedPool,
  type TestDatabase,
} from '../acceptance/helpers.ts';
import {
  FakeNotificationChannel,
  applyScheduleControl,
  claimOutboxBatch,
  commitDecisionWithOutbox,
  deliverClaimed,
  recordTriggerDelivery,
} from '@foresift/workflow-runtime';
import {
  WF_FORECASTS,
  WF_OUTBOX_COMMIT_AT,
  WF_OUTBOX_SCENARIOS,
  WF_TEST_PAYLOAD_HASH_A,
  WF_TEST_T0,
  buildDecisionCommitInput,
  buildManualClaim,
} from '../fixtures/wf/index.ts';

const T = (iso: string): UtcTimestamp => utcTimestamp(iso);

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  const { engine } = tdb;
  const poolId = await seedPool(engine, {
    chainId: 'eip155:1',
    dexId: 'uniswap-v2',
    poolAddress: '0x00000000000000000000000000000000000ac161',
  });
  await appendObservation(engine, {
    observationId: 'ac061n-obs',
    subjectPoolId: poolId,
    eventAt: T('2026-06-01T08:00:00Z'),
    availableAt: T('2026-06-01T08:30:00Z'),
    availabilityProvenance: 'PROVIDER_LIVE_RESPONSE',
    rawAmount: '7',
    decimals: 2,
  });
  // An outage decision opened mid-window, requested but never completed.
  await recordAcquisitionDecision(engine, {
    decisionId: 'ac061n-outage',
    candidateId: 'cand/ac061n',
    evidenceFamily: 'swaps',
    policyVersion: 'policy/v1',
    state: AcquisitionState.PROVIDER_UNAVAILABLE,
    requestedAt: T('2026-06-01T08:05:00Z'),
  });
}, 120_000);

afterAll(() => closeTestDatabase(tdb));

describe('AC-061 negative: fabricated success over an outage is refused', () => {
  it('a silent null (no quality code) is refused at the repository boundary', async () => {
    await expectForesiftError(
      recordFieldQuality(tdb.engine, {
        fieldQualityId: 'ac061n-fq-silent-null',
        observationId: 'ac061n-obs',
        fieldPath: 'metrics.volumeUsd24h',
        valueRaw: null,
        qualityCodes: [],
      }),
      ErrorCode.QUALITY_NULL_WITHOUT_CODE,
    );
  });

  it('the success vocabulary (VALID alone) cannot explain an absence', async () => {
    await expectForesiftError(
      recordFieldQuality(tdb.engine, {
        fieldQualityId: 'ac061n-fq-valid-null',
        observationId: 'ac061n-obs',
        fieldPath: 'metrics.tvlUsd',
        valueRaw: null,
        qualityCodes: ['VALID'],
      }),
      ErrorCode.QUALITY_NULL_WITHOUT_CODE,
    );
  });

  it('the SQL layer independently refuses a null without codes', async () => {
    await tdb.engine
      .query(
        `INSERT INTO observation_field_quality
           (field_quality_id, observation_id, field_path, value_raw, quality_codes)
         VALUES ('ac061n-fq-sql-null','ac061n-obs','metrics.x',NULL,ARRAY[]::text[])`,
      )
      .then(
        () => {
          throw new Error('expected check-constraint refusal for codeless null');
        },
        (err: unknown) => {
          expect(String((err as Error).message)).toContain('observation_field_quality');
        },
      );
  });

  it('an outage decision cannot be patched into a completed retrieval', async () => {
    // No probe assignment was ever persisted for the outage attempt, so a
    // post-hoc "it actually returned" completion is a typed refusal — the
    // PROVIDER_UNAVAILABLE state stands.
    await expectForesiftError(
      completeRetrieval(tdb.engine, {
        decisionId: 'ac061n-outage',
        completedAt: T('2026-06-01T09:00:00Z'),
        state: AcquisitionState.RETURNED,
        evidenceIds: ['ev/fabricated'],
      }),
      ErrorCode.ACQUISITION_PROBE_ASSIGNMENT_MISSING,
    );
    const rows = await tdb.engine.query<{ state: string; completed_at: string | null }>(
      'SELECT state, completed_at FROM evidence_acquisition_decisions WHERE decision_id = $1',
      ['ac061n-outage'],
    );
    expect(rows.rows[0]?.state).toBe(AcquisitionState.PROVIDER_UNAVAILABLE);
    expect(rows.rows[0]?.completed_at).toBeNull();
  });
});

/**
 * AC-061 wf negative (T037, FR-WF-006).
 *
 * Suppression at the outbox gate is STICKY and the preserved records cannot be
 * erased: a `SUPPRESSED_OUTAGE` row is refused at the send gate and stays
 * suppressed (a refused attempt is not a transition), and the decision and
 * alert rows backing it are protected by the §26.5 foreign keys — deleting them
 * while the outbox row references them is refused, so "preserved" is a storage
 * invariant and not merely a claim.
 */
describe('AC-061 wf negative: outage suppression is sticky and preserved records cannot be erased', () => {
  it('keeps a suppressed outage row unsent and refuses deletion of its decision and alert', async () => {
    const scheduleId = 'ac061n-wf-outage';
    await applyScheduleControl(tdb.engine, {
      action: 'CREATE',
      scheduleId,
      now: WF_TEST_T0,
      config: {
        name: 'ac061n wf outage schedule',
        cron: '*/5 * * * *',
        timezone: 'UTC',
        destination: 'https://internal.example.test/wf/trigger',
        concurrencyPolicy: 'ALLOW_PARALLEL',
      },
    });
    await applyScheduleControl(tdb.engine, {
      action: 'ENABLE',
      scheduleId,
      now: WF_TEST_T0,
      forecast: WF_FORECASTS.FRESH,
    });
    const delivery = await recordTriggerDelivery(tdb.engine, {
      source: 'qstash',
      externalMessageId: 'ac061n-wf-outage-msg-1',
      scheduleId,
      scheduledFor: WF_TEST_T0,
      payloadHash: WF_TEST_PAYLOAD_HASH_A,
      receivedAt: WF_TEST_T0,
      verifiedAt: WF_TEST_T0,
    });
    expect(delivery.runId).not.toBeNull();

    const committed = await commitDecisionWithOutbox(
      tdb.engine,
      buildDecisionCommitInput(delivery.runId!, 'ac061n-wf-outage', {
        scenario: WF_OUTBOX_SCENARIOS.PROVIDER_OUTAGE,
      }),
    );
    expect(committed.status).toBe('SUPPRESSED_OUTAGE');

    // The suppressed row is not claimable, and a hand-built claim is refused.
    const claims = await claimOutboxBatch(tdb.engine, {
      workerId: 'ac061n-wf-worker',
      now: WF_OUTBOX_COMMIT_AT,
      leaseMs: 5_000,
      limit: 500,
    });
    expect(claims.map((c) => c.outboxId)).not.toContain(committed.outboxId);

    const channel = new FakeNotificationChannel();
    const report = await deliverClaimed(tdb.engine, channel, {
      workerId: 'ac061n-wf-worker',
      now: WF_OUTBOX_COMMIT_AT,
      claims: [buildManualClaim(committed.outboxId)],
    });
    expect(report.refusedSuppressed).toEqual([committed.outboxId]);
    expect(report.sent).toEqual([]);
    expect(channel.callCount).toBe(0);

    // Sticky: the refused attempt left the classification untouched.
    const row = await tdb.engine.query<{ status: string; claim_owner: string | null }>(
      `SELECT status, claim_owner FROM wf.notification_outbox WHERE outbox_id = $1`,
      [committed.outboxId],
    );
    expect(row.rows[0]?.status).toBe('SUPPRESSED_OUTAGE');
    expect(row.rows[0]?.claim_owner).toBeNull();

    // The decision and alert are preserved at the storage layer: deleting them
    // while the outbox row references them is refused by the §26.5 FKs.
    const decisionDelete = await tdb.engine
      .query(`DELETE FROM wf.decision_commits WHERE decision_id = $1`, [committed.decisionId])
      .then(
        () => null,
        (err: unknown) => err as Error,
      );
    expect(decisionDelete).not.toBeNull();
    expect(String(decisionDelete?.message)).toMatch(
      /foreign key|notification_outbox|alert_records/i,
    );

    const alertDelete = await tdb.engine
      .query(`DELETE FROM wf.alert_records WHERE alert_id = $1`, [committed.alertId])
      .then(
        () => null,
        (err: unknown) => err as Error,
      );
    expect(alertDelete).not.toBeNull();
    expect(String(alertDelete?.message)).toMatch(/foreign key|notification_outbox/i);

    // Both records remain readable and linked to the suppressed notification.
    const preserved = await tdb.engine.query<{
      decision_id: string;
      alert_id: string;
      outbox_status: string;
    }>(
      `SELECT d.decision_id, a.alert_id, o.status AS outbox_status
         FROM wf.notification_outbox o
         JOIN wf.decision_commits d ON d.decision_id = o.decision_ref
         JOIN wf.alert_records a ON a.alert_id = o.alert_ref
        WHERE o.outbox_id = $1`,
      [committed.outboxId],
    );
    expect(preserved.rows).toHaveLength(1);
    expect(preserved.rows[0]?.decision_id).toBe(committed.decisionId);
    expect(preserved.rows[0]?.alert_id).toBe(committed.alertId);
    expect(preserved.rows[0]?.outbox_status).toBe('SUPPRESSED_OUTAGE');
  });
});
