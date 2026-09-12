/**
 * AC-141 acceptance (positive).
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-ALERT-003, FR-ALERT-004, AC-141.
 * AC text (manifest §39.13): "A material invalidation or expiry of an actionable
 * prior alert creates an idempotent update/cancellation notification."
 *
 * Proven on a real SQL engine (PGlite), driven by `tests/fixtures/alerts/**`:
 * - a material deterioration, a material evidence invalidation, a cancellation,
 *   and an expiry of an ACTIONABLE prior each commit exactly ONE update
 *   notification through the engine's §26.5 outbox boundary;
 * - replaying the identical update decision collapses onto the durable row
 *   (`DEDUPLICATED`) so a crash/retry never double-notifies;
 * - the bounded reassessment sweep produces one committed update and then one
 *   deduplicated outcome for the same prior.
 */
import { describe, expect, it } from 'bun:test';
import { AlertSuppressionReason } from '@foresift/domain';
import {
  AlertPriorEvent,
  ALERT_NOTIFICATION_CHANNEL,
  buildUpdateNotification,
  commitAlertUpdate,
  evaluatePriorAlertUpdate,
  recordPriorAlert,
  sweepAlertLifecycle,
  type AlertUpdateCandidate,
  type PriorAlertState,
} from '@foresift/alerts';
import * as fx from '../fixtures/alerts/index.ts';
import { countAlertRows, seedAlertRun } from './alerts-helpers.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const T0 = fx.ALERT_FIXTURE_T0;
const EXPIRING = fx.ALERT_FIXTURE_EXPIRING_AT;

/** Run `work` against a throwaway migrated database (per-test isolation). */
async function withAlertDb<T>(work: (tdb: TestDatabase) => Promise<T>): Promise<T> {
  const tdb = await makeTestDatabase();
  try {
    return await work(tdb);
  } finally {
    await closeTestDatabase(tdb);
  }
}

/** Persist a fixture prior alert so the lifecycle can reassess it. */
async function recordPrior(tdb: TestDatabase, prior: PriorAlertState): Promise<PriorAlertState> {
  return recordPriorAlert(tdb.engine, {
    alertId: prior.alertRef,
    decisionRef: `adec-${prior.alertRef}`,
    runRef: prior.runRef,
    alertClass: prior.alertClass,
    fingerprint: prior.fingerprint,
    thesisVersion: prior.thesisVersion,
    lifecycleState: prior.lifecycleState,
    riskState: prior.riskState,
    severity: prior.severity,
    actionabilityState: prior.actionabilityState,
    validUntil: prior.validUntil,
    assetId: prior.assetId,
    profileId: prior.profileId,
    executionScenarioId: prior.executionScenarioId,
    validUntilGeneration: prior.validUntilGeneration,
    materialEvidenceFingerprint: prior.materialEvidenceFingerprint,
  });
}

/** Build the notification and commit the update through the engine boundary. */
async function commitUpdate(
  tdb: TestDatabase,
  candidate: AlertUpdateCandidate,
  options: {
    readonly now?: string;
    readonly decisionReadyAt?: string;
    readonly budgetMs?: number;
  } = {},
): Promise<Awaited<ReturnType<typeof commitAlertUpdate>>> {
  const now = options.now ?? T0;
  const notification = buildUpdateNotification(candidate, fx.notificationContextFixture(now));
  return commitAlertUpdate(tdb.engine, {
    candidate,
    classification: notification.classification,
    content: notification.content,
    decisionReadyAt: options.decisionReadyAt ?? now,
    now,
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
  });
}

async function updateCount(tdb: TestDatabase, priorAlertRef: string): Promise<number> {
  return countAlertRows(
    tdb.engine,
    `SELECT count(*)::int AS count FROM alert.alert_updates WHERE prior_alert_ref = $1`,
    [priorAlertRef],
  );
}

describe('AC-141: a material invalidation or expiry of an actionable prior notifies exactly once', () => {
  it('commits one material-deterioration update and collapses a replay', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const prior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, { runRef }),
      );

      const evaluation = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
        now: T0,
      });
      expect(evaluation.kind).toBe('UPDATE');
      if (evaluation.kind !== 'UPDATE') throw new Error('expected an update candidate');
      expect(evaluation.updateKind).toBe('MATERIAL_DETERIORATION');
      expect(evaluation.alertClass).toBe('THESIS_WEAKENING');
      expect(evaluation.materialChange.changed).toBe(true);
      expect(evaluation.idempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/);

      const first = await commitUpdate(tdb, evaluation);
      expect(first.kind).toBe('COMMITTED');
      if (first.kind !== 'COMMITTED') throw new Error('expected COMMITTED');
      expect(first.updateId).toMatch(/^aupd_[0-9a-f]{64}$/);
      expect(first.outboxId).toMatch(/^aout_[0-9a-f]{64}$/);

      const replay = await commitUpdate(tdb, evaluation);
      expect(replay.kind).toBe('DEDUPLICATED');
      if (replay.kind !== 'DEDUPLICATED') throw new Error('expected DEDUPLICATED');
      expect(replay.updateId).toBe(first.updateId);

      expect(await updateCount(tdb, prior.alertRef)).toBe(1);
      expect(
        await countAlertRows(
          tdb.engine,
          `SELECT count(*)::int AS count FROM wf.notification_outbox WHERE outbox_id = $1`,
          [first.outboxId],
        ),
      ).toBe(1);
      expect(
        await countAlertRows(
          tdb.engine,
          `SELECT count(*)::int AS count FROM wf.notification_outbox WHERE channel = $1`,
          [ALERT_NOTIFICATION_CHANNEL],
        ),
      ).toBe(1);

      const stored = await tdb.engine.query<{ update_kind: string; idempotency_key: string }>(
        `SELECT update_kind, idempotency_key FROM alert.alert_updates WHERE prior_alert_ref = $1`,
        [prior.alertRef],
      );
      expect(stored.rows[0]?.update_kind).toBe('MATERIAL_DETERIORATION');
      expect(stored.rows[0]?.idempotency_key).toBe(evaluation.idempotencyKey);
    });
  }, 120_000);

  it('treats a material evidence invalidation alone as a deterioration notification', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const prior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, {
          runRef,
          materialEvidenceFingerprint: fx.ALERT_HASH_B,
        }),
      );
      const evaluation = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.reassessmentFixture({
          severity: prior.severity,
          thesisVersion: prior.thesisVersion,
          materialEvidenceFingerprint: fx.ALERT_HASH_C,
        }),
        now: T0,
      });
      expect(evaluation.kind).toBe('UPDATE');
      if (evaluation.kind !== 'UPDATE') throw new Error('expected an update candidate');
      // The material-evidence dimension alone crossed the threshold.
      expect(evaluation.materialChange.severityChanged).toBe(false);
      expect(evaluation.materialChange.thesisChanged).toBe(false);
      expect(evaluation.materialChange.materialEvidenceChanged).toBe(true);
      expect(evaluation.updateKind).toBe('MATERIAL_DETERIORATION');

      const committed = await commitUpdate(tdb, evaluation);
      expect(committed.kind).toBe('COMMITTED');
      const replay = await commitUpdate(tdb, evaluation);
      expect(replay.kind).toBe('DEDUPLICATED');
      expect(await updateCount(tdb, prior.alertRef)).toBe(1);
    });
  }, 120_000);

  it('commits one cancellation and one expiry notification, each collapsing a replay', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);

      const cancellationPrior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.CANCELLATION, {
          runRef,
          alertClass: 'CONFIRMED_OPPORTUNITY',
        }),
      );
      const cancellation = evaluatePriorAlertUpdate({
        prior: cancellationPrior,
        event: AlertPriorEvent.CANCELLATION,
        reassessment: fx.CANCELLATION_REASSESSMENT,
        now: T0,
      });
      expect(cancellation.kind).toBe('UPDATE');
      if (cancellation.kind !== 'UPDATE') throw new Error('expected an update candidate');
      expect(cancellation.updateKind).toBe('CANCELLATION');
      expect(cancellation.alertClass).toBe('OPPORTUNITY_EXPIRED');
      const cancellationCommit = await commitUpdate(tdb, cancellation);
      expect(cancellationCommit.kind).toBe('COMMITTED');
      expect((await commitUpdate(tdb, cancellation)).kind).toBe('DEDUPLICATED');

      const expiryPrior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.EXPIRY, {
          runRef,
          alertClass: 'CONFIRMED_OPPORTUNITY',
          // A distinct prior alert carries its own identity fingerprint; the
          // ledger/cooldown is keyed by that identity, never shared.
          fingerprint: fx.ALERT_HASH_C,
        }),
      );
      const expiry = evaluatePriorAlertUpdate({
        prior: expiryPrior,
        event: AlertPriorEvent.EXPIRY,
        reassessment: fx.EXPIRY_REASSESSMENT,
        now: EXPIRING,
      });
      expect(expiry.kind).toBe('UPDATE');
      if (expiry.kind !== 'UPDATE') throw new Error('expected an update candidate');
      expect(expiry.updateKind).toBe('EXPIRY');
      expect(expiry.alertClass).toBe('OPPORTUNITY_EXPIRED');
      const expiryCommit = await commitUpdate(tdb, expiry, { now: EXPIRING });
      expect(expiryCommit.kind).toBe('COMMITTED');
      expect((await commitUpdate(tdb, expiry, { now: EXPIRING })).kind).toBe('DEDUPLICATED');

      expect(await updateCount(tdb, cancellationPrior.alertRef)).toBe(1);
      expect(await updateCount(tdb, expiryPrior.alertRef)).toBe(1);
      expect(
        await countAlertRows(
          tdb.engine,
          `SELECT count(*)::int AS count FROM wf.notification_outbox`,
        ),
      ).toBe(2);
    });
  }, 120_000);

  it('produces one committed and then one deduplicated outcome through the reassessment sweep', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const prior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, { runRef }),
      );

      const source = (candidate: PriorAlertState) =>
        candidate.alertRef === prior.alertRef
          ? {
              event: AlertPriorEvent.DETERIORATION,
              reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
              notification: fx.notificationContextFixture(T0),
              decisionReadyAt: T0,
            }
          : null;

      const first = await sweepAlertLifecycle(tdb.engine, { now: T0, limit: 10, source });
      expect(first.examined).toBe(1);
      expect(first.countsByOutcome.UPDATE_COMMITTED).toBe(1);
      expect(first.outcomes[0]?.outcome).toBe('UPDATE_COMMITTED');
      expect(first.outcomes[0]?.updateKind).toBe('MATERIAL_DETERIORATION');

      const second = await sweepAlertLifecycle(tdb.engine, { now: T0, limit: 10, source });
      expect(second.countsByOutcome.UPDATE_DEDUPLICATED).toBe(1);
      expect(second.outcomes[0]?.outcome).toBe('UPDATE_DEDUPLICATED');

      expect(await updateCount(tdb, prior.alertRef)).toBe(1);
      expect(
        await countAlertRows(
          tdb.engine,
          `SELECT count(*)::int AS count FROM wf.notification_outbox`,
        ),
      ).toBe(1);
    });
  }, 120_000);

  it('does not deliver an update whose decision-ready → delivery budget elapsed', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const prior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, { runRef }),
      );
      const evaluation = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
        now: T0,
      });
      if (evaluation.kind !== 'UPDATE') throw new Error('expected an update candidate');

      const late = await commitUpdate(tdb, evaluation, {
        now: '2026-06-01T12:05:00.000Z',
        decisionReadyAt: T0,
        budgetMs: 1_000,
      });
      expect(late.kind).toBe('SUPPRESSED');
      if (late.kind !== 'SUPPRESSED') throw new Error('expected SUPPRESSED');
      expect(late.reason).toBe(AlertSuppressionReason.EXPIRED_ACTIONABILITY);
      expect(late.latencyOutcome).toBe('BUDGET_EXCEEDED_SUPPRESSED');
      expect(await updateCount(tdb, prior.alertRef)).toBe(0);
      expect(
        await countAlertRows(
          tdb.engine,
          `SELECT count(*)::int AS count FROM wf.notification_outbox`,
        ),
      ).toBe(0);
    });
  }, 120_000);
});
