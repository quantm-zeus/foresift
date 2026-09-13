/**
 * Alert shared-schema suite (T005, FR-ALERT-001…005, AC-140, AC-141).
 *
 * Pins the `.strict()` envelopes for the immutable policy version, the §26.4
 * alert record and fingerprint ledger, the idempotent update row, the
 * class-scoped metric observation, the classification input, and the
 * §26.7/§26.8 content envelope. Every closed vocabulary is compile-linked to
 * `@foresift/domain`; malformed hashes, unknown keys, class-less metrics, and
 * cross-class metric keys are refused.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_ALERT_CLASSES,
  ALL_ALERT_SUPPRESSION_REASONS,
  ALL_SOCIAL_CAPABILITY_STATES,
  ALL_ALERT_UPDATE_KINDS,
} from '@foresift/domain';
import * as alert from '../src/alert.ts';
import {
  ALERT_SCHEMA_REGISTRY_VERSION,
  AlertClassPolicyInsertSchema,
  AlertClassPolicyRowSchema,
  AlertClassificationInputSchema,
  AlertClassSchema,
  AlertFingerprintRowSchema,
  AlertFingerprintUpsertSchema,
  AlertMetricObservationRowSchema,
  AlertRecordInsertSchema,
  AlertRecordRowSchema,
  AlertSchemaRegistry,
  AlertSuppressionReasonSchema,
  AlertUpdateInsertSchema,
  AlertUpdateRowSchema,
  ConfirmedOpportunityGateResultSchema,
  OpportunityContentEnvelopeSchema,
  parseAlertSchema,
} from '../src/alert.ts';

const HASH = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const T0 = '2026-06-01T12:00:00.000Z';
const T1 = '2026-06-01T13:00:00.000Z';

const POLICY = {
  policyId: 'policy-1',
  alertClass: 'EARLY_WATCH',
  version: 1,
  configHash: HASH,
  config: { template: 'early-watch' },
  ttlSeconds: 900,
  cooldownSeconds: 300,
  highConvictionAllowed: false,
  confirmedDenominatorMember: false,
  thresholds: { severityDelta: 0.1 },
  supersededBy: null,
  createdAt: T0,
};

const RECORD = {
  alertId: 'alert-1',
  decisionRef: 'decision-1',
  runRef: 'run-1',
  alertClass: 'CONFIRMED_OPPORTUNITY',
  fingerprint: HASH,
  thesisVersion: 2,
  lifecycleState: 'CONFIRMED',
  riskState: 'LOW',
  severity: 0.75,
  actionabilityState: 'ACTIONABLE',
  validUntil: T1,
  executionAssumptions: { notionalUsd: '1000' },
  evidenceRefs: ['evidence-1'],
  contentHash: HASH_B,
  supersedesAlertId: null,
  createdAt: T0,
};

const METRIC = {
  metricId: 'metric-1',
  alertClass: 'CONFIRMED_OPPORTUNITY',
  metricKey: 'CONFIRMED_PRECISION',
  numerator: 3,
  denominator: 10,
  sampleSize: 10,
  windowStart: '2026-01-01T00:00:00.000Z',
  windowEnd: '2026-02-01T00:00:00.000Z',
  observedAt: T0,
};

const CONTENT = {
  alertId: 'alert-1',
  alertClass: 'CONFIRMED_OPPORTUNITY',
  assetId: 'asset-1',
  chainId: 'solana',
  canonicalContract: 'contract-1',
  profileId: 'profile-1',
  candidateStage: 'CONFIRMED',
  detectedAt: T0,
  deliveredAt: T0,
  validUntil: T1,
  actionabilityState: 'ACTIONABLE',
  cancellationState: 'NONE',
  configuredNotionalUsd: '1000',
  modeledEntryImpact: 0.01,
  modeledExitImpact: 0.02,
  evidenceTimestamp: T0,
  executionAssumptions: { actionDelaySeconds: 30 },
  whyEarly: 'early relative to the observed cohort',
  positiveEvidence: ['evidence-1'],
  riskEvidence: ['evidence-2'],
  counterThesis: 'liquidity could migrate',
  alphaEvidence: [{ evidenceRef: 'evidence-1', lifecycleStatus: 'ACTIVE' }],
  patternStage: 'EMERGING',
  patternRemainingActionability: 'PT2H',
  multiViewContradictions: [],
  vetoes: [],
  failureHazardDrivers: ['hazard-1'],
  noveltyApplicabilityLimits: ['unsupported-regime'],
  missingData: ['social'],
  providerConflicts: [],
  thesisInvalidationConditions: ['liquidity withdrawn'],
  freshness: T0,
  sources: ['source-1'],
  frozenRunRef: 'run-1',
  frozenEvidenceRef: 'evidence-pack-1',
  researchDisclaimer: 'Research only; not investment advice.',
  socialCapabilityState: 'SOCIAL_UNAVAILABLE',
  populationScopeClaim: 'solana memecoins 2026 cohort',
  decisionReadyAt: T0,
  actionDelayPolicyRef: 'delay-policy-1',
  requiredDelayPassMatrix: { p50: true, p90: true },
  baseExecutionResult: { netReturnBps: 120 },
  conservativeExecutionResult: { netReturnBps: 40 },
  maximumExecutableNotionalUsd: '750',
  capacityCaveat: 'pool depth limited',
  poolProgramAdapterVersions: { poolVersion: 'v1' },
  conservativeNetUtilityRange: { low: -0.05, high: 0.2 },
  portfolioExposureConstraintResult: { withinLimit: true },
  sourceEffectiveIndependence: 'three independent lineages',
  coverageGaps: ['holder-concentration'],
  statisticalAuthorizationScope: 'G1 evaluation scope',
  statisticalAuthorizationExpiresAt: T1,
  suppressionReasons: [],
};

describe('shared-schema vocabularies mirror the domain registries', () => {
  it('accepts every domain alert class and refuses an unknown one', () => {
    for (const alertClass of ALL_ALERT_CLASSES) {
      expect(AlertClassSchema.safeParse(alertClass).success).toBe(true);
    }
    expect(AlertClassSchema.safeParse('GUARANTEED_WIN').success).toBe(false);
    for (const reason of ALL_ALERT_SUPPRESSION_REASONS) {
      expect(AlertSuppressionReasonSchema.safeParse(reason).success).toBe(true);
    }
  });

  it('exposes a stable registry version and the full envelope registry', () => {
    expect(ALERT_SCHEMA_REGISTRY_VERSION).toBe(1);
    expect(Object.keys(AlertSchemaRegistry).sort()).toEqual([
      'AlertClassPolicyInsert',
      'AlertClassPolicyRow',
      'AlertClassificationInput',
      'AlertFingerprintRow',
      'AlertFingerprintUpsert',
      'AlertMetricObservationInsert',
      'AlertMetricObservationRow',
      'AlertRecordInsert',
      'AlertRecordRow',
      'AlertUpdateInsert',
      'AlertUpdateRow',
      'OpportunityContentEnvelope',
    ]);
    expect(parseAlertSchema('AlertRecordRow', RECORD).alertId).toBe('alert-1');
  });
});

describe('immutable rows carry an insert schema and no update schema', () => {
  it('round-trips the policy version through its insert alias', () => {
    const parsed = AlertClassPolicyRowSchema.parse(POLICY);
    expect(parsed.alertClass).toBe('EARLY_WATCH');
    expect(AlertClassPolicyInsertSchema).toBe(AlertClassPolicyRowSchema);
    expect(AlertRecordInsertSchema).toBe(AlertRecordRowSchema);
    expect(AlertUpdateInsertSchema).toBe(AlertUpdateRowSchema);
    expect(AlertFingerprintUpsertSchema).toBe(AlertFingerprintRowSchema);
  });

  it('exports no update schema anywhere in the module', () => {
    for (const name of Object.keys(alert)) {
      expect(name.toLowerCase().includes('updateschema')).toBe(false);
    }
  });

  it('refuses a malformed config hash and an unknown policy key', () => {
    expect(
      AlertClassPolicyRowSchema.safeParse({ ...POLICY, configHash: 'sha256:short' }).success,
    ).toBe(false);
    expect(
      AlertClassPolicyRowSchema.safeParse({ ...POLICY, confirmedDenominator: true }).success,
    ).toBe(false);
  });
});

describe('§26.4 alert record and fingerprint ledger', () => {
  it('round-trips the alert record and refuses a malformed fingerprint', () => {
    const parsed = AlertRecordRowSchema.parse(RECORD);
    expect(parsed.fingerprint).toBe(HASH);
    expect(parsed.evidenceRefs).toEqual(['evidence-1']);
    expect(AlertRecordRowSchema.safeParse({ ...RECORD, fingerprint: 'sha256:nope' }).success).toBe(
      false,
    );
    expect(AlertRecordRowSchema.safeParse({ ...RECORD, severity: 1.4 }).success).toBe(false);
    expect(AlertRecordRowSchema.safeParse({ ...RECORD, unknownField: 1 }).success).toBe(false);
  });

  it('round-trips the fingerprint ledger row', () => {
    const row = {
      fingerprint: HASH,
      alertClass: 'EARLY_WATCH',
      lastAlertId: 'alert-1',
      lastSeverity: 0.4,
      lastThesisVersion: 3,
      lastMaterialEvidenceHash: HASH_B,
      lastDeliveredAt: T0,
      cooldownUntil: T1,
      updatedAt: T0,
    };
    expect(AlertFingerprintRowSchema.parse(row).cooldownUntil).toBe(T1);
    expect(
      AlertFingerprintRowSchema.safeParse({ ...row, lastMaterialEvidenceHash: 'x' }).success,
    ).toBe(false);
  });

  it('round-trips an update row for every update kind and refuses an unknown kind', () => {
    for (const updateKind of ALL_ALERT_UPDATE_KINDS) {
      const row = {
        updateId: `update-${updateKind}`,
        priorAlertRef: 'alert-1',
        updateKind,
        fingerprint: HASH,
        idempotencyKey: `key-${updateKind}`,
        alertRef: 'alert-2',
        outboxRef: null,
        createdAt: T0,
      };
      expect(AlertUpdateRowSchema.parse(row).updateKind).toBe(updateKind);
    }
    expect(
      AlertUpdateRowSchema.safeParse({
        updateId: 'update-bad',
        priorAlertRef: 'alert-1',
        updateKind: 'PANIC',
        fingerprint: HASH,
        idempotencyKey: 'key-bad',
        alertRef: 'alert-2',
        outboxRef: null,
        createdAt: T0,
      }).success,
    ).toBe(false);
  });
});

describe('FR-ALERT-005 class-scoped metric observations', () => {
  it('round-trips a well-formed observation', () => {
    const parsed = AlertMetricObservationRowSchema.parse(METRIC);
    expect(parsed.metricKey).toBe('CONFIRMED_PRECISION');
  });

  it('refuses a class-less metric', () => {
    const classless = { ...METRIC } as Record<string, unknown>;
    delete classless.alertClass;
    expect(AlertMetricObservationRowSchema.safeParse(classless).success).toBe(false);
  });

  it('refuses a cross-class metric key and numerator/sample overflows', () => {
    expect(
      AlertMetricObservationRowSchema.safeParse({
        ...METRIC,
        alertClass: 'EARLY_WATCH',
        metricKey: 'CONFIRMED_PRECISION',
      }).success,
    ).toBe(false);
    expect(AlertMetricObservationRowSchema.safeParse({ ...METRIC, numerator: 11 }).success).toBe(
      false,
    );
    expect(AlertMetricObservationRowSchema.safeParse({ ...METRIC, sampleSize: 11 }).success).toBe(
      false,
    );
    expect(
      AlertMetricObservationRowSchema.safeParse({
        ...METRIC,
        windowStart: '2026-02-01T00:00:00.000Z',
        windowEnd: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('binds the early-watch and confirmed keys to disjoint classes', () => {
    expect(
      AlertMetricObservationRowSchema.safeParse({
        ...METRIC,
        alertClass: 'EARLY_WATCH',
        metricKey: 'EARLY_WATCH_PRECISION',
      }).success,
    ).toBe(true);
  });
});

describe('§26.3 gate-result and classification-input envelopes', () => {
  it('requires a refusal to name a reason and a pass not to', () => {
    expect(
      ConfirmedOpportunityGateResultSchema.safeParse({
        gate: 'DECISION_ALERT',
        passed: true,
        reason: null,
      }).success,
    ).toBe(true);
    expect(
      ConfirmedOpportunityGateResultSchema.safeParse({
        gate: 'DECISION_ALERT',
        passed: false,
        reason: null,
      }).success,
    ).toBe(false);
    expect(
      ConfirmedOpportunityGateResultSchema.safeParse({
        gate: 'DECISION_ALERT',
        passed: true,
        reason: 'GATE_REFUSED',
      }).success,
    ).toBe(false);
    expect(
      ConfirmedOpportunityGateResultSchema.safeParse({
        gate: 'NOT_A_GATE',
        passed: true,
        reason: null,
      }).success,
    ).toBe(false);
  });

  it('round-trips the classification input and refuses an unknown social state', () => {
    const input = {
      assetId: 'asset-1',
      chainId: 'solana',
      profileId: 'profile-1',
      decision: 'ALERT',
      alertClassRecommendation: 'CONFIRMED_OPPORTUNITY',
      lifecycleState: 'CONFIRMED',
      riskState: 'LOW',
      multiViewState: 'CONSENSUS_POSITIVE',
      noveltyState: 'IN_DISTRIBUTION',
      costPolicyResult: 'PASS',
      socialCapabilityState: 'SOCIAL_UNAVAILABLE',
      thesisVersion: 2,
      severity: 0.7,
      validUntil: T1,
      validUntilGeneration: 1,
      executionScenarioId: 'scenario-1',
      tradabilityAssessmentId: 'tradability-1',
      materialEvidenceFingerprint: 'evidence-fingerprint-1',
      priorAlertRef: null,
      gateResults: [{ gate: 'DECISION_ALERT', passed: true, reason: null }],
    };
    expect(AlertClassificationInputSchema.parse(input).decision).toBe('ALERT');
    expect(
      AlertClassificationInputSchema.safeParse({ ...input, socialCapabilityState: 'SOCIAL_MAYBE' })
        .success,
    ).toBe(false);
    expect(AlertClassificationInputSchema.safeParse({ ...input, extra: true }).success).toBe(false);
    for (const state of ALL_SOCIAL_CAPABILITY_STATES) {
      expect(
        AlertClassificationInputSchema.safeParse({ ...input, socialCapabilityState: state })
          .success,
      ).toBe(true);
    }
  });
});

describe('§26.7/§26.8 opportunity content envelope', () => {
  it('round-trips the full content envelope', () => {
    const parsed = OpportunityContentEnvelopeSchema.parse(CONTENT);
    expect(parsed.validUntil).toBe(T1);
    expect(parsed.actionabilityState).toBe('ACTIONABLE');
    expect(parsed.executionAssumptions).toEqual({ actionDelaySeconds: 30 });
    expect(parsed.missingData).toContain('social');
    expect(parsed.socialCapabilityState).toBe('SOCIAL_UNAVAILABLE');
    expect(parsed.frozenRunRef).toBe('run-1');
    expect(parsed.frozenEvidenceRef).toBe('evidence-pack-1');
    expect(parsed.maximumExecutableNotionalUsd).toBe('750');
    expect(parsed.conservativeNetUtilityRange).toEqual({ low: -0.05, high: 0.2 });
  });

  it('refuses unknown keys and an inverted utility range', () => {
    expect(
      OpportunityContentEnvelopeSchema.safeParse({ ...CONTENT, surprise: 'nope' }).success,
    ).toBe(false);
    expect(
      OpportunityContentEnvelopeSchema.safeParse({
        ...CONTENT,
        conservativeNetUtilityRange: { low: 0.5, high: 0.1 },
      }).success,
    ).toBe(false);
  });

  it('refuses a malformed notional decimal and a missing valid_until', () => {
    expect(
      OpportunityContentEnvelopeSchema.safeParse({ ...CONTENT, configuredNotionalUsd: '1.0e3' })
        .success,
    ).toBe(false);
    const withoutValidity = { ...CONTENT } as Record<string, unknown>;
    delete withoutValidity.validUntil;
    expect(OpportunityContentEnvelopeSchema.safeParse(withoutValidity).success).toBe(false);
  });

  it('carries the renderer suppression reasons when a headline is withheld', () => {
    const parsed = OpportunityContentEnvelopeSchema.parse({
      ...CONTENT,
      suppressionReasons: ['CRITICAL_CONTRADICTION', 'FAILED_REQUIRED_DELAY_SCENARIO'],
    });
    expect(parsed.suppressionReasons).toEqual([
      'CRITICAL_CONTRADICTION',
      'FAILED_REQUIRED_DELAY_SCENARIO',
    ]);
  });
});
