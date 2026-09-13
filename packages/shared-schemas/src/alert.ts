/**
 * Runtime schemas for the alert lifecycle (FR-ALERT-001…005, PRD §26, §12.5,
 * §23.7, §67.2).
 *
 * Every closed vocabulary is imported from `@foresift/domain` and compiled into
 * a Zod enum — the member lists are never restated here, so SQL, domain, and
 * schema can only drift by editing the domain authority. Every object is
 * `.strict()`: unknown keys are refused, never ignored.
 *
 * Immutability by construction: policy-version and alert-classification rows
 * have an INSERT schema only. No update schema is exported anywhere in this
 * module (FR-ALERT-004, ADR-0019 immutability duty).
 *
 * Numeric policy (packages/shared-schemas/src/data.ts): monetary amounts cross
 * boundaries as exact decimal digit strings (never JS numbers); timestamps as
 * ISO-8601 UTC strings ending in `Z`; content hashes as `sha256:<hex>`.
 */
import { z } from 'zod';
import {
  ALL_ACTIONABILITY_STATES,
  ALL_AGENT_DECISION_KINDS,
  ALL_ALERT_CANCELLATION_STATES,
  ALL_ALERT_CLASSES,
  ALL_ALERT_METRIC_KEYS,
  ALL_ALERT_STATES,
  ALL_ALERT_SUPPRESSION_REASONS,
  ALL_ALERT_UPDATE_KINDS,
  ALL_CANDIDATE_LIFECYCLE_STATES,
  ALL_CANDIDATE_RISK_STATES,
  ALL_CONFIRMED_OPPORTUNITY_GATES,
  ALL_COST_POLICY_RESULTS,
  ALL_MULTI_VIEW_STATES,
  ALL_NOVELTY_STATES,
  ALL_SOCIAL_CAPABILITY_STATES,
  ALL_ALERT_LATENCY_BUDGET_OUTCOMES,
  ALL_FINGERPRINT_OUTCOMES,
  metricKeyAllowedForClass,
} from '@foresift/domain';
import { DecimalStringSchema, UtcTimestampSchema } from './data.ts';

export const ALERT_SCHEMA_REGISTRY_VERSION = 1 as const;

const id = z.string().min(1);
const contentAddress = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().positive();
const unitInterval = z.number().finite().min(0).max(1);
const jsonRecord = z.record(z.unknown());
const domainEnum = <T extends string>(values: readonly [T, ...T[]] | readonly T[]) =>
  z.enum([...values] as [T, ...T[]]);

// --- closed vocabularies (mirrors of packages/domain/src/alert.ts) ----------

export const AlertClassSchema = domainEnum(ALL_ALERT_CLASSES);
export const AlertUpdateKindSchema = domainEnum(ALL_ALERT_UPDATE_KINDS);
export const AlertStateSchema = domainEnum(ALL_ALERT_STATES);
export const ActionabilityStateSchema = domainEnum(ALL_ACTIONABILITY_STATES);
export const AlertCancellationStateSchema = domainEnum(ALL_ALERT_CANCELLATION_STATES);
export const CandidateLifecycleStateSchema = domainEnum(ALL_CANDIDATE_LIFECYCLE_STATES);
export const CandidateRiskStateSchema = domainEnum(ALL_CANDIDATE_RISK_STATES);
export const SocialCapabilityStateSchema = domainEnum(ALL_SOCIAL_CAPABILITY_STATES);
export const AgentDecisionKindSchema = domainEnum(ALL_AGENT_DECISION_KINDS);
export const MultiViewStateSchema = domainEnum(ALL_MULTI_VIEW_STATES);
export const NoveltyStateSchema = domainEnum(ALL_NOVELTY_STATES);
export const CostPolicyResultSchema = domainEnum(ALL_COST_POLICY_RESULTS);
export const AlertMetricKeySchema = domainEnum(ALL_ALERT_METRIC_KEYS);
export const ConfirmedOpportunityGateSchema = domainEnum(ALL_CONFIRMED_OPPORTUNITY_GATES);
export const AlertSuppressionReasonSchema = domainEnum(ALL_ALERT_SUPPRESSION_REASONS);
export const FingerprintOutcomeSchema = domainEnum(ALL_FINGERPRINT_OUTCOMES);
export const AlertLatencyBudgetOutcomeSchema = domainEnum(ALL_ALERT_LATENCY_BUDGET_OUTCOMES);

// --- §26.3 confirmed-opportunity gate result -------------------------------

/**
 * One §26.3 gate evaluation. `passed` and `reason` must agree: a refusal always
 * names a typed suppression reason and a pass never carries one.
 */
export const ConfirmedOpportunityGateResultSchema = z
  .object({
    gate: ConfirmedOpportunityGateSchema,
    passed: z.boolean(),
    reason: AlertSuppressionReasonSchema.nullable(),
  })
  .strict()
  .refine((value) => value.passed === (value.reason === null), {
    message: 'a refused gate must name a reason and a passed gate must not',
  });

// --- §26.1/§26.2 per-class policy versions ---------------------------------

/**
 * Immutable policy-version row (`alert.alert_policies`). `configHash` is the
 * content address of the canonical `config` JSON; `supersededBy` points at the
 * replacement version and is the ONLY column a row may ever transition (from
 * NULL to a non-null value, once). No update schema exists.
 */
export const AlertClassPolicyRowSchema = z
  .object({
    policyId: id,
    alertClass: AlertClassSchema,
    version: positiveInt,
    configHash: contentAddress,
    config: jsonRecord,
    ttlSeconds: positiveInt,
    cooldownSeconds: nonNegativeInt,
    /** FR-ALERT-002: only the confirmed class may use conviction language. */
    highConvictionAllowed: z.boolean(),
    /** FR-ALERT-005: confirmed-precision/recall denominator membership. */
    confirmedDenominatorMember: z.boolean(),
    thresholds: jsonRecord,
    supersededBy: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();

/** Insert-only mirror of the policy-version row; no update schema by design. */
export const AlertClassPolicyInsertSchema = AlertClassPolicyRowSchema;

// --- §26.4 alert record -----------------------------------------------------

/**
 * Immutable alert record (`alert.alert_records`). Classification fields are
 * written once; `supersedesAlertId` links a replacement record rather than
 * rewriting history. No update schema exists.
 */
export const AlertRecordRowSchema = z
  .object({
    alertId: id,
    decisionRef: id,
    runRef: id,
    alertClass: AlertClassSchema,
    fingerprint: contentAddress,
    thesisVersion: nonNegativeInt,
    lifecycleState: CandidateLifecycleStateSchema,
    riskState: CandidateRiskStateSchema,
    severity: unitInterval,
    actionabilityState: ActionabilityStateSchema,
    validUntil: UtcTimestampSchema,
    executionAssumptions: jsonRecord,
    evidenceRefs: z.array(id),
    contentHash: contentAddress,
    supersedesAlertId: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();

/** Insert-only mirror of the alert record; no update schema by design. */
export const AlertRecordInsertSchema = AlertRecordRowSchema;

// --- §26.4 fingerprint ledger ----------------------------------------------

/**
 * Fingerprint/cooldown ledger row (`alert.alert_fingerprints`). This row is
 * mutable state (the ledger advances), so it carries an upsert mirror; the
 * guarded transition itself lives in the alert repository, not here.
 */
export const AlertFingerprintRowSchema = z
  .object({
    fingerprint: contentAddress,
    alertClass: AlertClassSchema,
    lastAlertId: id,
    lastSeverity: unitInterval,
    lastThesisVersion: nonNegativeInt,
    lastMaterialEvidenceHash: contentAddress,
    lastDeliveredAt: UtcTimestampSchema.nullable(),
    cooldownUntil: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();

/** Upsert mirror of the ledger row (same shape; guarded by the repository SQL). */
export const AlertFingerprintUpsertSchema = AlertFingerprintRowSchema;

// --- §26.2/§26.4 update notifications --------------------------------------

/**
 * Update/cancellation notification row (`alert.alert_updates`). Event rows are
 * written once and identified by `idempotencyKey` (UNIQUE in SQL); a replay
 * collapses onto the existing row. No update schema exists.
 */
export const AlertUpdateRowSchema = z
  .object({
    updateId: id,
    priorAlertRef: id,
    updateKind: AlertUpdateKindSchema,
    fingerprint: contentAddress,
    idempotencyKey: id,
    alertRef: id,
    outboxRef: id.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();

/** Insert-only mirror of the update row; no update schema by design. */
export const AlertUpdateInsertSchema = AlertUpdateRowSchema;

// --- FR-ALERT-005 per-class metric observations ----------------------------

/**
 * Class-scoped metric observation (`alert.alert_metric_observations`). The
 * class is REQUIRED and the metric key must belong to it, so a class-less or
 * cross-class denominator is refused at the boundary (FR-ALERT-005). Early-watch
 * keys and confirmed keys are disjoint.
 */
export const AlertMetricObservationRowSchema = z
  .object({
    metricId: id,
    alertClass: AlertClassSchema,
    metricKey: AlertMetricKeySchema,
    numerator: nonNegativeInt,
    denominator: nonNegativeInt,
    sampleSize: nonNegativeInt,
    windowStart: UtcTimestampSchema,
    windowEnd: UtcTimestampSchema,
    observedAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => value.numerator <= value.denominator, {
    message: 'a metric numerator can never exceed its denominator',
  })
  .refine((value) => value.sampleSize <= value.denominator, {
    message: 'a metric sample size can never exceed its denominator',
  })
  .refine((value) => metricKeyAllowedForClass(value.alertClass, value.metricKey), {
    message: 'metric keys are class-scoped; EARLY_WATCH never pools into confirmed metrics',
  })
  .refine((value) => Date.parse(value.windowEnd) > Date.parse(value.windowStart), {
    message: 'a metric window end must be after its start',
  });

/** Insert-only mirror of the metric observation; no update schema by design. */
export const AlertMetricObservationInsertSchema = AlertMetricObservationRowSchema;

// --- §26.1 alert-classification input envelope -----------------------------

/**
 * The Zod-validated input the classifier consumes. Gate inputs (multi-view
 * state, novelty, cost policy, freshness/coverage refs), the §67.2 social
 * capability state, and the prior-alert ref are all explicit: an unavailable
 * input fails closed at this boundary rather than degrading a classification.
 */
export const AlertClassificationInputSchema = z
  .object({
    assetId: id,
    chainId: id,
    profileId: id,
    decision: AgentDecisionKindSchema,
    alertClassRecommendation: AlertClassSchema.nullable(),
    lifecycleState: CandidateLifecycleStateSchema,
    riskState: CandidateRiskStateSchema,
    multiViewState: MultiViewStateSchema,
    noveltyState: NoveltyStateSchema,
    costPolicyResult: CostPolicyResultSchema,
    socialCapabilityState: SocialCapabilityStateSchema,
    thesisVersion: nonNegativeInt,
    severity: unitInterval,
    validUntil: UtcTimestampSchema,
    validUntilGeneration: nonNegativeInt,
    executionScenarioId: id.nullable(),
    tradabilityAssessmentId: id.nullable(),
    materialEvidenceFingerprint: id,
    priorAlertRef: id.nullable(),
    gateResults: z.array(ConfirmedOpportunityGateResultSchema),
  })
  .strict();

// --- §26.2/§26.7/§26.8 opportunity content envelope ------------------------

/** One alpha-evidence reference plus its §35 lifecycle status. */
export const AlertAlphaEvidenceRefSchema = z
  .object({
    evidenceRef: id,
    /** Lifecycle status of the learned artifact backing the evidence. */
    lifecycleStatus: id,
  })
  .strict();

/**
 * The §26.7 content envelope every opportunity-related notification carries,
 * extended with the §26.2 actionability fields and the §26.8 robust-actionability
 * fields. Rendered content is data-only; `suppressionReasons` records why the
 * renderer withheld a positive headline (§26.8).
 */
export const OpportunityContentEnvelopeSchema = z
  .object({
    alertId: id,
    alertClass: AlertClassSchema,
    assetId: id,
    chainId: id,
    canonicalContract: id,
    profileId: id,
    candidateStage: CandidateLifecycleStateSchema,
    detectedAt: UtcTimestampSchema,
    deliveredAt: UtcTimestampSchema,

    // §26.2: every opportunity-related notification carries these.
    validUntil: UtcTimestampSchema,
    actionabilityState: ActionabilityStateSchema,
    cancellationState: AlertCancellationStateSchema,
    configuredNotionalUsd: DecimalStringSchema,
    modeledEntryImpact: z.number().finite().min(0),
    modeledExitImpact: z.number().finite().min(0),
    evidenceTimestamp: UtcTimestampSchema,
    executionAssumptions: jsonRecord,

    // §26.7 narrative/evidence content.
    whyEarly: z.string().min(1),
    positiveEvidence: z.array(id),
    riskEvidence: z.array(id),
    counterThesis: z.string(),
    alphaEvidence: z.array(AlertAlphaEvidenceRefSchema),
    patternStage: z.string().nullable(),
    patternRemainingActionability: z.string().nullable(),
    multiViewContradictions: z.array(id),
    vetoes: z.array(id),
    failureHazardDrivers: z.array(id),
    noveltyApplicabilityLimits: z.array(id),
    missingData: z.array(id),
    providerConflicts: z.array(id),
    thesisInvalidationConditions: z.array(id),
    freshness: UtcTimestampSchema,
    sources: z.array(id),
    frozenRunRef: id,
    frozenEvidenceRef: id,
    researchDisclaimer: z.string().min(1),

    // §67.2 missing social capability rendered as explicit unknown coverage.
    socialCapabilityState: SocialCapabilityStateSchema,

    // §26.8 robust actionability and utility rendering.
    populationScopeClaim: z.string(),
    decisionReadyAt: UtcTimestampSchema,
    actionDelayPolicyRef: id,
    requiredDelayPassMatrix: jsonRecord,
    baseExecutionResult: jsonRecord,
    conservativeExecutionResult: jsonRecord,
    maximumExecutableNotionalUsd: DecimalStringSchema,
    capacityCaveat: z.string(),
    poolProgramAdapterVersions: jsonRecord,
    conservativeNetUtilityRange: z
      .object({ low: z.number().finite(), high: z.number().finite() })
      .strict()
      .refine((range) => range.high >= range.low, {
        message: 'a conservative utility range must not invert',
      }),
    portfolioExposureConstraintResult: jsonRecord,
    sourceEffectiveIndependence: z.string(),
    coverageGaps: z.array(id),
    statisticalAuthorizationScope: z.string(),
    statisticalAuthorizationExpiresAt: UtcTimestampSchema,
    suppressionReasons: z.array(AlertSuppressionReasonSchema),
  })
  .strict();

// --- registry ---------------------------------------------------------------

/**
 * Envelope registry (mirrors the `wf.ts` pattern). Names are stable and map
 * one-to-one to the telemetry catalog's data shapes.
 */
export const AlertSchemaRegistry = Object.freeze({
  AlertClassPolicyRow: AlertClassPolicyRowSchema,
  AlertClassPolicyInsert: AlertClassPolicyInsertSchema,
  AlertRecordRow: AlertRecordRowSchema,
  AlertRecordInsert: AlertRecordInsertSchema,
  AlertFingerprintRow: AlertFingerprintRowSchema,
  AlertFingerprintUpsert: AlertFingerprintUpsertSchema,
  AlertUpdateRow: AlertUpdateRowSchema,
  AlertUpdateInsert: AlertUpdateInsertSchema,
  AlertMetricObservationRow: AlertMetricObservationRowSchema,
  AlertMetricObservationInsert: AlertMetricObservationInsertSchema,
  AlertClassificationInput: AlertClassificationInputSchema,
  OpportunityContentEnvelope: OpportunityContentEnvelopeSchema,
});

export type AlertSchemaName = keyof typeof AlertSchemaRegistry;

export function parseAlertSchema<T extends AlertSchemaName>(
  name: T,
  input: unknown,
): z.infer<(typeof AlertSchemaRegistry)[T]> {
  return AlertSchemaRegistry[name].parse(input);
}

export type AlertClassPolicyRow = z.infer<typeof AlertClassPolicyRowSchema>;
export type AlertRecordRow = z.infer<typeof AlertRecordRowSchema>;
export type AlertFingerprintRow = z.infer<typeof AlertFingerprintRowSchema>;
export type AlertUpdateRow = z.infer<typeof AlertUpdateRowSchema>;
export type AlertMetricObservationRow = z.infer<typeof AlertMetricObservationRowSchema>;
export type AlertClassificationInput = z.infer<typeof AlertClassificationInputSchema>;
export type OpportunityContentEnvelope = z.infer<typeof OpportunityContentEnvelopeSchema>;
export type ConfirmedOpportunityGateResult = z.infer<typeof ConfirmedOpportunityGateResultSchema>;
export type AlertAlphaEvidenceRef = z.infer<typeof AlertAlphaEvidenceRefSchema>;
