/**
 * §33.6 cost-forecast fixtures (T030, FR-WF-004, AC-063).
 *
 * The enable gate (`assertForecastFresh`) accepts a forecast only when it
 * parses against `CostForecastPayloadSchema` AND its `computedAt` sits inside
 * the engine's freshness window. The fixtures cover every verdict the gate
 * must produce, all pinned to `WF_TEST_T0` so a suite can inject that instant
 * as `now`:
 * - `FRESH`      — computed at `now`, well inside the window;
 * - `STALE`      — computed two days before `now`, outside the 24h window;
 * - `ABSENT`     — no payload at all;
 * - `FUTURE`     — computed past the tolerated clock skew;
 * - `MALFORMED`  — missing required §33.6 integers.
 *
 * Monetary spend is an exact decimal STRING (never a float) per the schema.
 */
import type { CostForecastPayload } from '@foresift/shared-schemas';
import { FORECAST_FRESHNESS_WINDOW_MS } from '@foresift/workflow-runtime';

export { FORECAST_FRESHNESS_WINDOW_MS };

/** The instant the fixture suite treats as `now`. */
export const WF_FORECAST_NOW = '2026-06-01T12:00:00.000Z';

/** 24h inside the freshness window; used for the "comfortably fresh" case. */
export const WF_FORECAST_FRESH_AT = '2026-06-01T11:30:00.000Z';
/** Two days before `now`: outside the window. */
export const WF_FORECAST_STALE_AT = '2026-05-30T12:00:00.000Z';
/** One hour after `now`: implausible future computation (skew is 5 minutes). */
export const WF_FORECAST_FUTURE_AT = '2026-06-01T13:00:00.000Z';

/** Build a complete, schema-valid §33.6 forecast. */
export function buildCostForecast(
  computedAt: string,
  overrides: Partial<CostForecastPayload> = {},
): CostForecastPayload {
  return {
    computedAt,
    runsPerDay: 24,
    providerCallsPerDay: 480,
    modelTokensPerDay: 120_000,
    estimatedModelSpendPerDay: '1.25',
    quotaExhaustionDate: null,
    storageGrowthPerMonth: 2048,
    ...overrides,
  };
}

export const WF_FORECASTS: Readonly<Record<string, unknown>> = Object.freeze({
  FRESH: buildCostForecast(WF_FORECAST_FRESH_AT),
  STALE: buildCostForecast(WF_FORECAST_STALE_AT),
  ABSENT: null,
  FUTURE: buildCostForecast(WF_FORECAST_FUTURE_AT),
  MALFORMED: {
    computedAt: WF_FORECAST_FRESH_AT,
    runsPerDay: 24,
    providerCallsPerDay: 480,
    // modelTokensPerDay / estimatedModelSpendPerDay / storageGrowthPerMonth
    // are deliberately missing: the strict schema must refuse this payload.
  },
});

export type WfForecastFreshness = 'FRESH' | 'STALE' | 'ABSENT' | 'FUTURE' | 'MALFORMED';

export interface WfForecastFixture {
  readonly name: WfForecastFreshness;
  readonly now: string;
  readonly payload: unknown;
  /** Engine error code the enable/resume gate must throw, `null` when accepted. */
  readonly expectedError: string | null;
  readonly note: string;
}

export const ALL_WF_FORECAST_FIXTURES: readonly WfForecastFixture[] = Object.freeze([
  {
    name: 'FRESH',
    now: WF_FORECAST_NOW,
    payload: WF_FORECASTS.FRESH,
    expectedError: null,
    note: 'inside the 24h freshness window',
  },
  {
    name: 'STALE',
    now: WF_FORECAST_NOW,
    payload: WF_FORECASTS.STALE,
    expectedError: 'WF_FORECAST_STALE',
    note: 'computed more than the freshness window before now',
  },
  {
    name: 'ABSENT',
    now: WF_FORECAST_NOW,
    payload: WF_FORECASTS.ABSENT,
    expectedError: 'WF_FORECAST_MISSING',
    note: 'enable/resume without any forecast payload',
  },
  {
    name: 'FUTURE',
    now: WF_FORECAST_NOW,
    payload: WF_FORECASTS.FUTURE,
    expectedError: 'WF_FORECAST_STALE',
    note: 'computed beyond the tolerated clock skew',
  },
  {
    name: 'MALFORMED',
    now: WF_FORECAST_NOW,
    payload: WF_FORECASTS.MALFORMED,
    expectedError: 'WF_FORECAST_MISSING',
    note: 'fails the strict §33.6 schema',
  },
]);
