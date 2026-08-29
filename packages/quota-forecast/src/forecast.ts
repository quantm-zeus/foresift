import type { ForecastSnapshot } from '@foresift/shared-schemas';
import { PlanVerifier } from './plan-verifier.ts';

export interface CostForecastResult {
  readonly estimatedForecast: Readonly<Record<string, number>>;
  readonly actualObserved: Readonly<Record<string, number>>;
  readonly delta: Readonly<Record<string, number>>;
  readonly withinTolerance: boolean;
  readonly breachedDimensions: readonly string[];
  readonly recomputedAdmissionCaps: Readonly<Record<string, number>>;
  readonly incidentId?: string;
}
export interface CostForecastOptions {
  readonly tolerance?: number;
  readonly onToleranceBreach?: (result: Omit<CostForecastResult, 'incidentId'>) => string | void;
  readonly verifier?: PlanVerifier;
  readonly at?: Date;
}
export interface ForecastEvaluationInput {
  readonly planLimits: { readonly creditsPerMonth: number };
  readonly observedUsage: { readonly creditsUsed: number };
  readonly projectedUsage: { readonly credits: number };
  readonly tolerancePercent: number;
}
export interface ForecastEvaluationResult {
  readonly estimatedForecast: Readonly<Record<string, number>>;
  readonly actualObserved: Readonly<Record<string, number>>;
  readonly delta: Readonly<Record<string, number>>;
  readonly withinTolerance: boolean;
  readonly incidentRaised: boolean;
  readonly incidentReason?: string;
  readonly recomputedCapLimit: number;
  readonly silentOverageConsumed: false;
  readonly silentReserveConsumed: false;
}

function computeSnapshotForecast(
  snapshot: ForecastSnapshot,
  options: CostForecastOptions = {},
): CostForecastResult {
  (options.verifier ?? new PlanVerifier()).assertVerified(snapshot, options.at);
  const tolerance = options.tolerance ?? 0.1;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('FORECAST_TOLERANCE_INVALID');
  const keys = [
    ...new Set([
      ...Object.keys(snapshot.planLimitsJson),
      ...Object.keys(snapshot.observedUsageJson),
    ]),
  ].sort();
  const estimatedForecast: Record<string, number> = {};
  const actualObserved: Record<string, number> = {};
  const delta: Record<string, number> = {};
  const recomputedAdmissionCaps: Record<string, number> = {};
  const breachedDimensions: string[] = [];
  for (const key of keys) {
    const limit = snapshot.planLimitsJson[key] ?? 0;
    const actual = snapshot.observedUsageJson[key] ?? 0;
    const estimated = snapshot.estimatedForecastJson[key] ?? limit * actual;
    estimatedForecast[key] = estimated;
    actualObserved[key] = actual;
    delta[key] = actual - estimated;
    const threshold = Math.max(1, Math.abs(estimated)) * tolerance;
    if (Math.abs(delta[key]) > threshold) breachedDimensions.push(key);
    // A drift breach only tightens future admission; it never opens paid/reserve headroom.
    recomputedAdmissionCaps[key] = Math.max(0, Math.min(limit, limit - Math.max(0, delta[key])));
  }
  const base = {
    estimatedForecast,
    actualObserved,
    delta,
    withinTolerance: breachedDimensions.length === 0,
    breachedDimensions,
    recomputedAdmissionCaps,
  };
  const incidentId =
    breachedDimensions.length === 0 ? undefined : options.onToleranceBreach?.(base);
  return incidentId === undefined ? base : { ...base, incidentId };
}

function computeEvaluationForecast(input: ForecastEvaluationInput): ForecastEvaluationResult {
  const estimatedForecast = { ...input.projectedUsage };
  const actualObserved = { ...input.observedUsage };
  const delta: Record<string, number> = {};
  let withinTolerance = true;
  const observed = input.observedUsage as unknown as Readonly<Record<string, number>>;
  for (const [key, projected] of Object.entries(input.projectedUsage)) {
    const observedKey = key === 'credits' ? 'creditsUsed' : key;
    const actual = observed[observedKey] ?? observed[key] ?? 0;
    delta[key] = actual - projected;
    if (Math.abs(delta[key]) > Math.abs(projected) * (input.tolerancePercent / 100)) {
      withinTolerance = false;
    }
  }
  const creditLimit = input.planLimits.creditsPerMonth;
  const creditDelta = Math.max(0, delta.credits ?? 0);
  return {
    estimatedForecast,
    actualObserved,
    delta,
    withinTolerance,
    incidentRaised: !withinTolerance,
    ...(!withinTolerance
      ? { incidentReason: 'FORECAST_TOLERANCE_EXCEEDED: observed usage exceeded projection' }
      : {}),
    recomputedCapLimit: Math.max(0, creditLimit - creditDelta),
    silentOverageConsumed: false,
    silentReserveConsumed: false,
  };
}

export function computeCostForecast(input: ForecastEvaluationInput): ForecastEvaluationResult;
export function computeCostForecast(
  input: ForecastSnapshot,
  options?: CostForecastOptions,
): CostForecastResult;
export function computeCostForecast(
  input: ForecastSnapshot | ForecastEvaluationInput,
  options: CostForecastOptions = {},
): CostForecastResult | ForecastEvaluationResult {
  return 'planLimits' in input
    ? computeEvaluationForecast(input)
    : computeSnapshotForecast(input, options);
}

export class CostForecast {
  compute(snapshot: ForecastSnapshot, options: CostForecastOptions = {}): CostForecastResult {
    return computeCostForecast(snapshot, options);
  }
}
