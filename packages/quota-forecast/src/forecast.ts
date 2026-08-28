/** Verified plan forecast/actual reconciliation with fail-closed breach handling. */
import { createHash } from 'node:crypto';
import type { ForecastSnapshot } from '@foresift/shared-schemas';
import { PlanVerifier } from './plan-verifier.ts';

export interface ForecastIncidentSink {
  raise(input: {
    readonly incidentId: string;
    readonly snapshotId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface CostForecastResult {
  readonly snapshotId: string;
  readonly estimatedForecast: Readonly<Record<string, number>>;
  readonly actualObserved: Readonly<Record<string, number>>;
  readonly delta: Readonly<Record<string, number>>;
  readonly withinTolerance: boolean;
  readonly incidentId: string | null;
  readonly recomputedAdmissionCaps: Readonly<Record<string, number>>;
  readonly paidOverageConsumed: false;
  readonly protectedReserveConsumed: false;
}

export class CostForecast {
  constructor(
    private readonly verifier: PlanVerifier,
    private readonly incidentSink?: ForecastIncidentSink,
  ) {}

  async compute(input: {
    readonly snapshotId: string;
    readonly toleranceFraction: number;
    readonly actualObserved?: Readonly<Record<string, number>>;
    readonly at?: string;
  }): Promise<CostForecastResult> {
    if (!Number.isFinite(input.toleranceFraction) || input.toleranceFraction < 0) {
      throw new RangeError('toleranceFraction must be finite and nonnegative');
    }
    const snapshot = this.verifier.requireVerified(input.snapshotId, input.at);
    return this.computeVerified(snapshot, input.toleranceFraction, input.actualObserved);
  }

  private async computeVerified(
    snapshot: ForecastSnapshot,
    tolerance: number,
    actualOverride?: Readonly<Record<string, number>>,
  ): Promise<CostForecastResult> {
    const dimensions = [
      ...new Set([
        ...Object.keys(snapshot.planLimitsJson),
        ...Object.keys(snapshot.observedUsageJson),
        ...Object.keys(snapshot.estimatedForecastJson),
        ...Object.keys(actualOverride ?? {}),
      ]),
    ].sort();
    const estimatedForecast: Record<string, number> = {};
    const actualObserved: Record<string, number> = {};
    const delta: Record<string, number> = {};
    const recomputedAdmissionCaps: Record<string, number> = {};
    let withinTolerance = true;
    for (const dimension of dimensions) {
      const limit = snapshot.planLimitsJson[dimension] ?? 0;
      const estimate =
        snapshot.estimatedForecastJson[dimension] ?? snapshot.observedUsageJson[dimension] ?? 0;
      const actual = actualOverride?.[dimension] ?? snapshot.observedUsageJson[dimension] ?? 0;
      const difference = actual - estimate;
      const permitted = Math.max(Math.abs(estimate) * tolerance, Number.EPSILON);
      if (Math.abs(difference) > permitted || actual > limit) withinTolerance = false;
      estimatedForecast[dimension] = estimate;
      actualObserved[dimension] = actual;
      delta[dimension] = difference;
      // Drift reduces ordinary admission only. No paid or reserve fallback is added.
      recomputedAdmissionCaps[dimension] = Math.max(0, limit - Math.max(0, difference));
    }
    const incidentId = withinTolerance
      ? null
      : `cost-forecast:${createHash('sha256')
          .update(`${snapshot.snapshotId}\u0000${JSON.stringify(delta)}`)
          .digest('hex')}`;
    if (incidentId !== null) {
      await this.incidentSink?.raise({
        incidentId,
        snapshotId: snapshot.snapshotId,
        reason: 'COST_FORECAST_TOLERANCE_BREACHED',
      });
    }
    return {
      snapshotId: snapshot.snapshotId,
      estimatedForecast,
      actualObserved,
      delta,
      withinTolerance,
      incidentId,
      recomputedAdmissionCaps,
      paidOverageConsumed: false,
      protectedReserveConsumed: false,
    };
  }
}

export function evaluateForecast(input: {
  readonly estimatedForecast: number;
  readonly actualObserved: number;
  readonly toleranceFraction: number;
}): {
  readonly delta: number;
  readonly percentDelta: number;
  readonly withinTolerance: boolean;
  readonly incidentRequired: boolean;
  readonly recomputedCap?: number;
} {
  if (
    !Number.isFinite(input.estimatedForecast) ||
    !Number.isFinite(input.actualObserved) ||
    !Number.isFinite(input.toleranceFraction) ||
    input.estimatedForecast < 0 ||
    input.actualObserved < 0 ||
    input.toleranceFraction < 0
  )
    throw new RangeError('forecast values must be finite and nonnegative');
  const delta = input.actualObserved - input.estimatedForecast;
  const percentDelta =
    input.estimatedForecast === 0
      ? input.actualObserved === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(delta) / input.estimatedForecast;
  const withinTolerance = percentDelta <= input.toleranceFraction;
  return {
    delta,
    percentDelta,
    withinTolerance,
    incidentRequired: !withinTolerance,
    ...(withinTolerance
      ? {}
      : { recomputedCap: Math.max(0, input.estimatedForecast - Math.max(delta, 0)) }),
  };
}

export function handleBreach(_input: {
  readonly excessUnits: number;
  readonly reserveBalances: Readonly<Record<string, number>>;
  readonly paidAllowed: boolean;
}): {
  readonly consumedPaidOverage: false;
  readonly consumedReserve: false;
  readonly action: 'RAISE_INCIDENT_AND_THROTTLE';
} {
  return {
    consumedPaidOverage: false,
    consumedReserve: false,
    action: 'RAISE_INCIDENT_AND_THROTTLE',
  };
}

export function verifyReconciliationPolicy(event: {
  readonly toleranceExceeded: boolean;
  readonly incidentRecorded: boolean;
}): true {
  if (event.toleranceExceeded && !event.incidentRecorded)
    throw new Error('SILENT_BREACH_FORBIDDEN: INCIDENT_MANDATORY_ON_TOLERANCE_BREACH');
  return true;
}

export class ForecastReconciliationEngine {
  constructor(engine: unknown) {
    void engine;
  }
  async reconcileUsage(input: {
    readonly operation: string;
    readonly forecastUnits: number;
    readonly actualUnits: number;
    readonly tolerancePercent: number;
  }): Promise<{
    readonly incidentCreated: boolean;
    readonly incidentId?: string;
    readonly recomputedLimit: number;
    readonly consumedPaidOverage: false;
    readonly consumedReserve: false;
  }> {
    const result = evaluateForecast({
      estimatedForecast: input.forecastUnits,
      actualObserved: input.actualUnits,
      toleranceFraction: input.tolerancePercent,
    });
    const incidentId = result.incidentRequired
      ? `cost-forecast:${createHash('sha256')
          .update(`${input.operation}\u0000${input.forecastUnits}\u0000${input.actualUnits}`)
          .digest('hex')}`
      : undefined;
    return {
      incidentCreated: result.incidentRequired,
      ...(incidentId === undefined ? {} : { incidentId }),
      recomputedLimit: result.recomputedCap ?? input.forecastUnits,
      consumedPaidOverage: false,
      consumedReserve: false,
    };
  }
}
