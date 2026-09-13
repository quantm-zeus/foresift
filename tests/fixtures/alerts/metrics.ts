/**
 * Per-class metric/denominator fixtures (T027, FR-ALERT-005, AC-140; PRD §26.2).
 *
 * One observation per declared class metric key, with explicit numerator,
 * denominator, and sample size. The mixed-class population is the negative
 * fixture: it carries BOTH `EARLY_WATCH` and `CONFIRMED_OPPORTUNITY` rows so a
 * class-scoped consumer can prove it never pools them. Inert data only.
 */
import { ALERT_METRIC_KEYS_BY_CLASS, AlertClass, type AlertMetricKey } from '@foresift/domain';
import { ALERT_FIXTURE_WINDOW_END, ALERT_FIXTURE_WINDOW_START, deepFreeze } from './common.ts';

/** A metric observation in the shape the repository/schema accepts. */
export interface MetricObservationFixture {
  readonly alertClass: AlertClass;
  readonly metricKey: AlertMetricKey;
  readonly numerator: number;
  readonly denominator: number;
  readonly sampleSize: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

/** Explicit, distinct numerator/denominator/sample triples per class metric. */
const METRIC_TOTALS: Readonly<Record<string, readonly [number, number, number]>> = deepFreeze({
  EARLY_WATCH_PRECISION: [7, 10, 10],
  EARLY_WATCH_RECALL: [6, 9, 9],
  CONFIRMED_PRECISION: [8, 10, 10],
  CONFIRMED_RECALL: [5, 8, 8],
  THESIS_STRENGTHENING_RECALL: [3, 4, 4],
  THESIS_WEAKENING_RECALL: [2, 4, 4],
  EXPIRY_TIMELINESS: [5, 6, 6],
  RISK_PRECISION: [4, 5, 5],
  RISK_RECALL: [3, 5, 5],
});

/** One observation per declared class metric key — the canonical population. */
export const CLASS_METRIC_POPULATION: readonly MetricObservationFixture[] = deepFreeze(
  Object.entries(ALERT_METRIC_KEYS_BY_CLASS).flatMap(([alertClass, keys]) =>
    keys.map((metricKey) => {
      const totals = METRIC_TOTALS[metricKey];
      if (totals === undefined) {
        throw new Error(`alert metric fixture is missing totals for ${metricKey}`);
      }
      return {
        alertClass: alertClass as AlertClass,
        metricKey,
        numerator: totals[0],
        denominator: totals[1],
        sampleSize: totals[2],
        windowStart: ALERT_FIXTURE_WINDOW_START,
        windowEnd: ALERT_FIXTURE_WINDOW_END,
      } satisfies MetricObservationFixture;
    }),
  ),
);

/** The observations of exactly one class, in fixture order. */
export function metricPopulationFor(alertClass: AlertClass): readonly MetricObservationFixture[] {
  return CLASS_METRIC_POPULATION.filter((row) => row.alertClass === alertClass);
}

/**
 * A deliberately POOLED population: early-watch and confirmed rows together.
 * Any class-scoped consumer must either ignore the foreign class or refuse the
 * request; it must never sum them into one denominator.
 */
export const POOLED_CROSS_CLASS_POPULATION: readonly MetricObservationFixture[] = deepFreeze([
  ...metricPopulationFor(AlertClass.EARLY_WATCH),
  ...metricPopulationFor(AlertClass.CONFIRMED_OPPORTUNITY),
]);

/** A class-less metric request (pooled by construction): must be refused. */
export const CLASS_LESS_METRIC_REQUEST = deepFreeze({
  alertClass: null,
  metricKey: 'CONFIRMED_PRECISION' as AlertMetricKey,
  windowStart: ALERT_FIXTURE_WINDOW_START,
  windowEnd: ALERT_FIXTURE_WINDOW_END,
});

/** A request that names a multi-class population: must be refused. */
export const MULTI_CLASS_METRIC_REQUEST = deepFreeze({
  alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
  metricKey: 'CONFIRMED_PRECISION' as AlertMetricKey,
  windowStart: ALERT_FIXTURE_WINDOW_START,
  windowEnd: ALERT_FIXTURE_WINDOW_END,
  scope: 'CLASS' as const,
  populationClasses: [AlertClass.EARLY_WATCH, AlertClass.CONFIRMED_OPPORTUNITY],
});

/** A request that explicitly asks for the pooled scope: must be refused. */
export const EXPLICIT_POOLED_METRIC_REQUEST = deepFreeze({
  alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
  metricKey: 'CONFIRMED_PRECISION' as AlertMetricKey,
  windowStart: ALERT_FIXTURE_WINDOW_START,
  windowEnd: ALERT_FIXTURE_WINDOW_END,
  scope: 'POOLED' as const,
});

/** A cross-class observation: an early-watch class carrying a confirmed key. */
export const CROSS_CLASS_METRIC_OBSERVATION = deepFreeze({
  alertClass: AlertClass.EARLY_WATCH,
  metricKey: 'CONFIRMED_PRECISION' as AlertMetricKey,
  numerator: 1,
  denominator: 1,
  sampleSize: 1,
  windowStart: ALERT_FIXTURE_WINDOW_START,
  windowEnd: ALERT_FIXTURE_WINDOW_END,
});
