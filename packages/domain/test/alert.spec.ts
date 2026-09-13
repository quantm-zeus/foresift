/**
 * Alert domain vocabulary and pure-law suite (T005, FR-ALERT-001…005, PRD §26).
 *
 * Pins the §26.2 class vocabulary, the §12.3/§12.4/§12.5 lifecycle/risk/state
 * lists, the §67.2 social capability states, per-class policy totality with the
 * EARLY_WATCH short-TTL invariant, §26.4 fingerprint determinism and field
 * coverage, the material-change thresholds, actionability/expiry, the §26.3
 * gate-set membership, the FR-ALERT-002 high-conviction language guard, the
 * class-scoped metric keys, and fail-closed parsing of every unknown literal.
 */
import { describe, expect, it } from 'bun:test';
import {
  ACTIONABILITY_EXPIRING_WINDOW_SECONDS,
  ALERT_FINGERPRINT_FIELDS,
  ALL_AGENT_DECISION_KINDS,
  ALL_ALERT_CANCELLATION_STATES,
  ALL_ALERT_CLASSES,
  ALL_ALERT_METRIC_KEYS,
  ALL_ALERT_STATES,
  ALL_ALERT_UPDATE_KINDS,
  ALL_CANDIDATE_LIFECYCLE_STATES,
  ALL_CANDIDATE_RISK_STATES,
  ALL_CONFIRMED_OPPORTUNITY_GATES,
  ALL_COST_POLICY_RESULTS,
  ALL_MULTI_VIEW_STATES,
  ALL_NOVELTY_STATES,
  ALL_SOCIAL_CAPABILITY_STATES,
  ActionabilityState,
  AlertCancellationState,
  AlertClass,
  AlertLatencyBudgetOutcome,
  AlertMetricKey,
  CandidateLifecycleState,
  CandidateRiskState,
  ConfirmedOpportunityGate,
  ErrorCode,
  FingerprintOutcome,
  ForesiftError,
  SocialCapabilityState,
  actionabilityFor,
  alertPolicyFor,
  assertHighConvictionLanguageAllowed,
  assertMetricKeyAllowedForClass,
  confirmedOpportunityEligible,
  confirmedOpportunityGateSetComplete,
  containsHighConvictionLanguage,
  defaultTtlSeconds,
  earlyWatchTtlIsShort,
  fingerprintOf,
  fingerprintOutcomeFor,
  latencyBudgetOutcomeFor,
  materialChangeExceeds,
  metricKeyAllowedForClass,
  metricKeysForClass,
  parseAlertClass,
  parseAlertMetricKey,
  parseAlertSuppressionReason,
  parseSocialCapabilityState,
  socialIsUnknownCoverage,
  updateIsEligible,
} from '../src/index.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ForesiftError);
    return (error as ForesiftError).code;
  }
  throw new Error('expected a ForesiftError refusal');
}

describe('§26.2/§12.3–12.5/§67.2 closed vocabularies', () => {
  it('declares the six §26.2 alert classes in PRD order', () => {
    expect(ALL_ALERT_CLASSES).toEqual([
      'EARLY_WATCH',
      'CONFIRMED_OPPORTUNITY',
      'THESIS_STRENGTHENING',
      'THESIS_WEAKENING',
      'OPPORTUNITY_EXPIRED',
      'RISK_ALERT',
    ]);
  });

  it('declares the four update kinds and two cancellation states', () => {
    expect(ALL_ALERT_UPDATE_KINDS).toEqual([
      'MATERIAL_DETERIORATION',
      'CANCELLATION',
      'EXPIRY',
      'RISK',
    ]);
    expect(ALL_ALERT_CANCELLATION_STATES).toEqual(['NONE', 'CANCELLED']);
  });

  it('declares the eight §12.5 alert states and six §12.4 risk states', () => {
    expect(ALL_ALERT_STATES).toEqual([
      'DRAFT',
      'SUPPRESSED',
      'QUEUED',
      'SENDING',
      'SENT',
      'FAILED',
      'ACKNOWLEDGED',
      'EXPIRED',
    ]);
    expect(ALL_CANDIDATE_RISK_STATES).toEqual([
      'UNKNOWN',
      'LOW',
      'MEDIUM',
      'HIGH',
      'CRITICAL',
      'CONFLICTING',
    ]);
    expect(ALL_CANDIDATE_LIFECYCLE_STATES).toEqual([
      'DISCOVERED',
      'QUALIFIED',
      'EMERGING',
      'CONFIRMED',
      'MONITORING',
      'DECAYING',
      'REJECTED',
      'ARCHIVED',
    ]);
  });

  it('declares the §67.2 six social capability states and the §23.7 decision vocabularies', () => {
    expect(ALL_SOCIAL_CAPABILITY_STATES).toEqual([
      'SOCIAL_FULL',
      'SOCIAL_AGGREGATED',
      'SOCIAL_USER_CURATED',
      'SOCIAL_PARTIAL',
      'SOCIAL_UNAVAILABLE',
      'SOCIAL_LICENSE_BLOCKED',
    ]);
    expect(ALL_AGENT_DECISION_KINDS).toEqual([
      'ALERT',
      'WATCH',
      'IGNORE',
      'REJECT',
      'INSUFFICIENT_DATA',
    ]);
    expect(ALL_MULTI_VIEW_STATES).toEqual([
      'CONSENSUS_POSITIVE',
      'CONSENSUS_NEGATIVE',
      'MIXED_NONCRITICAL',
      'HIGH_DISAGREEMENT',
      'CRITICAL_CONTRADICTION',
      'INSUFFICIENT_INDEPENDENCE',
      'INSUFFICIENT_DATA',
    ]);
    expect(ALL_NOVELTY_STATES).toEqual([
      'IN_DISTRIBUTION',
      'WEAKLY_NOVEL',
      'HIGHLY_NOVEL',
      'UNSUPPORTED',
    ]);
    expect(ALL_COST_POLICY_RESULTS).toEqual(['PASS', 'BLOCKED', 'DEGRADED']);
  });

  it('refuses an unknown literal fail-closed with a stable code', () => {
    expect(codeOf(() => parseAlertClass('SURE_THING'))).toBe(ErrorCode.ALERT_CLASS_UNKNOWN);
    expect(codeOf(() => alertPolicyFor('NOPE' as AlertClass))).toBe(ErrorCode.ALERT_CLASS_UNKNOWN);
    expect(codeOf(() => parseAlertMetricKey('POOLED_PRECISION'))).toBe(
      ErrorCode.ALERT_METRIC_KEY_UNKNOWN,
    );
    expect(codeOf(() => parseAlertSuppressionReason('WHATEVER'))).toBe(
      ErrorCode.ALERT_SUPPRESSION_REASON_UNKNOWN,
    );
    expect(codeOf(() => parseSocialCapabilityState('SOCIAL_MAYBE'))).toBe(
      ErrorCode.ALERT_SOCIAL_CAPABILITY_UNKNOWN,
    );
  });
});

describe('per-class policy totality and the §26.2 EARLY_WATCH TTL invariant', () => {
  it('resolves a distinct, complete policy for every one of the six classes', () => {
    const seen = new Set<string>();
    for (const alertClass of ALL_ALERT_CLASSES) {
      const policy = alertPolicyFor(alertClass);
      expect(policy.alertClass).toBe(alertClass);
      expect(policy.ttlSeconds).toBeGreaterThan(0);
      expect(policy.cooldownSeconds).toBeGreaterThanOrEqual(0);
      seen.add(policy.alertClass);
    }
    expect(seen.size).toBe(6);
  });

  it('keeps EARLY_WATCH TTL strictly shorter than CONFIRMED_OPPORTUNITY', () => {
    expect(earlyWatchTtlIsShort()).toBe(true);
    expect(defaultTtlSeconds(AlertClass.EARLY_WATCH)).toBeLessThan(
      defaultTtlSeconds(AlertClass.CONFIRMED_OPPORTUNITY),
    );
  });

  it('allows high-conviction language only for CONFIRMED_OPPORTUNITY and counts only it in the denominator', () => {
    const convictionClasses = ALL_ALERT_CLASSES.filter(
      (c) => alertPolicyFor(c).highConvictionAllowed,
    );
    expect(convictionClasses).toEqual([AlertClass.CONFIRMED_OPPORTUNITY]);
    const denominatorClasses = ALL_ALERT_CLASSES.filter(
      (c) => alertPolicyFor(c).confirmedDenominatorMember,
    );
    expect(denominatorClasses).toEqual([AlertClass.CONFIRMED_OPPORTUNITY]);
  });

  it('gives the six classes genuinely separate TTL/cooldown thresholds', () => {
    const ttlCooldown = ALL_ALERT_CLASSES.map(
      (c) => `${alertPolicyFor(c).ttlSeconds}:${alertPolicyFor(c).cooldownSeconds}`,
    );
    // At least four distinct (ttl,cooldown) pairs: not a cosmetic single policy.
    expect(new Set(ttlCooldown).size).toBeGreaterThanOrEqual(4);
  });
});

describe('§26.4 fingerprint determinism and field coverage', () => {
  const base = {
    assetId: 'asset-1',
    profileId: 'profile-1',
    alertType: AlertClass.EARLY_WATCH,
    lifecycleState: CandidateLifecycleState.EMERGING,
    riskState: CandidateRiskState.LOW,
    thesisVersion: 3,
    executionScenarioId: 'scenario-1',
    validUntilGeneration: 1,
    materialEvidenceFingerprint: 'ev-1',
  } as const;

  it('covers exactly the nine §26.4 fields', () => {
    expect(ALERT_FINGERPRINT_FIELDS).toEqual([
      'assetId',
      'profileId',
      'alertType',
      'lifecycleState',
      'riskState',
      'thesisVersion',
      'executionScenarioId',
      'validUntilGeneration',
      'materialEvidenceFingerprint',
    ]);
  });

  it('is deterministic and changes when ANY field changes', () => {
    const canonical = fingerprintOf({ ...base });
    expect(fingerprintOf({ ...base })).toBe(canonical);

    const mutations: readonly (() => string)[] = [
      () => fingerprintOf({ ...base, assetId: 'asset-2' }),
      () => fingerprintOf({ ...base, profileId: 'profile-2' }),
      () => fingerprintOf({ ...base, alertType: AlertClass.RISK_ALERT }),
      () => fingerprintOf({ ...base, lifecycleState: CandidateLifecycleState.DECAYING }),
      () => fingerprintOf({ ...base, riskState: CandidateRiskState.HIGH }),
      () => fingerprintOf({ ...base, thesisVersion: 4 }),
      () => fingerprintOf({ ...base, executionScenarioId: 'scenario-2' }),
      () => fingerprintOf({ ...base, validUntilGeneration: 2 }),
      () => fingerprintOf({ ...base, materialEvidenceFingerprint: 'ev-2' }),
    ];
    for (const mutate of mutations) expect(mutate()).not.toBe(canonical);
  });

  it('does not let delimiter injection collide two distinct field sets', () => {
    // Length-prefixing makes ('a|b','c') distinct from ('a','b|c').
    const left = fingerprintOf({ ...base, assetId: 'a|b', profileId: 'c' });
    const right = fingerprintOf({ ...base, assetId: 'a', profileId: 'b|c' });
    expect(left).not.toBe(right);
  });

  it('refuses empty identifiers and non-integer versions fail-closed', () => {
    expect(codeOf(() => fingerprintOf({ ...base, assetId: '' }))).toBe(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
    );
    expect(codeOf(() => fingerprintOf({ ...base, thesisVersion: -1 }))).toBe(
      ErrorCode.ALERT_FINGERPRINT_INPUT_INVALID,
    );
  });
});

describe('§26.4 material-change thresholds', () => {
  const prior = {
    alertClass: AlertClass.EARLY_WATCH,
    severity: 0.4,
    thesisVersion: 3,
    materialEvidenceFingerprint: 'ev-1',
  } as const;

  it('refuses an immaterial repeat', () => {
    expect(
      materialChangeExceeds(prior, {
        ...prior,
        severity: 0.41,
        thesisVersion: 3,
        materialEvidenceFingerprint: 'ev-1',
      }),
    ).toBe(false);
  });

  it('allows a severity, thesis, or material-evidence change beyond threshold', () => {
    expect(materialChangeExceeds(prior, { ...prior, severity: 0.6 })).toBe(true);
    expect(materialChangeExceeds(prior, { ...prior, thesisVersion: 4 })).toBe(true);
    expect(
      materialChangeExceeds(prior, { ...prior, materialEvidenceFingerprint: 'ev-changed' }),
    ).toBe(true);
  });

  it('treats a class change as material', () => {
    expect(
      materialChangeExceeds(prior, {
        ...prior,
        alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
      }),
    ).toBe(true);
  });

  it('refuses a severity outside [0,1]', () => {
    expect(codeOf(() => materialChangeExceeds(prior, { ...prior, severity: 1.5 }))).toBe(
      ErrorCode.ALERT_MATERIAL_STATE_INVALID,
    );
  });
});

describe('actionability/expiry and update eligibility', () => {
  it('derives ACTIONABLE, EXPIRING, EXPIRED, and CANCELLED deterministically', () => {
    expect(
      actionabilityFor('2026-06-01T13:00:00Z', AlertCancellationState.NONE, '2026-06-01T12:00:00Z'),
    ).toBe(ActionabilityState.ACTIONABLE);
    expect(
      actionabilityFor('2026-06-01T12:00:00Z', AlertCancellationState.NONE, '2026-06-01T11:59:00Z'),
    ).toBe(ActionabilityState.EXPIRING);
    expect(ACTIONABILITY_EXPIRING_WINDOW_SECONDS).toBe(300);
    expect(
      actionabilityFor('2026-06-01T12:00:00Z', AlertCancellationState.NONE, '2026-06-01T12:00:00Z'),
    ).toBe(ActionabilityState.EXPIRED);
    expect(
      actionabilityFor(
        '2026-06-01T13:00:00Z',
        AlertCancellationState.CANCELLED,
        '2026-06-01T12:00:00Z',
      ),
    ).toBe(ActionabilityState.CANCELLED);
    expect(actionabilityFor('2026-06-01T13:00:00Z', null, '2026-06-01T12:00:00Z')).toBe(
      ActionabilityState.ACTIONABLE,
    );
  });

  it('allows updates only for ACTIONABLE/EXPIRING priors', () => {
    expect(updateIsEligible(ActionabilityState.ACTIONABLE)).toBe(true);
    expect(updateIsEligible(ActionabilityState.EXPIRING)).toBe(true);
    expect(updateIsEligible(ActionabilityState.EXPIRED)).toBe(false);
    expect(updateIsEligible(ActionabilityState.CANCELLED)).toBe(false);
  });
});

describe('§26.3 confirmed-opportunity gate-set membership', () => {
  it('declares exactly the fourteen PRD §26.3 gates in order', () => {
    expect(ALL_CONFIRMED_OPPORTUNITY_GATES).toEqual([
      'DECISION_ALERT',
      'NO_CRITICAL_RISK',
      'PROFILE_ELIGIBILITY',
      'MINIMUM_DATA_COVERAGE',
      'MINIMUM_INDEPENDENT_EVIDENCE_GROUPS',
      'FRESHNESS',
      'SEMANTIC_VALIDATION',
      'UNRESOLVED_CONFLICT_THRESHOLD',
      'FINGERPRINT_COOLDOWN',
      'DAILY_SCHEDULE_BUDGET',
      'EXECUTION_AWARE_TRADABILITY',
      'ALERT_NOT_EXPIRED',
      'SOLANA_SECURITY_CHECKS',
      'STRICT_FREE_COST_POLICY',
    ]);
  });

  it('requires the complete set evaluated once, and refuses a gap or a duplicate', () => {
    expect(confirmedOpportunityGateSetComplete(ALL_CONFIRMED_OPPORTUNITY_GATES)).toBe(true);
    expect(confirmedOpportunityGateSetComplete(ALL_CONFIRMED_OPPORTUNITY_GATES.slice(0, 13))).toBe(
      false,
    );
    expect(
      confirmedOpportunityGateSetComplete([
        ...ALL_CONFIRMED_OPPORTUNITY_GATES,
        ConfirmedOpportunityGate.DECISION_ALERT,
      ]),
    ).toBe(false);
  });

  it('classifies CONFIRMED_OPPORTUNITY only when every gate passes', () => {
    const allPass = ALL_CONFIRMED_OPPORTUNITY_GATES.map((gate) => ({
      gate,
      passed: true,
      reason: null,
    }));
    expect(confirmedOpportunityEligible(allPass)).toBe(true);

    const oneRefused = allPass.map((result) =>
      result.gate === ConfirmedOpportunityGate.STRICT_FREE_COST_POLICY
        ? { ...result, passed: false, reason: 'GATE_REFUSED' as const }
        : result,
    );
    expect(confirmedOpportunityEligible(oneRefused)).toBe(false);

    // An inconsistent result (pass WITH a refusal reason) is refused fail-closed.
    const inconsistent = allPass.map((result) =>
      result.gate === ConfirmedOpportunityGate.FRESHNESS
        ? { ...result, passed: true, reason: 'GATE_REFUSED' as const }
        : result,
    );
    expect(confirmedOpportunityEligible(inconsistent)).toBe(false);

    // An incomplete set can never confirm, even if every present gate passed.
    expect(confirmedOpportunityEligible(allPass.slice(0, 5))).toBe(false);
  });
});

describe('FR-ALERT-002 high-conviction/buy-language law', () => {
  it('detects high-conviction language mechanically', () => {
    expect(containsHighConvictionLanguage('This is a guaranteed 100x buy now')).toBe(true);
    expect(containsHighConvictionLanguage('emerging candidate with partial coverage')).toBe(false);
  });

  it('refuses the language for EARLY_WATCH and permits it only for confirmed', () => {
    expect(
      codeOf(() =>
        assertHighConvictionLanguageAllowed(AlertClass.EARLY_WATCH, 'guaranteed profit awaits'),
      ),
    ).toBe(ErrorCode.ALERT_HIGH_CONVICTION_LANGUAGE);
    // Clean early-watch content passes.
    expect(() =>
      assertHighConvictionLanguageAllowed(
        AlertClass.EARLY_WATCH,
        'early signal; coverage incomplete; missing holder data',
      ),
    ).not.toThrow();
    // Confirmed opportunity may use conviction language.
    expect(() =>
      assertHighConvictionLanguageAllowed(
        AlertClass.CONFIRMED_OPPORTUNITY,
        'confirmed opportunity with full gate coverage',
      ),
    ).not.toThrow();
  });
});

describe('§67.4 SOCIAL_UNAVAILABLE is unknown coverage', () => {
  it('flags only SOCIAL_UNAVAILABLE as unknown coverage', () => {
    expect(socialIsUnknownCoverage(SocialCapabilityState.SOCIAL_UNAVAILABLE)).toBe(true);
    for (const state of ALL_SOCIAL_CAPABILITY_STATES) {
      if (state === SocialCapabilityState.SOCIAL_UNAVAILABLE) continue;
      expect(socialIsUnknownCoverage(state)).toBe(false);
    }
  });
});

describe('FR-ALERT-005 class-scoped metric keys', () => {
  it('binds every metric key to exactly one class', () => {
    const owner = new Map<string, AlertClass>();
    for (const alertClass of ALL_ALERT_CLASSES) {
      for (const key of metricKeysForClass(alertClass)) {
        expect(owner.has(key)).toBe(false);
        owner.set(key, alertClass);
      }
    }
    expect([...owner.keys()].sort()).toEqual([...ALL_ALERT_METRIC_KEYS].sort());
  });

  it('keeps EARLY_WATCH out of the confirmed precision/recall denominator', () => {
    expect(
      metricKeyAllowedForClass(AlertClass.EARLY_WATCH, AlertMetricKey.CONFIRMED_PRECISION),
    ).toBe(false);
    expect(
      metricKeyAllowedForClass(
        AlertClass.CONFIRMED_OPPORTUNITY,
        AlertMetricKey.CONFIRMED_PRECISION,
      ),
    ).toBe(true);
    expect(
      codeOf(() =>
        assertMetricKeyAllowedForClass(AlertClass.EARLY_WATCH, AlertMetricKey.CONFIRMED_RECALL),
      ),
    ).toBe(ErrorCode.ALERT_METRIC_CLASS_MISMATCH);
  });
});

describe('fingerprint/cooldown verdict and §33.9 latency budget', () => {
  const next = {
    alertClass: AlertClass.EARLY_WATCH,
    severity: 0.5,
    thesisVersion: 3,
    materialEvidenceFingerprint: 'ev-1',
  } as const;
  const priorImmaterial = { ...next, severity: 0.5 } as const;

  it('prefers duplicate, then cooldown, then immaterial, and allows otherwise', () => {
    expect(
      fingerprintOutcomeFor({
        prior: priorImmaterial,
        next,
        cooldownUntil: null,
        now: '2026-06-01T12:00:00Z',
        duplicateFingerprint: true,
      }),
    ).toBe(FingerprintOutcome.SUPPRESS_DUPLICATE);

    expect(
      fingerprintOutcomeFor({
        prior: priorImmaterial,
        next,
        cooldownUntil: '2026-06-01T12:10:00Z',
        now: '2026-06-01T12:00:00Z',
        duplicateFingerprint: false,
      }),
    ).toBe(FingerprintOutcome.SUPPRESS_COOLDOWN);

    expect(
      fingerprintOutcomeFor({
        prior: priorImmaterial,
        next,
        cooldownUntil: '2026-06-01T11:00:00Z',
        now: '2026-06-01T12:00:00Z',
        duplicateFingerprint: false,
      }),
    ).toBe(FingerprintOutcome.SUPPRESS_IMMATERIAL);

    expect(
      fingerprintOutcomeFor({
        prior: priorImmaterial,
        next: { ...next, severity: 0.9 },
        cooldownUntil: '2026-06-01T11:00:00Z',
        now: '2026-06-01T12:00:00Z',
        duplicateFingerprint: false,
      }),
    ).toBe(FingerprintOutcome.ALLOW);
  });

  it('expires or suppresses an over-budget alert instead of delivering it late', () => {
    expect(
      latencyBudgetOutcomeFor({
        elapsedMs: 1_000,
        budgetMs: 30_000,
        actionability: ActionabilityState.ACTIONABLE,
      }),
    ).toBe(AlertLatencyBudgetOutcome.WITHIN_BUDGET);
    expect(
      latencyBudgetOutcomeFor({
        elapsedMs: 60_000,
        budgetMs: 30_000,
        actionability: ActionabilityState.EXPIRED,
      }),
    ).toBe(AlertLatencyBudgetOutcome.BUDGET_EXCEEDED_EXPIRED);
    expect(
      latencyBudgetOutcomeFor({
        elapsedMs: 60_000,
        budgetMs: 30_000,
        actionability: ActionabilityState.ACTIONABLE,
      }),
    ).toBe(AlertLatencyBudgetOutcome.BUDGET_EXCEEDED_SUPPRESSED);
  });
});
