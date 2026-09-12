/**
 * Per-class alert metrics and denominators (T023, FR-ALERT-005, AC-140;
 * PRD §26.2; plan D7).
 *
 * Every metric observation is bound to exactly one §26.2 alert class and carries
 * an explicit `numerator`, `denominator`, and `sampleSize`. The class scoping is
 * the law: `EARLY_WATCH` and `CONFIRMED_OPPORTUNITY` share no metric key, so a
 * pooled cross-class denominator is impossible to express — and any request for
 * one (a null/absent class, an `ALL` class, or a multi-class population) is
 * REFUSED with `ALERT_METRIC_CLASS_MISMATCH` rather than silently aggregated.
 *
 * The confirmed-opportunity precision/recall denominator therefore never
 * includes EARLY_WATCH: `computeConfirmedOpportunityMetrics` filters on the
 * confirmed class and rejects any row that would pool an early-watch
 * observation into the confirmed denominator.
 *
 * Strictly read-only: metrics only count intelligence outcomes; nothing here can
 * trade, hold custody, sign, handle private keys, or submit a transaction.
 */
import {
  ALL_ALERT_CLASSES,
  AlertClass,
  ErrorCode,
  ForesiftError,
  assertMetricKeyAllowedForClass,
  metricKeysForClass,
  parseAlertClass,
  parseAlertMetricKey,
  utcTimestamp,
  type AlertMetricKey,
} from '@foresift/domain';
import { parseAlertSchema, type AlertMetricObservationRow } from '@foresift/shared-schemas';
import { canonicalJson, sha256Text, type DatabaseEngine } from '@foresift/persistence';

/** Explicit metric scope: class-scoped only. */
export const AlertMetricScope = {
  CLASS: 'CLASS',
  /** A cross-class pooled denominator; always refused (FR-ALERT-005). */
  POOLED: 'POOLED',
} as const;
export type AlertMetricScope = (typeof AlertMetricScope)[keyof typeof AlertMetricScope];

/** The declared per-class metric keys, total over the six classes. */
export function declaredAlertMetricKeys(alertClass: AlertClass): readonly AlertMetricKey[] {
  return metricKeysForClass(parseAlertClass(alertClass));
}

/** The declared per-class metric keys as an immutable registry. */
export const DECLARED_ALERT_METRIC_KEYS: Readonly<Record<AlertClass, readonly AlertMetricKey[]>> =
  Object.freeze(
    Object.fromEntries(
      ALL_ALERT_CLASSES.map((alertClass) => [alertClass, declaredAlertMetricKeys(alertClass)]),
    ) as Record<AlertClass, readonly AlertMetricKey[]>,
  );

// --- observation write ------------------------------------------------------

export interface AlertMetricObservationInput {
  readonly alertClass: AlertClass;
  readonly metricKey: AlertMetricKey;
  readonly numerator: number;
  readonly denominator: number;
  readonly sampleSize: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly observedAt?: string;
  readonly metricId?: string;
}

const INSERT_METRIC_OBSERVATION = `
    INSERT INTO alert.alert_metric_observations
        (metric_id, alert_class, metric_key, numerator, denominator, sample_size,
         window_start, window_end, observed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

/**
 * Persist one class-scoped metric observation. The Zod row schema is the
 * boundary: a class-less observation, a cross-class key, a numerator above its
 * denominator, or a sample size above its denominator is refused before any
 * write.
 */
export async function recordAlertMetricObservation(
  engine: DatabaseEngine,
  input: AlertMetricObservationInput,
): Promise<AlertMetricObservationRow> {
  const alertClass = parseAlertClass(input.alertClass);
  const metricKey = parseAlertMetricKey(input.metricKey);
  assertMetricKeyAllowedForClass(alertClass, metricKey);
  const windowStart = utcTimestamp(input.windowStart);
  const windowEnd = utcTimestamp(input.windowEnd);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const metricId =
    input.metricId ??
    `amet_${sha256Text(
      canonicalJson({
        alertClass,
        metricKey,
        numerator: input.numerator,
        denominator: input.denominator,
        sampleSize: input.sampleSize,
        windowStart,
        windowEnd,
      }),
    ).slice('sha256:'.length)}`;
  const candidate: AlertMetricObservationRow = parseAlertSchema('AlertMetricObservationRow', {
    metricId,
    alertClass,
    metricKey,
    numerator: input.numerator,
    denominator: input.denominator,
    sampleSize: input.sampleSize,
    windowStart,
    windowEnd,
    observedAt,
  });
  await engine.query(INSERT_METRIC_OBSERVATION, [
    candidate.metricId,
    candidate.alertClass,
    candidate.metricKey,
    candidate.numerator,
    candidate.denominator,
    candidate.sampleSize,
    candidate.windowStart,
    candidate.windowEnd,
    candidate.observedAt,
  ]);
  return candidate;
}

// --- metric requests and refusals -------------------------------------------

export interface AlertMetricRequest {
  /** The single owning class. A null/absent class is a pooled request: refused. */
  readonly alertClass: AlertClass | null;
  readonly metricKey: AlertMetricKey;
  readonly windowStart: string;
  readonly windowEnd: string;
  /** Explicit scope; `POOLED` is always refused. */
  readonly scope?: AlertMetricScope;
  /** Any additional class in the population is a pooled request: refused. */
  readonly populationClasses?: readonly AlertClass[];
}

/** One class-scoped metric result with explicit numerator/denominator/sample. */
export interface AlertMetricResult {
  readonly alertClass: AlertClass;
  readonly metricKey: AlertMetricKey;
  readonly numerator: number;
  readonly denominator: number;
  readonly sampleSize: number;
  readonly observationCount: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  /** `numerator / denominator`, or null when the denominator is empty. */
  readonly rate: number | null;
}

function refusedPooled(detail: Record<string, string | number | null>): never {
  throw new ForesiftError(
    ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
    'alert metrics are class-scoped; a pooled cross-class denominator is refused (FR-ALERT-005)',
    detail,
  );
}

/** Refuse a class-less or cross-class metric request before it can be aggregated. */
export function assertClassScopedMetricRequest(
  request: AlertMetricRequest,
): asserts request is AlertMetricRequest & { readonly alertClass: AlertClass } {
  if (request.scope === AlertMetricScope.POOLED) {
    refusedPooled({ scope: request.scope });
  }
  if (request.alertClass === null || request.alertClass === undefined) {
    refusedPooled({ alertClass: null });
  }
  const alertClass = parseAlertClass(request.alertClass);
  assertMetricKeyAllowedForClass(alertClass, request.metricKey);
  const population = request.populationClasses;
  if (population !== undefined) {
    if (population.length !== 1 || parseAlertClass(population[0]) !== alertClass) {
      refusedPooled({
        alertClass,
        populationSize: population.length,
        population: population.join(','),
      });
    }
  }
}

function resultFromTotals(
  alertClass: AlertClass,
  metricKey: AlertMetricKey,
  totals: {
    readonly numerator: number;
    readonly denominator: number;
    readonly sampleSize: number;
    readonly observationCount: number;
  },
  windowStart: string,
  windowEnd: string,
): AlertMetricResult {
  return Object.freeze({
    alertClass,
    metricKey,
    numerator: totals.numerator,
    denominator: totals.denominator,
    sampleSize: totals.sampleSize,
    observationCount: totals.observationCount,
    windowStart,
    windowEnd,
    rate: totals.denominator === 0 ? null : totals.numerator / totals.denominator,
  });
}

const AGGREGATE_METRIC = `
    SELECT coalesce(sum(numerator), 0)::int    AS numerator,
           coalesce(sum(denominator), 0)::int  AS denominator,
           coalesce(sum(sample_size), 0)::int  AS sample_size,
           count(*)::int                       AS observation_count
      FROM alert.alert_metric_observations
     WHERE alert_class = $1
       AND metric_key = $2
       AND window_start >= $3
       AND window_end <= $4`;

interface MetricTotalsRow {
  readonly numerator: number;
  readonly denominator: number;
  readonly sample_size: number;
  readonly observation_count: number;
}

/** Compute one class-scoped metric over the requested window. */
export async function computeAlertMetric(
  engine: DatabaseEngine,
  request: AlertMetricRequest,
): Promise<AlertMetricResult> {
  assertClassScopedMetricRequest(request);
  const alertClass = parseAlertClass(request.alertClass);
  const metricKey = parseAlertMetricKey(request.metricKey);
  const windowStart = utcTimestamp(request.windowStart);
  const windowEnd = utcTimestamp(request.windowEnd);
  const result = await engine.query<MetricTotalsRow>(AGGREGATE_METRIC, [
    alertClass,
    metricKey,
    windowStart,
    windowEnd,
  ]);
  const row = result.rows[0];
  return resultFromTotals(
    alertClass,
    metricKey,
    {
      numerator: Number(row?.numerator ?? 0),
      denominator: Number(row?.denominator ?? 0),
      sampleSize: Number(row?.sample_size ?? 0),
      observationCount: Number(row?.observation_count ?? 0),
    },
    windowStart,
    windowEnd,
  );
}

/**
 * The confirmed-opportunity denominator for one window. EARLY_WATCH is never a
 * member; the aggregate is filtered on the confirmed class AND every declared
 * confirmed key, so no early-watch observation can contribute.
 */
export async function computeConfirmedOpportunityMetrics(
  engine: DatabaseEngine,
  window: { readonly windowStart: string; readonly windowEnd: string },
): Promise<readonly AlertMetricResult[]> {
  const keys = declaredAlertMetricKeys(AlertClass.CONFIRMED_OPPORTUNITY);
  const results: AlertMetricResult[] = [];
  for (const metricKey of keys) {
    results.push(
      await computeAlertMetric(engine, {
        alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
        metricKey,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        scope: AlertMetricScope.CLASS,
        populationClasses: [AlertClass.CONFIRMED_OPPORTUNITY],
      }),
    );
  }
  return Object.freeze(results);
}

// --- pure aggregation -------------------------------------------------------

/** Minimal row shape the pure aggregator consumes. */
export interface AlertMetricObservationLike {
  readonly alertClass: AlertClass;
  readonly metricKey: AlertMetricKey;
  readonly numerator: number;
  readonly denominator: number;
  readonly sampleSize: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

/**
 * Pure aggregation over class-scoped observations. A mixed-class population is
 * a pooled request and is refused; the result carries the explicit numerator,
 * denominator, sample size, and window bounds.
 */
export function aggregateMetricObservations(
  observations: readonly AlertMetricObservationLike[],
): AlertMetricResult {
  if (observations.length === 0) {
    throw new ForesiftError(
      ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
      'no alert metric observations were supplied for a class-scoped aggregate',
      { observationCount: 0 },
    );
  }
  const first = observations[0] as AlertMetricObservationLike;
  const alertClass = parseAlertClass(first.alertClass);
  const metricKey = parseAlertMetricKey(first.metricKey);
  assertMetricKeyAllowedForClass(alertClass, metricKey);
  let numerator = 0;
  let denominator = 0;
  let sampleSize = 0;
  let windowStart = first.windowStart;
  let windowEnd = first.windowEnd;
  for (const observation of observations) {
    if (parseAlertClass(observation.alertClass) !== alertClass) {
      refusedPooled({
        alertClass,
        observationClass: observation.alertClass,
        observationCount: observations.length,
      });
    }
    if (parseAlertMetricKey(observation.metricKey) !== metricKey) {
      throw new ForesiftError(
        ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
        'a class-scoped aggregate cannot mix metric keys',
        { alertClass, expected: metricKey, actual: observation.metricKey },
      );
    }
    numerator += observation.numerator;
    denominator += observation.denominator;
    sampleSize += observation.sampleSize;
    if (Date.parse(observation.windowStart) < Date.parse(windowStart)) {
      windowStart = observation.windowStart;
    }
    if (Date.parse(observation.windowEnd) > Date.parse(windowEnd)) {
      windowEnd = observation.windowEnd;
    }
  }
  return resultFromTotals(
    alertClass,
    metricKey,
    { numerator, denominator, sampleSize, observationCount: observations.length },
    windowStart,
    windowEnd,
  );
}

/**
 * Guard for the FR-ALERT-005 law: the confirmed precision/recall denominator
 * must never include an EARLY_WATCH observation or an early-watch metric key.
 */
export function assertNoEarlyWatchInConfirmedDenominator(
  observations: readonly AlertMetricObservationLike[],
): void {
  for (const observation of observations) {
    if (
      parseAlertClass(observation.alertClass) === AlertClass.EARLY_WATCH ||
      parseAlertMetricKey(observation.metricKey) === 'EARLY_WATCH_PRECISION' ||
      parseAlertMetricKey(observation.metricKey) === 'EARLY_WATCH_RECALL'
    ) {
      throw new ForesiftError(
        ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
        'EARLY_WATCH is excluded from the confirmed-opportunity precision/recall denominator (FR-ALERT-005)',
        { alertClass: observation.alertClass, metricKey: observation.metricKey },
      );
    }
  }
}
