/**
 * Per-class metrics and denominator suite (T026, FR-ALERT-005, AC-140;
 * PRD §26.2).
 *
 * Proven here:
 * - every class emits its own numerator/denominator with an explicit sample
 *   size, and the declared per-class metric keys are class-scoped;
 * - EARLY_WATCH never contributes to the confirmed-opportunity
 *   precision/recall denominator, even under a mixed-class population;
 * - a pooled metric, a class-less request, or a class-less/cross-class
 *   observation is REFUSED with `ALERT_METRIC_CLASS_MISMATCH`.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_ALERT_CLASSES,
  AlertClass,
  AlertMetricKey,
  ErrorCode,
  metricKeysForClass,
  type AlertMetricKey as AlertMetricKeyType,
} from '@foresift/domain';
import {
  DECLARED_ALERT_METRIC_KEYS,
  aggregateMetricObservations,
  assertNoEarlyWatchInConfirmedDenominator,
  computeAlertMetric,
  computeConfirmedOpportunityMetrics,
  declaredAlertMetricKeys,
  recordAlertMetricObservation,
  type AlertMetricObservationLike,
} from '../src/index.ts';
import { expectForesiftError, withTestDatabase } from './helpers.ts';

const WINDOW_START = '2026-06-01T00:00:00.000Z';
const WINDOW_END = '2026-06-02T00:00:00.000Z';

describe('T023 per-class metric observations and denominators (AC-140)', () => {
  it('declares class-scoped metric keys for all six classes', () => {
    for (const alertClass of ALL_ALERT_CLASSES) {
      const keys = declaredAlertMetricKeys(alertClass);
      expect(keys.length).toBeGreaterThan(0);
      expect(DECLARED_ALERT_METRIC_KEYS[alertClass]).toEqual(keys);
      expect(keys).toEqual(metricKeysForClass(alertClass));
    }
    expect(declaredAlertMetricKeys(AlertClass.EARLY_WATCH)).toEqual([
      AlertMetricKey.EARLY_WATCH_PRECISION,
      AlertMetricKey.EARLY_WATCH_RECALL,
    ]);
    expect(declaredAlertMetricKeys(AlertClass.CONFIRMED_OPPORTUNITY)).toEqual([
      AlertMetricKey.CONFIRMED_PRECISION,
      AlertMetricKey.CONFIRMED_RECALL,
    ]);
  });

  it('emits each class its own numerator, denominator, and sample size', async () => {
    await withTestDatabase(async (tdb) => {
      let offset = 0;
      for (const alertClass of ALL_ALERT_CLASSES) {
        for (const metricKey of declaredAlertMetricKeys(alertClass)) {
          offset += 1;
          await recordAlertMetricObservation(tdb.engine, {
            alertClass,
            metricKey,
            numerator: offset,
            denominator: offset + 10,
            sampleSize: offset,
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
            observedAt: WINDOW_END,
          });
        }
      }

      const results = [] as Awaited<ReturnType<typeof computeAlertMetric>>[];
      for (const alertClass of ALL_ALERT_CLASSES) {
        for (const metricKey of declaredAlertMetricKeys(alertClass)) {
          const result = await computeAlertMetric(tdb.engine, {
            alertClass,
            metricKey,
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
          });
          results.push(result);
          expect(result.alertClass).toBe(alertClass);
          expect(result.metricKey).toBe(metricKey);
          expect(Number.isInteger(result.numerator)).toBe(true);
          expect(Number.isInteger(result.denominator)).toBe(true);
          expect(Number.isInteger(result.sampleSize)).toBe(true);
          expect(result.numerator).toBeLessThanOrEqual(result.denominator);
          expect(result.sampleSize).toBeLessThanOrEqual(result.denominator);
          expect(result.observationCount).toBe(1);
          expect(result.rate).toBeCloseTo(result.numerator / result.denominator, 10);
        }
      }
      expect(results).toHaveLength(9);
    });
  });

  it('excludes EARLY_WATCH from the confirmed denominator under a mixed population', async () => {
    await withTestDatabase(async (tdb) => {
      await recordAlertMetricObservation(tdb.engine, {
        alertClass: AlertClass.EARLY_WATCH,
        metricKey: AlertMetricKey.EARLY_WATCH_PRECISION,
        numerator: 7,
        denominator: 10,
        sampleSize: 10,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        observedAt: WINDOW_END,
      });
      await recordAlertMetricObservation(tdb.engine, {
        alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
        metricKey: AlertMetricKey.CONFIRMED_PRECISION,
        numerator: 3,
        denominator: 4,
        sampleSize: 4,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        observedAt: WINDOW_END,
      });

      const confirmed = await computeConfirmedOpportunityMetrics(tdb.engine, {
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });
      const precision = confirmed.find(
        (result) => result.metricKey === AlertMetricKey.CONFIRMED_PRECISION,
      );
      expect(precision?.denominator).toBe(4);
      expect(precision?.numerator).toBe(3);
      expect(precision?.sampleSize).toBe(4);

      const early = await computeAlertMetric(tdb.engine, {
        alertClass: AlertClass.EARLY_WATCH,
        metricKey: AlertMetricKey.EARLY_WATCH_PRECISION,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      });
      expect(early.denominator).toBe(10);

      // The pure aggregator refuses a pooled mixed-class population outright.
      const mixed: AlertMetricObservationLike[] = [
        {
          alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
          metricKey: AlertMetricKey.CONFIRMED_PRECISION,
          numerator: 3,
          denominator: 4,
          sampleSize: 4,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
        },
        {
          alertClass: AlertClass.EARLY_WATCH,
          metricKey: AlertMetricKey.EARLY_WATCH_PRECISION,
          numerator: 7,
          denominator: 10,
          sampleSize: 10,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
        },
      ];
      expect(() => aggregateMetricObservations(mixed)).toThrow();
      expect(() =>
        assertNoEarlyWatchInConfirmedDenominator([
          mixed[0] as AlertMetricObservationLike,
          mixed[1] as AlertMetricObservationLike,
        ]),
      ).toThrow();
    });
  });

  it('refuses a pooled metric, a class-less request, and a cross-class observation', async () => {
    await withTestDatabase(async (tdb) => {
      await expectForesiftError(
        computeAlertMetric(tdb.engine, {
          alertClass: null,
          metricKey: AlertMetricKey.CONFIRMED_PRECISION,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
        }),
        ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
      );

      await expectForesiftError(
        computeAlertMetric(tdb.engine, {
          alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
          metricKey: AlertMetricKey.CONFIRMED_PRECISION,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          scope: 'POOLED',
        }),
        ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
      );

      await expectForesiftError(
        computeAlertMetric(tdb.engine, {
          alertClass: AlertClass.CONFIRMED_OPPORTUNITY,
          metricKey: AlertMetricKey.CONFIRMED_PRECISION,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          populationClasses: [AlertClass.EARLY_WATCH, AlertClass.CONFIRMED_OPPORTUNITY],
        }),
        ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
      );

      await expectForesiftError(
        recordAlertMetricObservation(tdb.engine, {
          alertClass: AlertClass.EARLY_WATCH,
          metricKey: AlertMetricKey.CONFIRMED_PRECISION,
          numerator: 1,
          denominator: 2,
          sampleSize: 2,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          observedAt: WINDOW_END,
        }),
        ErrorCode.ALERT_METRIC_CLASS_MISMATCH,
      );

      // A numerator above its denominator is refused at the schema boundary.
      await expect(
        recordAlertMetricObservation(tdb.engine, {
          alertClass: AlertClass.RISK_ALERT,
          metricKey: AlertMetricKey.RISK_PRECISION,
          numerator: 5,
          denominator: 2,
          sampleSize: 2,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          observedAt: WINDOW_END,
        }),
      ).rejects.toThrow();
    });
  });

  it('aggregates same-class rows and keeps explicit totals', () => {
    const observations: AlertMetricObservationLike[] = [
      {
        alertClass: AlertClass.RISK_ALERT,
        metricKey: AlertMetricKey.RISK_RECALL,
        numerator: 1,
        denominator: 3,
        sampleSize: 3,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      },
      {
        alertClass: AlertClass.RISK_ALERT,
        metricKey: AlertMetricKey.RISK_RECALL,
        numerator: 2,
        denominator: 5,
        sampleSize: 5,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      },
    ];
    const result = aggregateMetricObservations(observations);
    expect(result.alertClass).toBe(AlertClass.RISK_ALERT);
    expect(result.metricKey as AlertMetricKeyType).toBe(AlertMetricKey.RISK_RECALL);
    expect(result.numerator).toBe(3);
    expect(result.denominator).toBe(8);
    expect(result.sampleSize).toBe(8);
    expect(result.observationCount).toBe(2);
    expect(result.rate).toBeCloseTo(3 / 8, 10);
  });
});
