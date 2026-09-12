/**
 * AC-141 negative / failure-path.
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-ALERT-003, FR-ALERT-004, AC-141.
 * AC text (manifest §39.13): "A material invalidation or expiry of an actionable
 * prior alert creates an idempotent update/cancellation notification."
 *
 * Failure paths that must emit NOTHING (not a weaker notification):
 * - a below-threshold change on an actionable prior (`IMMATERIAL_CHANGE`);
 * - a prior that is already expired or cancelled (no longer actionable);
 * - a repeat inside the recorded cooldown (exactly one update survives);
 * - an event inconsistent with the reassessment (cancellation not recorded,
 *   expiry not due, risk not present);
 * - a classification whose class disagrees with the evaluated update, which is
 *   a programming error refused typed before any write.
 */
import { describe, expect, it } from 'bun:test';
import { AlertSuppressionReason, ErrorCode } from '@foresift/domain';
import {
  AlertPriorEvent,
  buildUpdateNotification,
  commitAlertUpdate,
  evaluatePriorAlertUpdate,
  recordPriorAlert,
  sweepAlertLifecycle,
  type AlertUpdateCandidate,
  type PriorAlertState,
} from '@foresift/alerts';
import * as fx from '../fixtures/alerts/index.ts';
import { countAlertRows, expectAlertCodeSync, seedAlertRun } from '../acceptance/alerts-helpers.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

const T0 = fx.ALERT_FIXTURE_T0;

/** Run `work` against a throwaway migrated database (per-test isolation). */
async function withAlertDb<T>(work: (tdb: TestDatabase) => Promise<T>): Promise<T> {
  const tdb = await makeTestDatabase();
  try {
    return await work(tdb);
  } finally {
    await closeTestDatabase(tdb);
  }
}

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

async function commitUpdate(
  tdb: TestDatabase,
  candidate: AlertUpdateCandidate,
  now: string = T0,
): Promise<Awaited<ReturnType<typeof commitAlertUpdate>>> {
  const notification = buildUpdateNotification(candidate, fx.notificationContextFixture(now));
  return commitAlertUpdate(tdb.engine, {
    candidate,
    classification: notification.classification,
    content: notification.content,
    decisionReadyAt: now,
    now,
  });
}

async function totalUpdates(tdb: TestDatabase): Promise<number> {
  return countAlertRows(tdb.engine, `SELECT count(*)::int AS count FROM alert.alert_updates`);
}

async function totalOutbox(tdb: TestDatabase): Promise<number> {
  return countAlertRows(tdb.engine, `SELECT count(*)::int AS count FROM wf.notification_outbox`);
}

describe('AC-141 negative: below-threshold, non-actionable, and within-cooldown priors emit nothing', () => {
  it('emits no second notification for a below-threshold change', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const prior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, { runRef }),
      );

      const evaluation = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.IMMATERIAL_REASSESSMENT,
        now: T0,
      });
      expect(evaluation.kind).toBe('NO_UPDATE');
      if (evaluation.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
      expect(evaluation.reason).toBe('IMMATERIAL_CHANGE');

      const report = await sweepAlertLifecycle(tdb.engine, {
        now: T0,
        limit: 10,
        source: () => ({
          event: AlertPriorEvent.DETERIORATION,
          reassessment: fx.IMMATERIAL_REASSESSMENT,
          notification: fx.notificationContextFixture(T0),
          decisionReadyAt: T0,
        }),
      });
      expect(report.countsByOutcome.NO_UPDATE).toBe(1);
      expect(report.outcomes[0]?.reason).toBe('IMMATERIAL_CHANGE');
      expect(await totalUpdates(tdb)).toBe(0);
      expect(await totalOutbox(tdb)).toBe(0);
    });
  }, 120_000);

  it('emits nothing for an expired or cancelled prior and expires it without delivery', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);

      const expired = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, {
          runRef,
          validUntil: fx.ALERT_FIXTURE_EXPIRED_AT,
        }),
      );
      const expiredEvaluation = evaluatePriorAlertUpdate({
        prior: expired,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
        now: fx.ALERT_FIXTURE_EXPIRED_AT,
      });
      expect(expiredEvaluation.kind).toBe('NO_UPDATE');
      if (expiredEvaluation.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
      expect(expiredEvaluation.reason).toBe('NOT_ACTIONABLE_EXPIRED');

      const cancelled = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, {
          runRef,
          alertRef: 'aalt-prior-cancelled',
          cancellationState: 'CANCELLED',
          actionabilityState: 'CANCELLED',
        }),
      );
      const cancelledEvaluation = evaluatePriorAlertUpdate({
        prior: cancelled,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
        now: T0,
      });
      expect(cancelledEvaluation.kind).toBe('NO_UPDATE');
      if (cancelledEvaluation.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
      expect(cancelledEvaluation.reason).toBe('NOT_ACTIONABLE_EXPIRED');

      // The sweep transitions a no-longer-actionable prior to EXPIRED and
      // never reaches the delivery path.
      const report = await sweepAlertLifecycle(tdb.engine, {
        now: fx.ALERT_FIXTURE_EXPIRED_AT,
        limit: 10,
      });
      expect(report.countsByOutcome.EXPIRED_SUPPRESSED).toBeGreaterThanOrEqual(1);
      expect(await totalOutbox(tdb)).toBe(0);
      expect(await totalUpdates(tdb)).toBe(0);
    });
  }, 120_000);

  it('collapses a within-cooldown duplicate into the single delivered update', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const prior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, { runRef }),
      );

      const first = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
        now: T0,
      });
      if (first.kind !== 'UPDATE') throw new Error('expected an update candidate');
      expect((await commitUpdate(tdb, first)).kind).toBe('COMMITTED');

      const second = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.RISK,
        reassessment: fx.RISK_REASSESSMENT,
        now: T0,
      });
      if (second.kind !== 'UPDATE') throw new Error('expected an update candidate');
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
      const suppressed = await commitUpdate(tdb, second);
      expect(suppressed.kind).toBe('SUPPRESSED');
      if (suppressed.kind !== 'SUPPRESSED') throw new Error('expected SUPPRESSED');
      expect(suppressed.reason).toBe(AlertSuppressionReason.WITHIN_COOLDOWN);

      expect(await totalUpdates(tdb)).toBe(1);
      expect(await totalOutbox(tdb)).toBe(1);
    });
  }, 120_000);

  it('emits nothing when the event disagrees with the reassessment', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const prior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, { runRef }),
      );

      const cancellation = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.CANCELLATION,
        reassessment: fx.reassessmentFixture(),
        now: T0,
      });
      expect(cancellation.kind).toBe('NO_UPDATE');
      if (cancellation.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
      expect(cancellation.reason).toBe('CANCELLATION_NOT_RECORDED');

      const expiry = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.EXPIRY,
        reassessment: fx.reassessmentFixture(),
        now: T0,
      });
      expect(expiry.kind).toBe('NO_UPDATE');
      if (expiry.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
      expect(expiry.reason).toBe('EXPIRY_NOT_DUE');

      const risk = evaluatePriorAlertUpdate({
        prior,
        event: AlertPriorEvent.RISK,
        reassessment: fx.reassessmentFixture(),
        now: T0,
      });
      expect(risk.kind).toBe('NO_UPDATE');
      if (risk.kind !== 'NO_UPDATE') throw new Error('expected NO_UPDATE');
      expect(risk.reason).toBe('RISK_NOT_PRESENT');

      expect(await totalUpdates(tdb)).toBe(0);
      expect(await totalOutbox(tdb)).toBe(0);
    });
  }, 120_000);

  it('refuses a classification whose class disagrees with the evaluated update', async () => {
    await withAlertDb(async (tdb) => {
      const runRef = await seedAlertRun(tdb.engine);
      const deteriorationPrior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.DETERIORATION, { runRef }),
      );
      const riskPrior = await recordPrior(
        tdb,
        fx.priorAlertFixture(AlertPriorEvent.RISK, {
          runRef,
          alertClass: 'CONFIRMED_OPPORTUNITY',
          alertRef: 'aalt-prior-risk-mismatch',
          fingerprint: fx.ALERT_HASH_D,
        }),
      );

      const deterioration = evaluatePriorAlertUpdate({
        prior: deteriorationPrior,
        event: AlertPriorEvent.DETERIORATION,
        reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
        now: T0,
      });
      const risk = evaluatePriorAlertUpdate({
        prior: riskPrior,
        event: AlertPriorEvent.RISK,
        reassessment: fx.RISK_REASSESSMENT,
        now: T0,
      });
      if (deterioration.kind !== 'UPDATE' || risk.kind !== 'UPDATE') {
        throw new Error('expected two update candidates');
      }
      // A RISK notification can never be committed as a deterioration update.
      const mismatched = buildUpdateNotification(risk, fx.notificationContextFixture(T0));

      await expectForesiftError(
        commitAlertUpdate(tdb.engine, {
          candidate: deterioration,
          classification: mismatched.classification,
          content: mismatched.content,
          decisionReadyAt: T0,
          now: T0,
        }),
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
      expect(await totalUpdates(tdb)).toBe(0);
      expect(await totalOutbox(tdb)).toBe(0);

      // The pure-side guard for the same law.
      expectAlertCodeSync(
        () =>
          evaluatePriorAlertUpdate({
            prior: deteriorationPrior,
            event: 'NOT_AN_EVENT' as never,
            reassessment: fx.MATERIAL_DETERIORATION_REASSESSMENT,
            now: T0,
          }),
        ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      );
    });
  }, 120_000);
});
