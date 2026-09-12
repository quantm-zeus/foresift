/**
 * Prior-alert update/cancellation lifecycle (T020, FR-ALERT-004/005, AC-141;
 * PRD §26.2/§26.4/§26.5; plan D5).
 *
 * `evaluatePriorAlertUpdate` is the pure decision: given an actionable prior
 * alert and a reassessment, it derives the update kind
 * (`MATERIAL_DETERIORATION`, `CANCELLATION`, `EXPIRY`, `RISK`), the §26.4
 * fingerprint of the triggering state, and the deterministic idempotency key
 * `(prior_alert, update_kind, fingerprint, thesis_version)`. Below-threshold
 * changes and non-actionable priors return an explicit `NO_UPDATE` — they emit
 * nothing.
 *
 * `commitAlertUpdate` persists the decision in ONE transaction: the
 * `alert.alert_updates` row (UNIQUE idempotency key, so a replay collapses),
 * the engine's §26.5 decision/alert/outbox commit (via slice-2 `commitAlert`),
 * and the fingerprint/cooldown ledger advance. A duplicate inside the recorded
 * cooldown is suppressed; a §33.9 budget-exceeded update is suppressed rather
 * than delivered late.
 *
 * Strictly read-only: the lifecycle only decides whether intelligence may be
 * delivered; nothing here can trade, hold custody, sign, handle private keys, or
 * submit a transaction.
 */
import {
  ActionabilityState,
  AlertCancellationState,
  AlertClass,
  AlertLatencyBudgetOutcome,
  AlertSuppressionReason,
  AlertUpdateKind,
  ErrorCode,
  ForesiftError,
  actionabilityFor,
  latencyBudgetOutcomeFor,
  parseAlertClass,
  socialIsUnknownCoverage,
  updateIsEligible,
  utcTimestamp,
  type AlertFingerprintInput,
  type AlertMaterialState,
  type CandidateLifecycleState,
  type CandidateRiskState,
  type SocialCapabilityState,
} from '@foresift/domain';
import { parseAlertSchema, type AlertRecordRow } from '@foresift/shared-schemas';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';
import {
  type AlertCommitResult,
  type CommitAlertInput,
  ALERT_DELIVERY_LATENCY_BUDGET_MS,
  commitAlert,
} from './commit.ts';
import {
  AlertClassificationKind,
  isClassified,
  type AlertClassificationOutcome,
} from './classification.ts';
import { renderAlertContent, type RenderedAlertContent } from './content.ts';
import { alertPolicyFor, type AlertPolicy, type AlertPolicyRegistry } from './policies.ts';
import {
  cooldownUntilFrom,
  contentAddressHex,
  deriveAlertFingerprint,
  deriveAlertUpdateKey,
  evaluateMaterialChange,
  isMaterialDeterioration,
  readAlertFingerprint,
  upsertAlertFingerprint,
  type MaterialChangeVerdict,
} from './fingerprints.ts';

// --- prior alert state ------------------------------------------------------

/** Closed prior-alert event vocabulary (maps 1:1 onto `AlertUpdateKind`). */
export const AlertPriorEvent = {
  DETERIORATION: 'DETERIORATION',
  CANCELLATION: 'CANCELLATION',
  EXPIRY: 'EXPIRY',
  RISK: 'RISK',
} as const;
export type AlertPriorEvent = (typeof AlertPriorEvent)[keyof typeof AlertPriorEvent];
export const ALL_ALERT_PRIOR_EVENTS: readonly AlertPriorEvent[] = Object.values(AlertPriorEvent);

/** Metadata key under `execution_assumptions` carrying the §26.4 prior fields. */
export const ALERT_PRIOR_METADATA_KEY = 'foresift_alert_prior' as const;

/** The §26.4 state of a prior actionable alert, as persisted. */
export interface PriorAlertState {
  readonly alertRef: string;
  readonly runRef: string;
  readonly assetId: string;
  readonly profileId: string;
  readonly executionScenarioId: string;
  readonly validUntilGeneration: number;
  readonly materialEvidenceFingerprint: string;
  readonly alertClass: AlertClass;
  /** `sha256:<hex>` identity of the prior alert (the cooldown ledger key). */
  readonly fingerprint: string;
  readonly thesisVersion: number;
  readonly severity: number;
  readonly lifecycleState: CandidateLifecycleState;
  readonly riskState: CandidateRiskState;
  readonly actionabilityState: ActionabilityState;
  readonly validUntil: string;
  readonly cancellationState: AlertCancellationState;
}

/** The reassessed state that may trigger an update notification. */
export interface AlertReassessment {
  readonly severity: number;
  readonly thesisVersion: number;
  readonly materialEvidenceFingerprint: string;
  readonly lifecycleState: CandidateLifecycleState;
  readonly riskState: CandidateRiskState;
  readonly cancellationState: AlertCancellationState;
  readonly validUntil: string;
  /** True when the reassessment explicitly observed expiry (clock or event). */
  readonly expiredActionability?: boolean;
}

/** Local no-update reasons (the domain reasons cover the actionable cases). */
export const AlertUpdateNoUpdateReason = {
  NOT_ACTIONABLE_EXPIRED: 'NOT_ACTIONABLE_EXPIRED',
  IMMATERIAL_CHANGE: 'IMMATERIAL_CHANGE',
  RISK_NOT_PRESENT: 'RISK_NOT_PRESENT',
  CANCELLATION_NOT_RECORDED: 'CANCELLATION_NOT_RECORDED',
  EXPIRY_NOT_DUE: 'EXPIRY_NOT_DUE',
  UNKNOWN_EVENT: 'UNKNOWN_EVENT',
} as const;
export type AlertUpdateNoUpdateReason =
  (typeof AlertUpdateNoUpdateReason)[keyof typeof AlertUpdateNoUpdateReason];

// --- event ↔ class ↔ update-kind mapping ------------------------------------

const RISK_CLASS_RISK: readonly CandidateRiskState[] = ['HIGH', 'CRITICAL', 'CONFLICTING'];

/** The §26.2 class an update notification for `event` is classified under. */
export function alertClassForPriorEvent(event: AlertPriorEvent): AlertClass {
  switch (event) {
    case AlertPriorEvent.DETERIORATION:
      return AlertClass.THESIS_WEAKENING;
    case AlertPriorEvent.CANCELLATION:
    case AlertPriorEvent.EXPIRY:
      return AlertClass.OPPORTUNITY_EXPIRED;
    case AlertPriorEvent.RISK:
      return AlertClass.RISK_ALERT;
    default:
      throw new ForesiftError(ErrorCode.CONTRACT_INVARIANT_VIOLATED, 'unknown prior-alert event', {
        event: String(event),
      });
  }
}

/** The persisted update kind for `event`. */
export function alertUpdateKindForPriorEvent(event: AlertPriorEvent): AlertUpdateKind {
  switch (event) {
    case AlertPriorEvent.DETERIORATION:
      return AlertUpdateKind.MATERIAL_DETERIORATION;
    case AlertPriorEvent.CANCELLATION:
      return AlertUpdateKind.CANCELLATION;
    case AlertPriorEvent.EXPIRY:
      return AlertUpdateKind.EXPIRY;
    case AlertPriorEvent.RISK:
      return AlertUpdateKind.RISK;
    default:
      throw new ForesiftError(ErrorCode.CONTRACT_INVARIANT_VIOLATED, 'unknown prior-alert event', {
        event: String(event),
      });
  }
}

/** Fail-closed parser for the local event vocabulary. */
export function parseAlertPriorEvent(value: unknown): AlertPriorEvent {
  if (typeof value === 'string' && (ALL_ALERT_PRIOR_EVENTS as readonly string[]).includes(value)) {
    return value as AlertPriorEvent;
  }
  throw new ForesiftError(ErrorCode.CONTRACT_INVARIANT_VIOLATED, 'unknown prior-alert event', {
    event: typeof value === 'string' ? value : null,
  });
}

// --- evaluation -------------------------------------------------------------

/** A material update decision: everything the commit step needs. */
export interface AlertUpdateCandidate {
  readonly kind: 'UPDATE';
  readonly event: AlertPriorEvent;
  readonly updateKind: AlertUpdateKind;
  readonly alertClass: AlertClass;
  readonly policy: AlertPolicy;
  readonly prior: PriorAlertState;
  readonly reassessment: AlertReassessment;
  readonly priorMaterialState: AlertMaterialState;
  readonly materialState: AlertMaterialState;
  readonly materialChange: MaterialChangeVerdict;
  readonly fingerprintInput: AlertFingerprintInput;
  readonly fingerprintPreimage: string;
  /** §26.4 identity of the triggering state (addresses the update row). */
  readonly fingerprintHash: string;
  /** Prior alert identity; the fingerprint/cooldown ledger key. */
  readonly ledgerFingerprint: string;
  readonly idempotencyKey: string;
}

export type AlertUpdateEvaluation =
  | AlertUpdateCandidate
  | {
      readonly kind: 'NO_UPDATE';
      readonly priorAlertRef: string;
      readonly reason: AlertUpdateNoUpdateReason | AlertSuppressionReason;
    };

export interface EvaluatePriorAlertUpdateInput {
  readonly prior: PriorAlertState;
  readonly event: AlertPriorEvent;
  readonly reassessment: AlertReassessment;
  readonly now: string;
  readonly policy?: AlertPolicy;
  readonly registry?: AlertPolicyRegistry;
}

function materialStateFor(
  alertClass: AlertClass,
  state: {
    readonly severity: number;
    readonly thesisVersion: number;
    readonly materialEvidenceFingerprint: string;
  },
): AlertMaterialState {
  return Object.freeze({
    alertClass,
    severity: state.severity,
    thesisVersion: state.thesisVersion,
    materialEvidenceFingerprint: state.materialEvidenceFingerprint,
  });
}

function noUpdate(
  priorAlertRef: string,
  reason: AlertUpdateNoUpdateReason | AlertSuppressionReason,
): AlertUpdateEvaluation {
  return Object.freeze({ kind: 'NO_UPDATE', priorAlertRef, reason } as const);
}

function resolvePolicy(input: EvaluatePriorAlertUpdateInput, alertClass: AlertClass): AlertPolicy {
  if (input.policy !== undefined) return input.policy;
  if (input.registry !== undefined) return input.registry.policyFor(alertClass);
  return alertPolicyFor(alertClass);
}

/**
 * Pure, total evaluation of one prior-alert event. Returns an
 * `AlertUpdateCandidate` when a material update/cancellation notification is
 * warranted, otherwise an explicit `NO_UPDATE` (non-actionable prior,
 * below-threshold change, or an event inconsistent with the reassessment).
 */
export function evaluatePriorAlertUpdate(
  input: EvaluatePriorAlertUpdateInput,
): AlertUpdateEvaluation {
  const event = parseAlertPriorEvent(input.event);
  const now = utcTimestamp(input.now);
  const alertClass = alertClassForPriorEvent(event);
  const updateKind = alertUpdateKindForPriorEvent(event);
  const policy = resolvePolicy(input, alertClass);
  if (policy.alertClass !== alertClass) {
    throw new ForesiftError(
      ErrorCode.ALERT_POLICY_UNKNOWN,
      'resolved policy class does not match the update notification class',
      { alertClass, policyClass: policy.alertClass },
    );
  }

  const actionability = actionabilityFor(
    input.prior.validUntil,
    input.prior.cancellationState,
    now,
  );
  if (!updateIsEligible(actionability)) {
    return noUpdate(input.prior.alertRef, AlertUpdateNoUpdateReason.NOT_ACTIONABLE_EXPIRED);
  }

  const thresholds = policy.thresholds;
  const priorMaterialState = materialStateFor(input.prior.alertClass, input.prior);
  const materialState = materialStateFor(alertClass, input.reassessment);
  const materialChange = evaluateMaterialChange(priorMaterialState, materialState, thresholds);

  switch (event) {
    case AlertPriorEvent.DETERIORATION:
      if (!isMaterialDeterioration(priorMaterialState, materialState, thresholds)) {
        return noUpdate(input.prior.alertRef, AlertUpdateNoUpdateReason.IMMATERIAL_CHANGE);
      }
      break;
    case AlertPriorEvent.RISK:
      if (!RISK_CLASS_RISK.includes(input.reassessment.riskState)) {
        return noUpdate(input.prior.alertRef, AlertUpdateNoUpdateReason.RISK_NOT_PRESENT);
      }
      break;
    case AlertPriorEvent.CANCELLATION:
      if (input.reassessment.cancellationState !== AlertCancellationState.CANCELLED) {
        return noUpdate(input.prior.alertRef, AlertUpdateNoUpdateReason.CANCELLATION_NOT_RECORDED);
      }
      break;
    case AlertPriorEvent.EXPIRY: {
      const expiryDue =
        actionability === ActionabilityState.EXPIRING ||
        input.reassessment.expiredActionability === true;
      if (!expiryDue) {
        return noUpdate(input.prior.alertRef, AlertUpdateNoUpdateReason.EXPIRY_NOT_DUE);
      }
      break;
    }
    default:
      return noUpdate(input.prior.alertRef, AlertUpdateNoUpdateReason.UNKNOWN_EVENT);
  }

  const fingerprintInput: AlertFingerprintInput = {
    assetId: input.prior.assetId,
    profileId: input.prior.profileId,
    alertType: alertClass,
    lifecycleState: input.reassessment.lifecycleState,
    riskState: input.reassessment.riskState,
    thesisVersion: input.reassessment.thesisVersion,
    executionScenarioId: input.prior.executionScenarioId,
    validUntilGeneration: input.prior.validUntilGeneration,
    materialEvidenceFingerprint: input.reassessment.materialEvidenceFingerprint,
  };
  const fingerprint = deriveAlertFingerprint(fingerprintInput);
  const idempotencyKey = deriveAlertUpdateKey({
    priorAlertRef: input.prior.alertRef,
    updateKind,
    fingerprintHash: fingerprint.fingerprintHash,
    thesisVersion: input.reassessment.thesisVersion,
  });

  return Object.freeze({
    kind: 'UPDATE',
    event,
    updateKind,
    alertClass,
    policy,
    prior: input.prior,
    reassessment: input.reassessment,
    priorMaterialState,
    materialState,
    materialChange,
    fingerprintInput,
    fingerprintPreimage: fingerprint.fingerprintPreimage,
    fingerprintHash: fingerprint.fingerprintHash,
    ledgerFingerprint: input.prior.fingerprint,
    idempotencyKey,
    // Re-parse the kind so an unexpected value fails closed at this boundary.
  });
}

// --- notification construction ---------------------------------------------

/** Caller-supplied identity/narrative context for the update notification. */
export interface AlertUpdateNotificationContext {
  readonly chainId: string;
  readonly canonicalContract: string;
  readonly candidateStage: CandidateLifecycleState;
  readonly detectedAt: string;
  readonly deliveredAt: string;
  readonly evidenceTimestamp: string;
  readonly frozenRunRef: string;
  readonly frozenEvidenceRef: string;
  readonly researchDisclaimer: string;
  readonly candidateHeadline: string;
  readonly whyEarly: string;
  readonly counterThesis: string;
  readonly socialCapabilityState: SocialCapabilityState;
  readonly positiveEvidence?: readonly string[];
  readonly riskEvidence?: readonly string[];
  readonly missingData?: readonly string[];
  readonly configuredNotionalUsd?: string;
  readonly executionAssumptions?: Record<string, unknown>;
  readonly decisionReadyAt?: string;
}

/** The classified + rendered update notification plus its deterministic ids. */
export interface AlertUpdateNotification {
  readonly classification: AlertClassificationOutcome;
  readonly content: RenderedAlertContent;
  readonly decisionReadyAt: string;
  readonly alertId: string;
  readonly decisionId: string;
  readonly outboxId: string;
}

function classifiedUpdateOutcome(
  alertClass: AlertClass,
  policy: AlertPolicy,
  socialCapabilityState: SocialCapabilityState,
): AlertClassificationOutcome {
  const socialUnknownCoverage = socialIsUnknownCoverage(socialCapabilityState);
  return Object.freeze({
    kind: AlertClassificationKind.CLASSIFIED,
    alertClass,
    policy,
    contentTemplate: policy.content.template,
    gates: [],
    suppressionReason: null,
    socialUnknownCoverage,
    organicConfirmationClaimed: false,
    // Update notifications never go through the confirmed-opportunity gate set.
    gateSetComplete: false,
  });
}

/**
 * Build the classified update notification and its rendered content. The class
 * comes from the event; the content template from the resolved class policy. The
 * deterministic ids derive from the idempotency key, so a replay addresses the
 * same alert/decision/outbox row.
 */
export function buildUpdateNotification(
  candidate: AlertUpdateCandidate,
  context: AlertUpdateNotificationContext,
): AlertUpdateNotification {
  const now = utcTimestamp(context.deliveredAt);
  const hashHex = contentAddressHex(candidate.idempotencyKey);
  const alertId = `aalt_${hashHex}`;
  const decisionId = `adec_${hashHex}`;
  const outboxId = `aout_${hashHex}`;
  const cancellationState = candidate.reassessment.cancellationState;
  const actionabilityState = actionabilityFor(
    candidate.reassessment.validUntil,
    cancellationState,
    now,
  );

  const classification = classifiedUpdateOutcome(
    candidate.alertClass,
    candidate.policy,
    context.socialCapabilityState,
  );

  const content = renderAlertContent({
    classification,
    identity: {
      alertId,
      assetId: candidate.prior.assetId,
      chainId: context.chainId,
      canonicalContract: context.canonicalContract,
      profileId: candidate.prior.profileId,
      candidateStage: context.candidateStage,
      detectedAt: context.detectedAt,
      deliveredAt: context.deliveredAt,
    },
    narrative: {
      whyEarly: context.whyEarly,
      positiveEvidence: [...(context.positiveEvidence ?? [])],
      riskEvidence: [...(context.riskEvidence ?? [])],
      counterThesis: context.counterThesis,
      alphaEvidence: [],
      patternStage: null,
      patternRemainingActionability: null,
      multiViewContradictions: [],
      vetoes: [],
      failureHazardDrivers: [],
      noveltyApplicabilityLimits: [],
      providerConflicts: [],
      thesisInvalidationConditions: [],
      sources: [],
      freshness: context.evidenceTimestamp,
    },
    validUntil: candidate.reassessment.validUntil,
    actionabilityState,
    cancellationState,
    evidenceTimestamp: context.evidenceTimestamp,
    configuredNotionalUsd: context.configuredNotionalUsd ?? null,
    modeledEntryImpact: null,
    modeledExitImpact: null,
    executionAssumptions: context.executionAssumptions ?? null,
    frozenRunRef: context.frozenRunRef,
    frozenEvidenceRef: context.frozenEvidenceRef,
    researchDisclaimer: context.researchDisclaimer,
    socialCapabilityState: context.socialCapabilityState,
    execution: null,
    suppression: {
      criticalContradiction: false,
      requiredDelayScenarioPassed: true,
      adaptersSupported: true,
      performanceClaimAuthorized: true,
    },
    missingData: [...(context.missingData ?? [])],
    candidateHeadline: context.candidateHeadline,
  });

  return Object.freeze({
    classification,
    content,
    decisionReadyAt: context.decisionReadyAt ?? context.evidenceTimestamp,
    alertId,
    decisionId,
    outboxId,
  });
}

// --- commit -----------------------------------------------------------------

export interface CommitAlertUpdateInput {
  readonly candidate: AlertUpdateCandidate;
  readonly classification: AlertClassificationOutcome;
  readonly content: RenderedAlertContent;
  readonly decisionReadyAt: string;
  readonly now: string;
  /** Defaults to the prior alert's run reference. */
  readonly runId?: string;
  readonly budgetMs?: number;
  readonly channel?: string;
  /** Deterministic ids; default to the candidate's derived ids. */
  readonly alertId?: string;
  readonly decisionId?: string;
  readonly outboxId?: string;
  readonly updateId?: string;
}

export type AlertUpdateCommitResult =
  | {
      readonly kind: 'COMMITTED';
      readonly updateId: string;
      readonly idempotencyKey: string;
      readonly fingerprintHash: string;
      readonly outboxId: string;
      readonly outboxRef: string;
      readonly engine: AlertCommitResult & { readonly kind: 'COMMITTED' };
    }
  | {
      readonly kind: 'DEDUPLICATED';
      readonly updateId: string;
      readonly idempotencyKey: string;
      readonly fingerprintHash: string;
      readonly outboxRef: string | null;
    }
  | {
      readonly kind: 'SUPPRESSED';
      readonly idempotencyKey: string;
      readonly fingerprintHash: string;
      readonly reason: AlertSuppressionReason;
      readonly latencyOutcome: AlertLatencyBudgetOutcome | null;
    };

/** Internal rollback signal: the engine commit refused inside our transaction. */
class AlertUpdateSuppressedSignal extends Error {
  readonly reason: AlertSuppressionReason;
  readonly latencyOutcome: AlertLatencyBudgetOutcome | null;

  constructor(reason: AlertSuppressionReason, latencyOutcome: AlertLatencyBudgetOutcome | null) {
    super('alert update commit suppressed');
    this.name = 'AlertUpdateSuppressedSignal';
    this.reason = reason;
    this.latencyOutcome = latencyOutcome;
  }
}

interface ExistingUpdateRow {
  readonly update_id: string;
  readonly outbox_ref: string | null;
}

interface RawUpdateRow {
  readonly update_id: string;
  readonly prior_alert_ref: string;
  readonly update_kind: string;
  readonly fingerprint: string;
  readonly idempotency_key: string;
  readonly alert_ref: string;
  readonly outbox_ref: string | null;
  readonly created_at: string;
}

const SELECT_UPDATE_BY_KEY = `
    SELECT update_id, outbox_ref
      FROM alert.alert_updates
     WHERE idempotency_key = $1`;

const INSERT_UPDATE = `
    INSERT INTO alert.alert_updates
        (update_id, prior_alert_ref, update_kind, fingerprint, idempotency_key,
         alert_ref, outbox_ref, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING update_id, outbox_ref`;

const SET_UPDATE_OUTBOX = `
    UPDATE alert.alert_updates
       SET outbox_ref = $2
     WHERE update_id = $1
    RETURNING update_id, outbox_ref, prior_alert_ref, update_kind, fingerprint,
              idempotency_key, alert_ref, created_at`;

function assertCommittableUpdate(input: CommitAlertUpdateInput): void {
  const { candidate, classification, content } = input;
  if (!isClassified(classification) || classification.alertClass !== candidate.alertClass) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'update classification does not match the evaluated update kind',
      { expected: candidate.alertClass, actual: classification.alertClass },
    );
  }
  if (content.alertClass !== candidate.alertClass) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'rendered update content class does not match the evaluated update kind',
      { expected: candidate.alertClass, rendered: content.alertClass },
    );
  }
}

/**
 * Persist one evaluated update: update row + engine commit + ledger advance in
 * one transaction. A replay returns `DEDUPLICATED` (one notification); a repeat
 * inside the recorded cooldown is `SUPPRESSED` and never reaches delivery.
 */
export async function commitAlertUpdate(
  engine: DatabaseEngine,
  input: CommitAlertUpdateInput,
): Promise<AlertUpdateCommitResult> {
  const { candidate, classification, content } = input;
  assertCommittableUpdate(input);
  const now = utcTimestamp(input.now);
  const decisionReadyAt = utcTimestamp(input.decisionReadyAt);
  const runId = input.runId ?? candidate.prior.runRef;
  const hashHex = contentAddressHex(candidate.idempotencyKey);
  const updateId = input.updateId ?? `aupd_${hashHex}`;
  const alertId = input.alertId ?? `aalt_${hashHex}`;
  const decisionId = input.decisionId ?? `adec_${hashHex}`;
  const outboxId = input.outboxId ?? `aout_${hashHex}`;

  // §33.9: a budget-exceeded update is suppressed, never delivered late.
  const budgetMs = input.budgetMs ?? ALERT_DELIVERY_LATENCY_BUDGET_MS;
  const elapsedMs = Math.max(0, Date.parse(now) - Date.parse(decisionReadyAt));
  const contentActionability = actionabilityFor(
    content.envelope.validUntil,
    content.envelope.cancellationState,
    now,
  );
  const latencyOutcome = latencyBudgetOutcomeFor({
    elapsedMs,
    budgetMs,
    actionability: contentActionability,
  });
  if (latencyOutcome !== AlertLatencyBudgetOutcome.WITHIN_BUDGET) {
    return Object.freeze({
      kind: 'SUPPRESSED',
      idempotencyKey: candidate.idempotencyKey,
      fingerprintHash: candidate.fingerprintHash,
      reason: AlertSuppressionReason.EXPIRED_ACTIONABILITY,
      latencyOutcome,
    });
  }

  const engineCommitInput: CommitAlertInput = {
    runId,
    decisionId,
    decisionKind: 'ALERT_UPDATE',
    alertId,
    classification,
    content,
    fingerprint: candidate.fingerprintInput,
    decisionReadyAt,
    now,
    budgetMs,
    outboxId,
    ...(input.channel === undefined ? {} : { channel: input.channel }),
  };

  try {
    return await engine.transaction(async (tx): Promise<AlertUpdateCommitResult> => {
      const existing = await tx.query<ExistingUpdateRow>(SELECT_UPDATE_BY_KEY, [
        candidate.idempotencyKey,
      ]);
      const existingRow = existing.rows[0];
      if (existingRow !== undefined) {
        return Object.freeze({
          kind: 'DEDUPLICATED',
          updateId: existingRow.update_id,
          idempotencyKey: candidate.idempotencyKey,
          fingerprintHash: candidate.fingerprintHash,
          outboxRef: existingRow.outbox_ref,
        });
      }

      // Cooldown is keyed by the PRIOR alert's fingerprint: two updates to the
      // same prior inside one cooldown window collapse to one.
      const ledger = await readAlertFingerprint(tx, candidate.ledgerFingerprint);
      if (ledger !== null && Date.parse(now) < Date.parse(ledger.cooldownUntil)) {
        return Object.freeze({
          kind: 'SUPPRESSED',
          idempotencyKey: candidate.idempotencyKey,
          fingerprintHash: candidate.fingerprintHash,
          reason: AlertSuppressionReason.WITHIN_COOLDOWN,
          latencyOutcome: null,
        });
      }

      const inserted = await tx.query<{ update_id: string }>(INSERT_UPDATE, [
        updateId,
        candidate.prior.alertRef,
        candidate.updateKind,
        candidate.fingerprintHash,
        candidate.idempotencyKey,
        alertId,
        now,
      ]);
      const insertedRow = inserted.rows[0];
      if (insertedRow === undefined) {
        // A concurrent writer won the idempotency race; its row is the one
        // notification. Re-read so the caller sees the durable id.
        const raced = await tx.query<ExistingUpdateRow>(SELECT_UPDATE_BY_KEY, [
          candidate.idempotencyKey,
        ]);
        const racedRow = raced.rows[0];
        if (racedRow === undefined) {
          throw new ForesiftError(
            ErrorCode.CONTRACT_INVARIANT_VIOLATED,
            'alert update idempotency collision without a durable row',
            { idempotencyKey: candidate.idempotencyKey },
          );
        }
        return Object.freeze({
          kind: 'DEDUPLICATED',
          updateId: racedRow.update_id,
          idempotencyKey: candidate.idempotencyKey,
          fingerprintHash: candidate.fingerprintHash,
          outboxRef: racedRow.outbox_ref,
        });
      }

      const committed = await commitAlert(tx, engineCommitInput);
      if (committed.kind !== 'COMMITTED') {
        // Roll the update row back; a suppressed update must leave no trace.
        throw new AlertUpdateSuppressedSignal(committed.reason, committed.latencyOutcome);
      }

      const linked = await tx.query<RawUpdateRow>(SET_UPDATE_OUTBOX, [updateId, outboxId]);
      const linkedRow = linked.rows[0];
      if (linkedRow === undefined) {
        throw new ForesiftError(
          ErrorCode.CONTRACT_INVARIANT_VIOLATED,
          'committed alert update row disappeared before its outbox link was recorded',
          { updateId },
        );
      }
      parseAlertSchema('AlertUpdateRow', {
        updateId: linkedRow.update_id,
        priorAlertRef: linkedRow.prior_alert_ref,
        updateKind: linkedRow.update_kind,
        fingerprint: linkedRow.fingerprint,
        idempotencyKey: linkedRow.idempotency_key,
        alertRef: linkedRow.alert_ref,
        outboxRef: linkedRow.outbox_ref,
        createdAt: linkedRow.created_at,
      });

      await upsertAlertFingerprint(tx, {
        fingerprint: candidate.ledgerFingerprint,
        alertClass: candidate.prior.alertClass,
        lastAlertId: alertId,
        lastSeverity: candidate.reassessment.severity,
        lastThesisVersion: candidate.reassessment.thesisVersion,
        lastMaterialEvidenceFingerprint: candidate.reassessment.materialEvidenceFingerprint,
        lastDeliveredAt: now,
        cooldownUntil: cooldownUntilFrom(now, candidate.policy.cooldownSeconds),
        updatedAt: now,
      });

      return Object.freeze({
        kind: 'COMMITTED',
        updateId,
        idempotencyKey: candidate.idempotencyKey,
        fingerprintHash: candidate.fingerprintHash,
        outboxId,
        outboxRef: outboxId,
        engine: committed,
      });
    });
  } catch (error) {
    if (error instanceof AlertUpdateSuppressedSignal) {
      return Object.freeze({
        kind: 'SUPPRESSED',
        idempotencyKey: candidate.idempotencyKey,
        fingerprintHash: candidate.fingerprintHash,
        reason: error.reason,
        latencyOutcome: error.latencyOutcome,
      });
    }
    throw error;
  }
}

// --- alert record repository (prior-alert source + expiry transition) --------

export interface RecordPriorAlertInput {
  readonly alertId: string;
  readonly decisionRef: string;
  readonly runRef: string;
  readonly alertClass: AlertClass;
  /** `sha256:<hex>` identity of the alert. */
  readonly fingerprint: string;
  readonly thesisVersion: number;
  readonly lifecycleState: CandidateLifecycleState;
  readonly riskState: CandidateRiskState;
  readonly severity: number;
  readonly actionabilityState: ActionabilityState;
  readonly validUntil: string;
  readonly assetId: string;
  readonly profileId: string;
  readonly executionScenarioId: string;
  readonly validUntilGeneration: number;
  readonly materialEvidenceFingerprint: string;
  readonly evidenceRefs?: readonly string[];
  readonly executionAssumptions?: Record<string, unknown>;
  readonly createdAt?: string;
}

interface RawAlertRecordRow {
  readonly alert_id: string;
  readonly decision_ref: string;
  readonly run_ref: string;
  readonly alert_class: string;
  readonly fingerprint: string;
  readonly thesis_version: number;
  readonly lifecycle_state: string;
  readonly risk_state: string;
  readonly severity: number;
  readonly actionability_state: string;
  readonly valid_until: string;
  readonly execution_assumptions: unknown;
  readonly content_hash: string;
  readonly created_at: string;
}

const SELECT_ALERT_RECORD = `
    SELECT alert_id, decision_ref, run_ref, alert_class, fingerprint,
           thesis_version, lifecycle_state, risk_state, severity,
           actionability_state, valid_until, execution_assumptions,
           content_hash, created_at
      FROM alert.alert_records
     WHERE alert_id = $1`;

const INSERT_ALERT_RECORD = `
    INSERT INTO alert.alert_records
        (alert_id, decision_ref, run_ref, alert_class, fingerprint, thesis_version,
         lifecycle_state, risk_state, severity, actionability_state, valid_until,
         execution_assumptions, evidence_refs, content_hash, supersedes_alert_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb,
            $14, NULL, $15)`;

const UPDATE_ALERT_ACTIONABILITY = `
    UPDATE alert.alert_records
       SET actionability_state = $2
     WHERE alert_id = $1
    RETURNING alert_id, actionability_state`;

function priorMetadataFromRecord(row: RawAlertRecordRow): Record<string, unknown> {
  const assumptions = row.execution_assumptions;
  if (assumptions === null || typeof assumptions !== 'object' || Array.isArray(assumptions)) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'alert record execution_assumptions is not an object',
      { alertId: row.alert_id },
    );
  }
  const metadata = (assumptions as Record<string, unknown>)[ALERT_PRIOR_METADATA_KEY];
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'alert record is missing its §26.4 prior metadata',
      { alertId: row.alert_id },
    );
  }
  return metadata as Record<string, unknown>;
}

function requireMetadataString(metadata: Record<string, unknown>, field: string): string {
  const value = metadata[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `alert record prior metadata ${field} is missing`,
      { field },
    );
  }
  return value;
}

function requireMetadataInteger(metadata: Record<string, unknown>, field: string): number {
  const value = metadata[field];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      `alert record prior metadata ${field} is missing`,
      { field },
    );
  }
  return value as number;
}

function priorStateFromRecord(row: RawAlertRecordRow, record: AlertRecordRow): PriorAlertState {
  const metadata = priorMetadataFromRecord(row);
  const cancellationState =
    record.actionabilityState === ActionabilityState.CANCELLED
      ? AlertCancellationState.CANCELLED
      : AlertCancellationState.NONE;
  return Object.freeze({
    alertRef: record.alertId,
    runRef: record.runRef,
    assetId: requireMetadataString(metadata, 'assetId'),
    profileId: requireMetadataString(metadata, 'profileId'),
    executionScenarioId: requireMetadataString(metadata, 'executionScenarioId'),
    validUntilGeneration: requireMetadataInteger(metadata, 'validUntilGeneration'),
    materialEvidenceFingerprint: requireMetadataString(metadata, 'materialEvidenceFingerprint'),
    alertClass: record.alertClass,
    fingerprint: record.fingerprint,
    thesisVersion: record.thesisVersion,
    severity: record.severity,
    lifecycleState: record.lifecycleState,
    riskState: record.riskState,
    actionabilityState: record.actionabilityState,
    validUntil: record.validUntil,
    cancellationState,
  });
}

function recordFromRaw(row: RawAlertRecordRow): AlertRecordRow {
  return parseAlertSchema('AlertRecordRow', {
    alertId: row.alert_id,
    decisionRef: row.decision_ref,
    runRef: row.run_ref,
    alertClass: row.alert_class,
    fingerprint: row.fingerprint,
    thesisVersion: row.thesis_version,
    lifecycleState: row.lifecycle_state,
    riskState: row.risk_state,
    severity: row.severity,
    actionabilityState: row.actionability_state,
    validUntil: row.valid_until,
    executionAssumptions:
      row.execution_assumptions === null || typeof row.execution_assumptions !== 'object'
        ? {}
        : (row.execution_assumptions as Record<string, unknown>),
    evidenceRefs: [],
    contentHash: row.content_hash,
    supersedesAlertId: null,
    createdAt: row.created_at,
  });
}

/**
 * Persist the §26.4 state of an alert so a later lifecycle pass can reassess it.
 * The five fingerprint preimage fields that have no dedicated column live under
 * the namespaced `execution_assumptions` metadata bag.
 */
export async function recordPriorAlert(
  engine: DatabaseEngine,
  input: RecordPriorAlertInput,
): Promise<PriorAlertState> {
  parseAlertClass(input.alertClass);
  const metadata = {
    assetId: input.assetId,
    profileId: input.profileId,
    executionScenarioId: input.executionScenarioId,
    validUntilGeneration: input.validUntilGeneration,
    materialEvidenceFingerprint: input.materialEvidenceFingerprint,
    cancellationState:
      input.actionabilityState === ActionabilityState.CANCELLED
        ? AlertCancellationState.CANCELLED
        : AlertCancellationState.NONE,
  };
  const executionAssumptions = {
    ...(input.executionAssumptions ?? {}),
    [ALERT_PRIOR_METADATA_KEY]: metadata,
  };
  const evidenceRefs = [...(input.evidenceRefs ?? [])];
  const contentHash = sha256Text(
    canonicalJson({
      alertId: input.alertId,
      fingerprint: input.fingerprint,
      thesisVersion: input.thesisVersion,
      severity: input.severity,
      actionabilityState: input.actionabilityState,
      validUntil: input.validUntil,
      metadata,
      evidenceRefs,
    }),
  );
  const createdAt = input.createdAt ?? new Date().toISOString();
  const candidate: AlertRecordRow = parseAlertSchema('AlertRecordRow', {
    alertId: input.alertId,
    decisionRef: input.decisionRef,
    runRef: input.runRef,
    alertClass: input.alertClass,
    fingerprint: input.fingerprint,
    thesisVersion: input.thesisVersion,
    lifecycleState: input.lifecycleState,
    riskState: input.riskState,
    severity: input.severity,
    actionabilityState: input.actionabilityState,
    validUntil: input.validUntil,
    executionAssumptions,
    evidenceRefs,
    contentHash,
    supersedesAlertId: null,
    createdAt,
  });
  await engine.query(INSERT_ALERT_RECORD, [
    candidate.alertId,
    candidate.decisionRef,
    candidate.runRef,
    candidate.alertClass,
    candidate.fingerprint,
    candidate.thesisVersion,
    candidate.lifecycleState,
    candidate.riskState,
    candidate.severity,
    candidate.actionabilityState,
    candidate.validUntil,
    JSON.stringify(candidate.executionAssumptions),
    JSON.stringify(candidate.evidenceRefs),
    candidate.contentHash,
    candidate.createdAt,
  ]);
  return priorStateFromRecord(
    {
      alert_id: candidate.alertId,
      decision_ref: candidate.decisionRef,
      run_ref: candidate.runRef,
      alert_class: candidate.alertClass,
      fingerprint: candidate.fingerprint,
      thesis_version: candidate.thesisVersion,
      lifecycle_state: candidate.lifecycleState,
      risk_state: candidate.riskState,
      severity: candidate.severity,
      actionability_state: candidate.actionabilityState,
      valid_until: candidate.validUntil,
      execution_assumptions: candidate.executionAssumptions,
      content_hash: candidate.contentHash,
      created_at: candidate.createdAt,
    },
    candidate,
  );
}

/** Read the §26.4 prior state of one persisted alert, or null when absent. */
export async function readPriorAlertState(
  engine: DatabaseEngine,
  alertId: string,
): Promise<PriorAlertState | null> {
  const result = await engine.query<RawAlertRecordRow>(SELECT_ALERT_RECORD, [alertId]);
  const row = result.rows[0];
  if (row === undefined) return null;
  return priorStateFromRecord(row, recordFromRaw(row));
}

/**
 * Record a clock/event-driven actionability transition (e.g. an alert whose
 * §33.9 budget elapsed becomes `EXPIRED`). Never a delivery path.
 */
export async function transitionAlertActionability(
  engine: DatabaseEngine,
  alertId: string,
  actionabilityState: ActionabilityState,
): Promise<ActionabilityState> {
  const result = await engine.query<{ alert_id: string; actionability_state: string }>(
    UPDATE_ALERT_ACTIONABILITY,
    [alertId, actionabilityState],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ForesiftError(
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
      'unknown alert reference for the actionability transition',
      { alertId },
    );
  }
  return row.actionability_state as ActionabilityState;
}

/** Convenience: true when `event` is a valid `AlertUpdateKind` mapping target. */
export function isKnownPriorEvent(value: unknown): value is AlertPriorEvent {
  return typeof value === 'string' && (ALL_ALERT_PRIOR_EVENTS as readonly string[]).includes(value);
}
