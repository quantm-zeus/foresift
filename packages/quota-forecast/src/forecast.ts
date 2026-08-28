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
