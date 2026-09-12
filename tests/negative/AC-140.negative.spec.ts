/**
 * AC-140 negative / failure-path.
 * Traces: FR-ALERT-001, FR-ALERT-002, FR-ALERT-003, FR-ALERT-005, AC-140.
 * AC text (manifest §39.13): "`EARLY_WATCH` and `CONFIRMED_OPPORTUNITY` have
 * separate policies, content, TTL, metrics, and denominators."
 *
 * Failure paths that must stay fail-closed:
 * - an unknown alert class refuses typed (`ALERT_CLASS_UNKNOWN`) instead of
 *   resolving to a default policy;
 * - a policy row whose class/template pair is inconsistent, whose content
 *   version is unmapped, or whose TTL inverts the class order refuses rather
 *   than rendering the wrong template;
 * - only the confirmed class may claim denominator membership;
 * - a class-less, pooled, or cross-class metric request is refused
 *   (`ALERT_METRIC_CLASS_MISMATCH`) and writes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { AlertClass, ErrorCode, parseAlertClass } from '@foresift/domain';
import type { AlertClassPolicyRow } from '@foresift/shared-schemas';
import {
  aggregateMetricObservations,
  alertPolicyFor,
  assertNoEarlyWatchInConfirmedDenominator,
  buildAlertPolicyRegistry,
  classifyAlert,
  computeAlertMetric,
  loadAlertPolicies,
  recordAlertMetricObservation,
} from '@foresift/alerts';
import type { DatabaseEngine } from '@foresift/persistence';
import * as fx from '../fixtures/alerts/index.ts';
import {
  closeTestDatabase,
  expectForesiftError,
  makeTestDatabase,
  type TestDatabase,
} from '../acceptance/helpers.ts';

/** Assert a synchronous throw carries exactly `code`. */
function expectCodeSync(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    const actual = error as { code?: string; name?: string };
    if (actual.code !== code) {
      throw new Error(
        `expected ForesiftError ${code}, got ${actual.name}: ${(error as Error).message}`,
      );
    }
    return;
  }
  throw new Error(`expected a synchronous refusal with ForesiftError ${code}`);
}

const TEMPLATE_BY_CLASS: Readonly<Record<string, string>> = {
  EARLY_WATCH: 'EARLY_WATCH',
  CONFIRMED_OPPORTUNITY: 'OPPORTUNITY',
  THESIS_STRENGTHENING: 'THESIS_UPDATE',
  THESIS_WEAKENING: 'THESIS_UPDATE',
  OPPORTUNITY_EXPIRED: 'EXPIRY',
  RISK_ALERT: 'RISK',
};

/** A schema-shaped policy row; every override is explicit. */
function policyRow(overrides: Partial<AlertClassPolicyRow> = {}): AlertClassPolicyRow {
  const alertClass = (overrides.alertClass ?? AlertClass.EARLY_WATCH) as string;
  return {
    policyId: `policy-${alertClass}-${overrides.version ?? 1}`,
    alertClass,
    version: 1,
    configHash: fx.ALERT_HASH_A,
    config: { contentPolicyVersion: 1, template: TEMPLATE_BY_CLASS[alertClass] ?? 'EARLY_WATCH' },
    ttlSeconds: alertClass === AlertClass.EARLY_WATCH ? 900 : 3600,
    cooldownSeconds: 60,
    highConvictionAllowed: false,
    confirmedDenominatorMember: alertClass === AlertClass.CONFIRMED_OPPORTUNITY,
    thresholds: {},
    supersededBy: null,
    createdAt: fx.ALERT_FIXTURE_T0,
    ...overrides,
  } as AlertClassPolicyRow;
}

const INSERT_POLICY = `
    INSERT INTO alert.alert_policies
        (policy_id, alert_class, version, config_hash, config, ttl_seconds,
         cooldown_seconds, high_conviction_allowed, confirmed_denominator,
         thresholds, superseded_by, created_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb, NULL, $11)`;

function policyParams(row: AlertClassPolicyRow): readonly unknown[] {
  return [
    row.policyId,
    row.alertClass,
    row.version,
    row.configHash,
    JSON.stringify(row.config),
    row.ttlSeconds,
    row.cooldownSeconds,
    row.highConvictionAllowed,
    row.confirmedDenominatorMember,
    JSON.stringify(row.thresholds),
    row.createdAt,
  ];
}

/**
 * Run `work` against a throwaway migrated database. Used because policy rows
 * are immutable by trigger: a DELETE/TRUNCATE is itself refused, so each
 * persisted-row case needs its own empty policy table.
 */
async function withFreshEngine<T>(work: (engine: DatabaseEngine) => Promise<T>): Promise<T> {
  const fresh = await makeTestDatabase();
  try {
    return await work(fresh.engine);
  } finally {
    await closeTestDatabase(fresh);
  }
}

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
}, 120_000);

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-140 negative: unknown class, misapplied template, and pooled denominators are refused', () => {
  it('refuses an unknown alert class typed rather than defaulting a policy', () => {
    expectCodeSync(() => parseAlertClass('NOT_A_CLASS'), ErrorCode.ALERT_CLASS_UNKNOWN);
    expectCodeSync(() => alertPolicyFor('NOT_A_CLASS' as never), ErrorCode.ALERT_CLASS_UNKNOWN);
    expectCodeSync(
      () => buildAlertPolicyRegistry([policyRow({ alertClass: 'NOT_A_CLASS' as never })]),
      ErrorCode.ALERT_CLASS_UNKNOWN,
    );
    // The classification boundary refuses too: an unknown recommendation is
    // never silently interpreted as a watch.
    expect(() =>
      classifyAlert(fx.classificationRequest({ alertClassRecommendation: 'NOT_A_CLASS' as never })),
    ).toThrow();
  });

  it('refuses a policy whose class/template pair is inconsistent or whose content version is unmapped', () => {
    // EARLY_WATCH must never render through the OPPORTUNITY template.
    expectCodeSync(
      () =>
        buildAlertPolicyRegistry([
          policyRow({ config: { contentPolicyVersion: 1, template: 'OPPORTUNITY' } }),
        ]),
      ErrorCode.ALERT_POLICY_UNKNOWN,
    );
    // CONFIRMED_OPPORTUNITY must never render through the RISK template.
    expectCodeSync(
      () =>
        buildAlertPolicyRegistry([
          policyRow({
            alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
            config: { contentPolicyVersion: 1, template: 'RISK' },
          }),
        ]),
      ErrorCode.ALERT_POLICY_UNKNOWN,
    );
    // An unmapped content version is an unmapped policy, not a default.
    expectCodeSync(
      () => buildAlertPolicyRegistry([policyRow({ config: { contentPolicyVersion: 2 } })]),
      ErrorCode.ALERT_POLICY_UNKNOWN,
    );
    // FR-ALERT-002: only CONFIRMED_OPPORTUNITY may allow conviction language.
    expectCodeSync(
      () => buildAlertPolicyRegistry([policyRow({ highConvictionAllowed: true })]),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
    // FR-ALERT-005: the confirmed class must be a denominator member.
    expectCodeSync(
      () =>
        buildAlertPolicyRegistry([
          policyRow({
            alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
            confirmedDenominatorMember: false,
            highConvictionAllowed: true,
          }),
        ]),
      ErrorCode.ALERT_POLICY_UNKNOWN,
    );
    // FR-ALERT-005: no other class may join the confirmed denominator.
    expectCodeSync(
      () =>
        buildAlertPolicyRegistry([
          policyRow({
            alertClass: AlertClass.THESIS_STRENGTHENING,
            confirmedDenominatorMember: true,
          }),
        ]),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });

  it('refuses an inverted class TTL and two ambiguous active versions for one class', () => {
    // EARLY_WATCH at 900s must still be strictly shorter than the confirmed TTL.
    expectCodeSync(
      () =>
        buildAlertPolicyRegistry([
          policyRow({ ttlSeconds: 900 }),
          policyRow({
            alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
            ttlSeconds: 800,
            highConvictionAllowed: true,
          }),
        ]),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
    expectCodeSync(
      () =>
        buildAlertPolicyRegistry([
          policyRow({ version: 1 }),
          policyRow({ policyId: 'policy-early-v2', version: 2 }),
        ]),
      ErrorCode.CONTRACT_INVARIANT_VIOLATED,
    );
  });

  it('refuses a persisted policy row with a misapplied template or a non-confirmed conviction flag', async () => {
    // The SQL row passes every table CHECK but the class/template pair is
    // inconsistent: the loader must refuse instead of rendering it.
    await withFreshEngine(async (engine) => {
      await engine.query(INSERT_POLICY, [
        ...policyParams(
          policyRow({
            alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
            config: { contentPolicyVersion: 1, template: 'RISK' },
            highConvictionAllowed: true,
          }),
        ),
      ]);
      await expectForesiftError(loadAlertPolicies(engine), ErrorCode.ALERT_POLICY_UNKNOWN);
    });

    // The table permits the boolean, but FR-ALERT-002 forbids it for a watch.
    await withFreshEngine(async (engine) => {
      await engine.query(INSERT_POLICY, [
        ...policyParams(policyRow({ highConvictionAllowed: true })),
      ]);
      await expectForesiftError(loadAlertPolicies(engine), ErrorCode.CONTRACT_INVARIANT_VIOLATED);
    });

    // A persisted TTL pair that inverts the D3 order is refused.
    await withFreshEngine(async (engine) => {
      await engine.query(INSERT_POLICY, [
        ...policyParams(policyRow({ policyId: 'persist-early', ttlSeconds: 900 })),
      ]);
      await engine.query(INSERT_POLICY, [
        ...policyParams(
          policyRow({
            policyId: 'persist-confirmed',
            alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
            ttlSeconds: 800,
            highConvictionAllowed: true,
          }),
        ),
      ]);
      await expectForesiftError(loadAlertPolicies(engine), ErrorCode.CONTRACT_INVARIANT_VIOLATED);
    });
  }, 120_000);

  it('refuses class-less, pooled, and cross-class metric requests without writing a row', async () => {
    const window = {
      windowStart: fx.ALERT_FIXTURE_WINDOW_START,
      windowEnd: fx.ALERT_FIXTURE_WINDOW_END,
    };

    await expectForesiftError(
      computeAlertMetric(tdb.engine, fx.CLASS_LESS_METRIC_REQUEST),
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    );
    await expectForesiftError(
      computeAlertMetric(tdb.engine, fx.EXPLICIT_POOLED_METRIC_REQUEST),
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    );
    await expectForesiftError(
      computeAlertMetric(tdb.engine, fx.MULTI_CLASS_METRIC_REQUEST),
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    );
    // A valid class carrying a foreign class's metric key is refused.
    await expectForesiftError(
      computeAlertMetric(tdb.engine, {
        alertClass: AlertClass.EARLY_WATCH,
        metricKey: 'CONFIRMED_PRECISION',
        ...window,
      }),
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    );

    // The pure aggregator refuses a pooled population and the early-watch
    // denominator guard refuses any early-watch row outright.
    expectCodeSync(
      () => aggregateMetricObservations(fx.POOLED_CROSS_CLASS_POPULATION),
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    );
    expectCodeSync(
      () => assertNoEarlyWatchInConfirmedDenominator(fx.POOLED_CROSS_CLASS_POPULATION),
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    );

    // A cross-class observation is refused before SQL, and a dishonest
    // numerator/sample size is refused by the strict row schema.
    const before = await tdb.engine.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM alert.alert_metric_observations',
    );
    await expectForesiftError(
      recordAlertMetricObservation(tdb.engine, fx.CROSS_CLASS_METRIC_OBSERVATION),
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    );
    await expect(
      recordAlertMetricObservation(tdb.engine, {
        alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
        metricKey: 'CONFIRMED_PRECISION',
        numerator: 5,
        denominator: 1,
        sampleSize: 1,
        ...window,
      }),
    ).rejects.toThrow();
    await expect(
      recordAlertMetricObservation(tdb.engine, {
        alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
        metricKey: 'CONFIRMED_PRECISION',
        numerator: 1,
        denominator: 1,
        sampleSize: 2,
        ...window,
      }),
    ).rejects.toThrow();

    const after = await tdb.engine.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM alert.alert_metric_observations',
    );
    expect(Number(after.rows[0]?.count ?? 0)).toBe(Number(before.rows[0]?.count ?? 0));
  }, 120_000);
});
