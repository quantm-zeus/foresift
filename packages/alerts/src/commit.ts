/**
 * Thin adapter over the engine's §26.5 atomic commit boundary (T016,
 * FR-ALERT-001/004, AC-141; PRD §26.5/§33.9; plan D1, ADR-G2ALERT-2).
 *
 * This module does exactly four things and nothing else:
 * 1. validate the classified alert plus the rendered content envelope;
 * 2. derive the idempotent §26.4 fingerprint address
 *    (`sha256Text(fingerprintOf(input))`) and the
 *    `(prior_alert, update_kind, fingerprint, thesis_version)` update key;
 * 3. apply the §33.9 latency-budget law: a budget-exceeded alert is expired or
 *    suppressed rather than delivered late;
 * 4. call the engine's `commitDecisionWithOutbox` with the
 *    `OPPORTUNITY_NOTIFICATION` influence and return its result UNCHANGED.
 *
 * It NEVER opens its own transaction, NEVER writes outbox rows directly, and
 * NEVER reimplements delivery/retry/channel logic — those guarantees belong to
 * `@foresift/workflow-runtime` (durable-workflow plan D1).
 *
 * Strictly read-only: nothing here can trade, hold custody, sign, handle private
 * keys, or submit a transaction.
 */
import {
  AlertLatencyBudgetOutcome,
  AlertSuppressionReason,
  ErrorCode,
  ForesiftError,
  actionabilityFor,
  fingerprintOf,
  latencyBudgetOutcomeFor,
  type AlertFingerprintInput,
  type AlertUpdateKind,
  type ShadowInfluenceKind,
} from '@foresift/domain';
import { parseAlertSchema } from '@foresift/shared-schemas';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  OutboxCommitOutcome,
  commitDecisionWithOutbox,
  type CommitDecisionWithOutboxResult,
} from '@foresift/workflow-runtime';
import {
  AlertClassificationKind,
  isClassified,
  type AlertClassificationOutcome,
} from './classification.ts';
import type { RenderedAlertContent } from './content.ts';

/** §33.1: alert delivery after decision commit is budgeted at 30 seconds. */
export const ALERT_DELIVERY_LATENCY_BUDGET_MS = 30_000 as const;
/** The default admin inbox channel; channels are owned by the engine. */
export const ALERT_NOTIFICATION_CHANNEL = 'admin-inbox' as const;

// --- idempotency keys -------------------------------------------------------

export interface AlertFingerprintKey {
  /** The canonical §26.4 preimage (see `packages/domain/src/alert.ts`). */
  readonly fingerprintPreimage: string;
  /** `sha256:<64hex>` content address over the preimage. */
  readonly fingerprintHash: string;
}

/**
 * Derive the §26.4 fingerprint content address. The domain package returns the
 * byte-stable preimage; the persistence seam owns the hash, exactly like
 * `computeExactCacheKey`. The result is the idempotency anchor for the alert.
 */
export function deriveAlertFingerprint(input: AlertFingerprintInput): AlertFingerprintKey {
  const fingerprintPreimage = fingerprintOf(input);
  return Object.freeze({
    fingerprintPreimage,
    fingerprintHash: sha256Text(fingerprintPreimage),
  });
}

export interface AlertUpdateKeyInput {
  readonly priorAlertRef: string;
  readonly updateKind: AlertUpdateKind;
  readonly fingerprintHash: string;
  readonly thesisVersion: number;
}

/**
 * Deterministic update/cancellation idempotency key over the canonical
 * `(prior_alert, update_kind, fingerprint, thesis_version)` tuple (plan D5).
 * A replay of the same material event maps to one key.
 */
export function deriveAlertUpdateKey(input: AlertUpdateKeyInput): string {
  const parts = [
    'alert-update:v1',
    `priorAlertRef=${input.priorAlertRef.length}:${input.priorAlertRef}`,
    `updateKind=${input.updateKind}`,
    `fingerprint=${input.fingerprintHash}`,
    `thesisVersion=${input.thesisVersion}`,
  ];
  return sha256Text(parts.join('|'));
}

// --- commit -----------------------------------------------------------------

export interface CommitAlertInput {
  readonly runId: string;
  readonly decisionId: string;
  readonly decisionKind: string;
  readonly alertId: string;
  /** Destination channel; defaults to the admin inbox. */
  readonly channel?: string;
  readonly classification: AlertClassificationOutcome;
  readonly content: RenderedAlertContent;
  /** The §26.4 fingerprint fields for this alert. */
  readonly fingerprint: AlertFingerprintInput;
  /** The §33.9 decision-ready instant the latency budget is measured from. */
  readonly decisionReadyAt: string;
  /** Latency budget override; defaults to `ALERT_DELIVERY_LATENCY_BUDGET_MS`. */
  readonly budgetMs?: number;
  /** Injected clock; defaults to the wall clock. */
  readonly now?: string;
  /** Optional deterministic outbox id (a replay then collapses on the PK). */
  readonly outboxId?: string;
  readonly outcome?: OutboxCommitOutcome;
  readonly influence?: ShadowInfluenceKind;
}

export type AlertCommitResult =
  | {
      readonly kind: 'COMMITTED';
      readonly fingerprintHash: string;
      /** The engine result, returned unchanged. */
      readonly engine: CommitDecisionWithOutboxResult;
    }
  | {
      readonly kind: 'SUPPRESSED';
      readonly fingerprintHash: string;
      readonly reason: AlertSuppressionReason;
      readonly latencyOutcome: AlertLatencyBudgetOutcome | null;
    };

function isoTimestamp(value: string, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ForesiftError(ErrorCode.CONTRACT_INVARIANT_VIOLATED, `${field} is not a timestamp`, {
      field,
    });
  }
  return value;
}

function assertCommittable(input: CommitAlertInput): void {
  if (input.content.alertClass !== input.classification.alertClass) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'rendered content class does not match the classified alert class',
      { classified: input.classification.alertClass, rendered: input.content.alertClass },
    );
  }
}

/**
 * Validate, derive the fingerprint, apply the §33.9 budget law, and commit
 * through the engine boundary. Returns `SUPPRESSED` (with no database write) for
 * a suppressed classification or a budget-exceeded alert.
 */
export async function commitAlert(
  engine: DatabaseEngine,
  input: CommitAlertInput,
): Promise<AlertCommitResult> {
  const now = isoTimestamp(input.now ?? new Date().toISOString(), 'now');
  const decisionReadyAt = isoTimestamp(input.decisionReadyAt, 'decisionReadyAt');
  const fingerprint = deriveAlertFingerprint(input.fingerprint);

  if (
    input.classification.kind !== AlertClassificationKind.CLASSIFIED ||
    !isClassified(input.classification)
  ) {
    return Object.freeze({
      kind: 'SUPPRESSED',
      fingerprintHash: fingerprint.fingerprintHash,
      reason: input.classification.suppressionReason ?? AlertSuppressionReason.GATE_REFUSED,
      latencyOutcome: null,
    });
  }
  assertCommittable(input);

  // Re-validate the rendered payload at the boundary: the commit adapter trusts
  // nothing it hands to the engine.
  const envelope = parseAlertSchema('OpportunityContentEnvelope', input.content.envelope);

  // §33.9: budget elapsed decision-ready → delivery. A non-positive budget is a
  // caller bug (the domain law refuses it).
  const budgetMs = input.budgetMs ?? ALERT_DELIVERY_LATENCY_BUDGET_MS;
  const elapsedMs = Date.parse(now) - Date.parse(decisionReadyAt);
  const cancellation = envelope.cancellationState;
  const actionability = actionabilityFor(envelope.validUntil, cancellation, now);
  const latencyOutcome = latencyBudgetOutcomeFor({
    elapsedMs: Math.max(0, elapsedMs),
    budgetMs,
    actionability,
  });
  if (latencyOutcome !== AlertLatencyBudgetOutcome.WITHIN_BUDGET) {
    return Object.freeze({
      kind: 'SUPPRESSED',
      fingerprintHash: fingerprint.fingerprintHash,
      reason:
        latencyOutcome === AlertLatencyBudgetOutcome.BUDGET_EXCEEDED_EXPIRED
          ? AlertSuppressionReason.EXPIRED_ACTIONABILITY
          : AlertSuppressionReason.GATE_REFUSED,
      latencyOutcome,
    });
  }

  const decisionPayload = Object.freeze({
    decisionId: input.decisionId,
    alertId: input.alertId,
    alertClass: input.classification.alertClass,
    fingerprint: fingerprint.fingerprintHash,
    fingerprintPreimage: fingerprint.fingerprintPreimage,
    thesisVersion: input.fingerprint.thesisVersion,
    contentHash: input.content.contentHash,
  });

  // ONE engine call. The engine owns the transaction, the outbox row, and
  // exactly-once delivery; this adapter never touches them directly.
  const engineResult = await commitDecisionWithOutbox(engine, {
    runId: input.runId,
    decision: {
      decisionId: input.decisionId,
      decisionKind: input.decisionKind,
      payload: decisionPayload,
      payloadHash: sha256Text(canonicalJson(decisionPayload)),
    },
    alert: {
      alertId: input.alertId,
      alertClass: input.classification.alertClass,
      payload: envelope,
      payloadHash: input.content.contentHash,
    },
    outbox: {
      ...(input.outboxId === undefined ? {} : { outboxId: input.outboxId }),
      channel: input.channel ?? ALERT_NOTIFICATION_CHANNEL,
      payloadHash: input.content.contentHash,
      alertRef: input.alertId,
    },
    influence: input.influence ?? 'OPPORTUNITY_NOTIFICATION',
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    now,
  });

  return Object.freeze({
    kind: 'COMMITTED',
    fingerprintHash: fingerprint.fingerprintHash,
    engine: engineResult,
  });
}
