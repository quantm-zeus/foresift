/**
 * Prior-alert lifecycle fixtures (T027, FR-ALERT-004, AC-141; PRD §26.2/§26.4).
 *
 * Inert prior/reassessment/notification-context data for the four update
 * events — material deterioration, cancellation, expiry, and risk — plus the
 * below-threshold and non-actionable negative variants, and a
 * `SOCIAL_UNAVAILABLE` notification context.
 *
 * The fixtures are DATA: a test seeds a real `alert.alert_records` row from a
 * `PriorAlertState`, then drives `evaluatePriorAlertUpdate`/`commitAlertUpdate`.
 */
import {
  AlertPriorEvent,
  type AlertReassessment,
  type AlertUpdateNotificationContext,
  type PriorAlertState,
} from '@foresift/alerts';
import {
  ALERT_FIXTURE_COOLDOWN_UNTIL,
  ALERT_FIXTURE_EXPIRED_AT,
  ALERT_FIXTURE_EXPIRING_AT,
  ALERT_FIXTURE_T0,
  ALERT_FIXTURE_VALID_UNTIL,
  ALERT_HASH_A,
  ALERT_HASH_B,
  ALERT_HASH_C,
  cloneFixture,
  deepFreeze,
} from './common.ts';

/** The §26.2 class each update event routes a notification to. */
export const UPDATE_CLASS_BY_EVENT: Readonly<
  Record<AlertPriorEvent, PriorAlertState['alertClass']>
> = deepFreeze({
  DETERIORATION: 'THESIS_WEAKENING',
  CANCELLATION: 'OPPORTUNITY_EXPIRED',
  EXPIRY: 'OPPORTUNITY_EXPIRED',
  RISK: 'RISK_ALERT',
});

/** A fresh prior alert in the §26.2 class the event routes to. */
export function priorAlertFixture(
  event: AlertPriorEvent,
  overrides: Partial<PriorAlertState> = {},
): PriorAlertState {
  return {
    alertRef: `aalt-prior-${event.toLowerCase()}`,
    runRef: 'run-alert-1',
    assetId: 'asset-1',
    profileId: 'profile-1',
    executionScenarioId: 'scenario-1',
    validUntilGeneration: 1,
    materialEvidenceFingerprint: ALERT_HASH_B,
    alertClass: UPDATE_CLASS_BY_EVENT[event],
    fingerprint: ALERT_HASH_A,
    thesisVersion: 1,
    severity: 0.9,
    lifecycleState: 'CONFIRMED',
    riskState: 'LOW',
    actionabilityState: 'ACTIONABLE',
    validUntil: ALERT_FIXTURE_VALID_UNTIL,
    cancellationState: 'NONE',
    ...overrides,
  };
}

/** A fresh reassessment; defaults to a material deterioration of the prior. */
export function reassessmentFixture(overrides: Partial<AlertReassessment> = {}): AlertReassessment {
  return {
    severity: 0.4,
    thesisVersion: 2,
    materialEvidenceFingerprint: ALERT_HASH_C,
    lifecycleState: 'DECAYING',
    riskState: 'LOW',
    cancellationState: 'NONE',
    validUntil: ALERT_FIXTURE_VALID_UNTIL,
    ...overrides,
  };
}

/** A fresh notification context. */
export function notificationContextFixture(
  deliveredAt: string = ALERT_FIXTURE_T0,
  overrides: Partial<AlertUpdateNotificationContext> = {},
): AlertUpdateNotificationContext {
  return {
    chainId: 'solana',
    canonicalContract: 'contract-1',
    candidateStage: 'DECAYING',
    detectedAt: ALERT_FIXTURE_T0,
    deliveredAt,
    evidenceTimestamp: ALERT_FIXTURE_T0,
    frozenRunRef: 'run-frozen-1',
    frozenEvidenceRef: 'evidence-frozen-1',
    researchDisclaimer: 'Research only; not investment advice.',
    candidateHeadline: 'Prior alert state changed materially',
    whyEarly: 'the candidate state moved against the original thesis',
    counterThesis: 'the pattern may be a false positive',
    socialCapabilityState: 'SOCIAL_FULL',
    missingData: [],
    ...overrides,
  };
}

/** Material deterioration: severity and thesis both move past threshold. */
export const MATERIAL_DETERIORATION_REASSESSMENT: AlertReassessment = deepFreeze(
  reassessmentFixture({
    severity: 0.4,
    thesisVersion: 2,
    materialEvidenceFingerprint: ALERT_HASH_C,
  }),
);

/** Below-threshold change: same class, severity delta under the threshold. */
export const IMMATERIAL_REASSESSMENT: AlertReassessment = deepFreeze(
  reassessmentFixture({
    severity: 0.89,
    thesisVersion: 1,
    materialEvidenceFingerprint: ALERT_HASH_B,
  }),
);

/** An explicit, recorded cancellation. */
export const CANCELLATION_REASSESSMENT: AlertReassessment = deepFreeze(
  reassessmentFixture({ cancellationState: 'CANCELLED', lifecycleState: 'DECAYING' }),
);

/** An explicit expiry observation in the final actionability window. */
export const EXPIRY_REASSESSMENT: AlertReassessment = deepFreeze(
  reassessmentFixture({ expiredActionability: true, materialEvidenceFingerprint: ALERT_HASH_B }),
);

/** A risk state that rose to HIGH without a class change. */
export const RISK_REASSESSMENT: AlertReassessment = deepFreeze(
  reassessmentFixture({
    riskState: 'HIGH',
    lifecycleState: 'CONFIRMED',
    severity: 0.9,
    thesisVersion: 1,
    materialEvidenceFingerprint: ALERT_HASH_B,
  }),
);

/** The canonical (prior, event, reassessment, now) tuples for the four events. */
export interface PriorEventCase {
  readonly event: AlertPriorEvent;
  readonly prior: PriorAlertState;
  readonly reassessment: AlertReassessment;
  readonly now: string;
}

export const PRIOR_EVENT_CASES: readonly PriorEventCase[] = deepFreeze([
  {
    event: AlertPriorEvent.DETERIORATION,
    prior: priorAlertFixture(AlertPriorEvent.DETERIORATION),
    reassessment: MATERIAL_DETERIORATION_REASSESSMENT,
    now: ALERT_FIXTURE_T0,
  },
  {
    event: AlertPriorEvent.CANCELLATION,
    prior: priorAlertFixture(AlertPriorEvent.CANCELLATION, { alertClass: 'CONFIRMED_OPPORTUNITY' }),
    reassessment: CANCELLATION_REASSESSMENT,
    now: ALERT_FIXTURE_T0,
  },
  {
    event: AlertPriorEvent.EXPIRY,
    prior: priorAlertFixture(AlertPriorEvent.EXPIRY, {
      alertClass: 'CONFIRMED_OPPORTUNITY',
      validUntil: ALERT_FIXTURE_VALID_UNTIL,
    }),
    reassessment: EXPIRY_REASSESSMENT,
    now: ALERT_FIXTURE_EXPIRING_AT,
  },
  {
    event: AlertPriorEvent.RISK,
    prior: priorAlertFixture(AlertPriorEvent.RISK, { alertClass: 'CONFIRMED_OPPORTUNITY' }),
    reassessment: RISK_REASSESSMENT,
    now: ALERT_FIXTURE_T0,
  },
]);

/** A prior alert past `valid_until`: no update may be emitted for it. */
export const EXPIRED_PRIOR_ALERT: PriorAlertState = deepFreeze(
  priorAlertFixture(AlertPriorEvent.DETERIORATION, { validUntil: ALERT_FIXTURE_EXPIRED_AT }),
);

/** A prior alert explicitly cancelled: no update may be emitted for it. */
export const CANCELLED_PRIOR_ALERT: PriorAlertState = deepFreeze(
  priorAlertFixture(AlertPriorEvent.DETERIORATION, {
    actionabilityState: 'CANCELLED',
    cancellationState: 'CANCELLED',
  }),
);

/** An end-of-cooldown instant used by the within-cooldown negative fixtures. */
export const COOLDOWN_UNTIL_FIXTURE = ALERT_FIXTURE_COOLDOWN_UNTIL;

/** A notification context whose social capability is unavailable (§67.4). */
export function socialUnavailableNotificationContext(
  overrides: Partial<AlertUpdateNotificationContext> = {},
): AlertUpdateNotificationContext {
  return {
    ...cloneFixture(notificationContextFixture()),
    socialCapabilityState: 'SOCIAL_UNAVAILABLE',
    ...overrides,
  };
}
