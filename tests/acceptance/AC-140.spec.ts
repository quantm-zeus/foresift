/**
 * AC-140 acceptance (positive).
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-ALERT-003, FR-ALERT-005, AC-140.
 * AC text (manifest §39.13): "`EARLY_WATCH` and `CONFIRMED_OPPORTUNITY` have
 * separate policies, content, TTL, metrics, and denominators."
 *
 * Every assertion is driven by `tests/fixtures/alerts/**`: the canonical
 * per-class requests, the full §26.3 gate pass/fail matrix, the early-watch
 * missing-data/high-conviction corpora, and the per-class metric population.
 * The suite proves the five separation facets on a real SQL engine (PGlite):
 * 1. policy — distinct TTL, cooldown, thresholds, and denominator membership;
 * 2. content — distinct templates and opposite missing-data/envelope laws;
 * 3. TTL — EARLY_WATCH expires strictly sooner than CONFIRMED_OPPORTUNITY;
 * 4. metrics — each class emits its own numerator/denominator/sample size;
 * 5. denominators — EARLY_WATCH is absent from the confirmed denominator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  ALL_CONFIRMED_OPPORTUNITY_GATES,
  AlertClass,
  AlertSuppressionReason,
} from '@foresift/domain';
import {
  AlertClassificationKind,
  DEFAULT_ALERT_POLICY_REGISTRY,
  alertPolicyFor,
  assertNoEarlyWatchInConfirmedDenominator,
  classifyAlert,
  computeAlertMetric,
  computeConfirmedOpportunityMetrics,
  declaredAlertMetricKeys,
  evaluateConfirmedOpportunityGates,
  firstRefusedGate,
  recordAlertMetricObservation,
  renderAlertContent,
} from '@foresift/alerts';
import * as fx from '../fixtures/alerts/index.ts';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const WINDOW = {
  windowStart: fx.ALERT_FIXTURE_WINDOW_START,
  windowEnd: fx.ALERT_FIXTURE_WINDOW_END,
};

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-140: EARLY_WATCH and CONFIRMED_OPPORTUNITY are separately governed', () => {
  it('resolves genuinely separate policies, TTLs, thresholds, and denominator membership', () => {
    const early = alertPolicyFor(AlertClass.EARLY_WATCH);
    const confirmed = alertPolicyFor(AlertClass.CONFIRMED_OPPORTUNITY);

    expect(early).not.toBe(confirmed);
    expect(early.alertClass).toBe(AlertClass.EARLY_WATCH);
    expect(confirmed.alertClass).toBe(AlertClass.CONFIRMED_OPPORTUNITY);

    // TTL is per class and the watch TTL is strictly shorter (D3).
    expect(early.ttlSeconds).toBe(fx.ALERT_FIXTURE_EARLY_WATCH_TTL);
    expect(confirmed.ttlSeconds).toBe(fx.ALERT_FIXTURE_CONFIRMED_TTL);
    expect(early.ttlSeconds).toBeLessThan(confirmed.ttlSeconds);

    // Cooldown and material-change thresholds are genuinely different policies.
    expect(early.cooldownSeconds).not.toBe(confirmed.cooldownSeconds);
    expect(early.thresholds).not.toEqual(confirmed.thresholds);
    expect(early.thresholds.severityDelta).toBeGreaterThan(confirmed.thresholds.severityDelta);

    // Content policy is a class property, not a config restatement.
    expect(early.content.template).toBe('EARLY_WATCH');
    expect(confirmed.content.template).toBe('OPPORTUNITY');
    expect(early.content.requiresMissingData).toBe(true);
    expect(confirmed.content.requiresMissingData).toBe(false);
    expect(early.content.requiresOpportunityEnvelope).toBe(false);
    expect(confirmed.content.requiresOpportunityEnvelope).toBe(true);
    expect(early.content.highConvictionAllowed).toBe(false);
    expect(confirmed.content.highConvictionAllowed).toBe(true);

    // FR-ALERT-005 denominator membership is exclusive to the confirmed class.
    expect(early.confirmedDenominatorMember).toBe(false);
    expect(confirmed.confirmedDenominatorMember).toBe(true);

    // The registry exposes the per-class TTL/cooldown map consistently.
    expect(DEFAULT_ALERT_POLICY_REGISTRY.ttlSecondsByClass[AlertClass.EARLY_WATCH]).toBe(
      early.ttlSeconds,
    );
    expect(DEFAULT_ALERT_POLICY_REGISTRY.ttlSecondsByClass[AlertClass.CONFIRMED_OPPORTUNITY]).toBe(
      confirmed.ttlSeconds,
    );
    expect(DEFAULT_ALERT_POLICY_REGISTRY.cooldownSecondsByClass[AlertClass.EARLY_WATCH]).toBe(
      early.cooldownSeconds,
    );
    expect(
      DEFAULT_ALERT_POLICY_REGISTRY.cooldownSecondsByClass[AlertClass.CONFIRMED_OPPORTUNITY],
    ).toBe(confirmed.cooldownSeconds);

    // The declared metric keys of the two classes are disjoint.
    const earlyKeys = new Set(declaredAlertMetricKeys(AlertClass.EARLY_WATCH));
    for (const key of declaredAlertMetricKeys(AlertClass.CONFIRMED_OPPORTUNITY)) {
      expect(earlyKeys.has(key)).toBe(false);
    }
  });

  it('classifies each of the six canonical fixture requests into its named class', () => {
    for (const [expectedClass, build] of Object.entries(fx.CANONICAL_CLASSIFICATION_REQUESTS)) {
      const outcome = classifyAlert(build());
      expect(outcome.kind).toBe(AlertClassificationKind.CLASSIFIED);
      expect(outcome.alertClass).toBe(expectedClass as AlertClass);
      expect(outcome.contentTemplate).toBe(
        alertPolicyFor(expectedClass as AlertClass).content.template,
      );
    }
  });

  it('renders each class through its own template and content laws', () => {
    const earlyOutcome = classifyAlert(fx.earlyWatchClassificationRequest());
    expect(earlyOutcome.alertClass).toBe(AlertClass.EARLY_WATCH);
    const earlyContent = renderAlertContent(fx.earlyWatchRenderInput(earlyOutcome));
    expect(earlyContent.alertClass).toBe(AlertClass.EARLY_WATCH);
    expect(earlyContent.template).toBe('EARLY_WATCH');
    expect(earlyContent.envelope.alertClass).toBe(AlertClass.EARLY_WATCH);
    // §26.2: EARLY_WATCH MUST display explicit missing data.
    expect(earlyContent.missingData.length).toBeGreaterThan(0);
    for (const missing of fx.EARLY_WATCH_MISSING_DATA) {
      expect(earlyContent.missingData).toContain(missing);
    }
    expect(earlyContent.headlineSuppressed).toBe(false);
    expect(earlyContent.headline).not.toBeNull();

    const confirmedOutcome = classifyAlert(fx.confirmedOpportunityClassificationRequest());
    expect(confirmedOutcome.alertClass).toBe(AlertClass.CONFIRMED_OPPORTUNITY);
    const confirmedContent = renderAlertContent(
      fx.confirmedOpportunityRenderInput(confirmedOutcome),
    );
    expect(confirmedContent.alertClass).toBe(AlertClass.CONFIRMED_OPPORTUNITY);
    expect(confirmedContent.template).toBe('OPPORTUNITY');
    // §26.2: every opportunity-related notification carries the full set.
    expect(confirmedContent.envelope.validUntil).toBe(fx.ALERT_FIXTURE_VALID_UNTIL);
    expect(confirmedContent.envelope.actionabilityState).toBe('ACTIONABLE');
    expect(confirmedContent.envelope.configuredNotionalUsd).toBe('1000.00');
    expect(confirmedContent.envelope.modeledEntryImpact).toBeGreaterThan(0);
    expect(confirmedContent.envelope.modeledExitImpact).toBeGreaterThan(0);
    expect(confirmedContent.envelope.cancellationState).toBe('NONE');
    expect(confirmedContent.envelope.evidenceTimestamp).toBe(fx.ALERT_FIXTURE_T0);
    expect(confirmedContent.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('walks the fixture §26.3 matrix: one gate refuses at a time, and a missing input always refuses', () => {
    // The all-pass canonical input clears exactly the fourteen gates.
    const passing = evaluateConfirmedOpportunityGates(fx.PASSING_GATE_INPUT);
    expect(passing).toHaveLength(ALL_CONFIRMED_OPPORTUNITY_GATES.length);
    expect(passing.every((gate) => gate.passed)).toBe(true);
    expect(firstRefusedGate(passing)).toBeNull();
    expect(classifyAlert(fx.confirmedOpportunityClassificationRequest()).alertClass).toBe(
      AlertClass.CONFIRMED_OPPORTUNITY,
    );

    for (const failure of fx.GATE_FAILURE_MATRIX) {
      const results = evaluateConfirmedOpportunityGates(failure.input);
      const target = results.filter((result) => result.gate === failure.gate);
      expect(target).toHaveLength(1);
      expect(target[0]?.passed).toBe(false);
      expect(target[0]?.reason).toBe(failure.reason);
      // Only the named gate may fail; every other §26.3 gate still passes.
      for (const result of results) {
        if (result.gate !== failure.gate) {
          expect(result.passed).toBe(true);
        }
      }
    }

    for (const missingCase of fx.GATE_MISSING_INPUT_MATRIX) {
      const results = evaluateConfirmedOpportunityGates(missingCase.input);
      const target = results.find((result) => result.gate === missingCase.gate);
      expect(target).toBeDefined();
      expect(target?.passed).toBe(false);
      expect(target?.reason).toBe(AlertSuppressionReason.GATE_REFUSED);
    }

    // §34.3 fail-closed: a wholly absent gate input can never classify.
    const absent = classifyAlert(
      fx.confirmedOpportunityClassificationRequest({ gateInputs: null, gateResults: [] }),
    );
    expect(absent.kind).toBe(AlertClassificationKind.SUPPRESSED);
    expect(absent.alertClass).toBeNull();
  });

  it('emits per-class numerators/denominators with sample size and keeps EARLY_WATCH out of the confirmed denominator', async () => {
    for (const observation of fx.CLASS_METRIC_POPULATION) {
      await recordAlertMetricObservation(tdb.engine, observation);
    }

    const earlyRows = fx.metricPopulationFor(AlertClass.EARLY_WATCH);
    for (const row of earlyRows) {
      const result = await computeAlertMetric(tdb.engine, {
        alertClass: AlertClass.EARLY_WATCH,
        metricKey: row.metricKey,
        ...WINDOW,
      });
      expect(result.alertClass).toBe(AlertClass.EARLY_WATCH);
      expect(result.metricKey).toBe(row.metricKey);
      expect(result.numerator).toBe(row.numerator);
      expect(result.denominator).toBe(row.denominator);
      expect(result.sampleSize).toBe(row.sampleSize);
      expect(result.sampleSize).toBeLessThanOrEqual(result.denominator);
      expect(result.rate).toBeCloseTo(row.numerator / row.denominator, 12);
    }

    const confirmedRows = fx.metricPopulationFor(AlertClass.CONFIRMED_OPPORTUNITY);
    const confirmedResults = await computeConfirmedOpportunityMetrics(tdb.engine, WINDOW);

    expect(confirmedResults.map((result) => result.metricKey)).toEqual(
      confirmedRows.map((row) => row.metricKey),
    );
    for (const result of confirmedResults) {
      const row = confirmedRows.find((candidate) => candidate.metricKey === result.metricKey);
      expect(row).toBeDefined();
      if (row === undefined) throw new Error('confirmed metric row is missing');
      expect(result.alertClass).toBe(AlertClass.CONFIRMED_OPPORTUNITY);
      expect(result.numerator).toBe(row.numerator);
      expect(result.denominator).toBe(row.denominator);
      expect(result.sampleSize).toBe(row.sampleSize);
      expect(result.observationCount).toBe(1);
    }

    // FR-ALERT-005 law: no early-watch key or row can enter the confirmed set.
    expect(confirmedResults.map((result) => result.metricKey)).not.toContain(
      'EARLY_WATCH_PRECISION',
    );
    expect(confirmedResults.map((result) => result.metricKey)).not.toContain('EARLY_WATCH_RECALL');
    const confirmedDenominatorTotal = confirmedResults.reduce(
      (total, result) => total + result.denominator,
      0,
    );
    const expectedConfirmedTotal = confirmedRows.reduce((total, row) => total + row.denominator, 0);
    expect(confirmedDenominatorTotal).toBe(expectedConfirmedTotal);
    // The pooled early-watch denominators are never included in that total:
    // the confirmed total is strictly smaller than the cross-class population.
    const earlyDenominatorTotal = earlyRows.reduce((total, row) => total + row.denominator, 0);
    expect(earlyDenominatorTotal).toBeGreaterThan(0);
    const pooledPopulationTotal = fx.POOLED_CROSS_CLASS_POPULATION.reduce(
      (total, row) => total + row.denominator,
      0,
    );
    expect(confirmedDenominatorTotal).toBeLessThan(pooledPopulationTotal);

    // The class-scoped guard accepts the confirmed population and nothing pooled.
    expect(() => assertNoEarlyWatchInConfirmedDenominator(confirmedRows)).not.toThrow();
  }, 120_000);
});
