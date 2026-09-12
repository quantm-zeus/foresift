/**
 * Deterministic expiry/deterioration sweep (T021, FR-ALERT-004, AC-141;
 * PRD §26.2/§26.4/§33.9; plan D3/D5).
 *
 * `sweepAlertLifecycle` is the bounded, clock-injected entry point that selects
 * prior actionable alerts due for reassessment from `alert.alert_records`,
 * applies the T019 material/fingerprint decision and the T020 update commit, and
 * records one outcome per examined alert (counted per class).
 *
 * Two §33.9 laws hold regardless of the reassessment source:
 * - an alert past `valid_until` (or explicitly cancelled) is transitioned to
 *   `EXPIRED` and never reaches the delivery path;
 * - an update whose decision-ready → delivery budget has elapsed is expired and
 *   suppressed instead of being sent late.
 *
 * The sweep itself opens no transaction and writes no outbox row: every
 * notification commit goes through the T020/T016 path into the engine's §26.5
 * boundary. Strictly read-only: nothing here can trade, hold custody, sign,
 * handle private keys, or submit a transaction.
 */
import {
  ActionabilityState,
  AlertClass,
  ALL_ALERT_CLASSES,
  AlertLatencyBudgetOutcome,
  AlertSuppressionReason,
  ErrorCode,
  ForesiftError,
  actionabilityFor,
  utcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '@foresift/persistence';
import { ALERT_DELIVERY_LATENCY_BUDGET_MS } from './commit.ts';
import {
  AlertPriorEvent,
  buildUpdateNotification,
  commitAlertUpdate,
  evaluatePriorAlertUpdate,
  readPriorAlertState,
  transitionAlertActionability,
  type AlertReassessment,
  type AlertUpdateNotificationContext,
  type PriorAlertState,
} from './lifecycle.ts';

/** Default and maximum bounded batch sizes for one sweep. */
export const ALERT_REASSESSMENT_SWEEP_LIMIT_DEFAULT = 50 as const;
export const ALERT_REASSESSMENT_SWEEP_LIMIT_MAX = 500 as const;

/** The injected reassessment for one due prior alert. */
export interface AlertSweepCandidate {
  readonly event: AlertPriorEvent;
  readonly reassessment: AlertReassessment;
  readonly notification: AlertUpdateNotificationContext;
  readonly decisionReadyAt: string;
}

/**
 * Deterministic reassessment source. It receives the persisted prior state and
 * the injected clock instant and returns the reassessment to apply, or null
 * when the prior alert needs no update this pass.
 */
export type AlertReassessmentSource = (
  prior: PriorAlertState,
  now: string,
) => AlertSweepCandidate | null;

export const AlertSweepOutcomeKind = {
  UPDATE_COMMITTED: 'UPDATE_COMMITTED',
  UPDATE_DEDUPLICATED: 'UPDATE_DEDUPLICATED',
  UPDATE_SUPPRESSED: 'UPDATE_SUPPRESSED',
  NO_UPDATE: 'NO_UPDATE',
  EXPIRED_SUPPRESSED: 'EXPIRED_SUPPRESSED',
  SKIPPED: 'SKIPPED',
} as const;
export type AlertSweepOutcomeKind =
  (typeof AlertSweepOutcomeKind)[keyof typeof AlertSweepOutcomeKind];

/** One recorded per-class sweep outcome. */
export interface AlertSweepOutcomeRow {
  readonly alertRef: string;
  readonly alertClass: AlertClass;
  readonly outcome: AlertSweepOutcomeKind;
  readonly updateKind: string | null;
  readonly reason: string | null;
  readonly latencyOutcome: string | null;
}

export interface AlertSweepReport {
  readonly sweptAt: string;
  readonly examined: number;
  readonly outcomes: readonly AlertSweepOutcomeRow[];
  readonly countsByClass: Readonly<Record<AlertClass, number>>;
  readonly countsByOutcome: Readonly<Record<string, number>>;
}

export interface SweepAlertLifecycleInput {
  readonly now: string;
  readonly limit?: number;
  readonly budgetMs?: number;
  readonly channel?: string;
  readonly source?: AlertReassessmentSource;
}

interface DueAlertRow {
  readonly alert_id: string;
}

const SELECT_DUE_ALERTS = `
    SELECT alert_id
      FROM alert.alert_records
     WHERE actionability_state IN ('ACTIONABLE', 'EXPIRING')
     ORDER BY valid_until ASC, alert_id ASC
     LIMIT $1`;

function outcomeRow(
  prior: PriorAlertState,
  outcome: AlertSweepOutcomeKind,
  options: {
    readonly updateKind?: string | null;
    readonly reason?: string | null;
    readonly latencyOutcome?: string | null;
  } = {},
): AlertSweepOutcomeRow {
  return Object.freeze({
    alertRef: prior.alertRef,
    alertClass: prior.alertClass,
    outcome,
    updateKind: options.updateKind ?? null,
    reason: options.reason ?? null,
    latencyOutcome: options.latencyOutcome ?? null,
  });
}

function emptyCountsByClass(): Record<AlertClass, number> {
  return Object.fromEntries(ALL_ALERT_CLASSES.map((alertClass) => [alertClass, 0])) as Record<
    AlertClass,
    number
  >;
}

/**
 * Run one bounded reassessment sweep. Returns the per-class/per-outcome report;
 * callers persist or expose it (the sweep is deterministic, never wall-clock).
 */
export async function sweepAlertLifecycle(
  engine: DatabaseEngine,
  input: SweepAlertLifecycleInput,
): Promise<AlertSweepReport> {
  const now = utcTimestamp(input.now);
  const limit = input.limit ?? ALERT_REASSESSMENT_SWEEP_LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit <= 0 || limit > ALERT_REASSESSMENT_SWEEP_LIMIT_MAX) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `alert reassessment sweep limit must be an integer in 1..${ALERT_REASSESSMENT_SWEEP_LIMIT_MAX}`,
      { limit: Number.isInteger(limit) ? limit : null },
    );
  }
  const budgetMs = input.budgetMs ?? ALERT_DELIVERY_LATENCY_BUDGET_MS;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_LATENCY_OUTCOME_UNKNOWN,
      'alert reassessment budget must be a finite positive number',
      { budgetMs: Number.isFinite(budgetMs) ? budgetMs : null },
    );
  }

  const due = await engine.query<DueAlertRow>(SELECT_DUE_ALERTS, [limit]);
  const outcomes: AlertSweepOutcomeRow[] = [];

  for (const row of due.rows) {
    const prior = await readPriorAlertState(engine, row.alert_id);
    if (prior === null) continue;

    const actionability = actionabilityFor(prior.validUntil, prior.cancellationState, now);
    if (
      actionability === ActionabilityState.EXPIRED ||
      actionability === ActionabilityState.CANCELLED
    ) {
      // §33.9: a non-actionable prior is expired, never delivered late.
      await transitionAlertActionability(engine, prior.alertRef, ActionabilityState.EXPIRED);
      outcomes.push(
        outcomeRow(prior, AlertSweepOutcomeKind.EXPIRED_SUPPRESSED, {
          reason: AlertSuppressionReason.EXPIRED_ACTIONABILITY,
        }),
      );
      continue;
    }

    const candidate = input.source === undefined ? null : input.source(prior, now);
    if (candidate === null) {
      outcomes.push(outcomeRow(prior, AlertSweepOutcomeKind.SKIPPED));
      continue;
    }

    // §33.9 elapsed decision-ready → delivery budget. A cancellation event
    // legitimately carries a CANCELLED actionability; that is the notification's
    // subject, not a reason to suppress it.
    const elapsedMs = Math.max(0, Date.parse(now) - Date.parse(candidate.decisionReadyAt));
    if (elapsedMs > budgetMs) {
      await transitionAlertActionability(engine, prior.alertRef, ActionabilityState.EXPIRED);
      outcomes.push(
        outcomeRow(prior, AlertSweepOutcomeKind.EXPIRED_SUPPRESSED, {
          reason: AlertSuppressionReason.EXPIRED_ACTIONABILITY,
          latencyOutcome: AlertLatencyBudgetOutcome.BUDGET_EXCEEDED_EXPIRED,
        }),
      );
      continue;
    }

    const evaluation = evaluatePriorAlertUpdate({
      prior,
      event: candidate.event,
      reassessment: candidate.reassessment,
      now,
    });
    if (evaluation.kind === 'NO_UPDATE') {
      outcomes.push(
        outcomeRow(prior, AlertSweepOutcomeKind.NO_UPDATE, { reason: evaluation.reason }),
      );
      continue;
    }

    const notification = buildUpdateNotification(evaluation, candidate.notification);
    const commit = await commitAlertUpdate(engine, {
      candidate: evaluation,
      classification: notification.classification,
      content: notification.content,
      decisionReadyAt: candidate.decisionReadyAt,
      now,
      runId: prior.runRef,
      budgetMs,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
    });

    switch (commit.kind) {
      case 'COMMITTED':
        outcomes.push(
          outcomeRow(prior, AlertSweepOutcomeKind.UPDATE_COMMITTED, {
            updateKind: evaluation.updateKind,
          }),
        );
        break;
      case 'DEDUPLICATED':
        outcomes.push(
          outcomeRow(prior, AlertSweepOutcomeKind.UPDATE_DEDUPLICATED, {
            updateKind: evaluation.updateKind,
          }),
        );
        break;
      case 'SUPPRESSED':
        if (commit.reason === AlertSuppressionReason.EXPIRED_ACTIONABILITY) {
          await transitionAlertActionability(engine, prior.alertRef, ActionabilityState.EXPIRED);
        }
        outcomes.push(
          outcomeRow(prior, AlertSweepOutcomeKind.UPDATE_SUPPRESSED, {
            updateKind: evaluation.updateKind,
            reason: commit.reason,
            latencyOutcome: commit.latencyOutcome,
          }),
        );
        break;
      default:
        outcomes.push(
          outcomeRow(prior, AlertSweepOutcomeKind.UPDATE_SUPPRESSED, {
            updateKind: evaluation.updateKind,
            reason: AlertSuppressionReason.GATE_REFUSED,
          }),
        );
    }
  }

  const countsByClass = emptyCountsByClass();
  const countsByOutcome: Record<string, number> = {};
  for (const outcome of outcomes) {
    countsByClass[outcome.alertClass] += 1;
    countsByOutcome[outcome.outcome] = (countsByOutcome[outcome.outcome] ?? 0) + 1;
  }

  return Object.freeze({
    sweptAt: now,
    examined: due.rows.length,
    outcomes: Object.freeze([...outcomes]),
    countsByClass: Object.freeze(countsByClass),
    countsByOutcome: Object.freeze(countsByOutcome),
  });
}

/** Total per-class sweep accounting helper (EARLY_WATCH included explicitly). */
export function sweepCountForClass(report: AlertSweepReport, alertClass: AlertClass): number {
  return report.countsByClass[alertClass] ?? 0;
}
