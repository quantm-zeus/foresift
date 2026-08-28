/** Verified-plan forecast versus observed actuals and tolerance response. */
import type { ForecastSnapshot } from '@foresift/shared-schemas';
import { assertVerified } from './plan-verifier.ts';

export interface CostForecastResult {
  readonly estimatedForecast: Readonly<Record<string, number>>;
  readonly actualObserved: Readonly<Record<string, number>>;
  readonly delta: Readonly<Record<string, number>>;
  readonly withinTolerance: boolean;
  readonly recomputedAdmissionCaps: Readonly<Record<string, number>>;
  readonly incidentId: string | null;
}

export interface ForecastIncidentSink {
  raise(input: {
    readonly type: 'CAPACITY_CONTRACT_BREACH';
    readonly snapshotId: string;
    readonly delta: Readonly<Record<string, number>>;
  }): Promise<string>;
}

export interface CostForecastOptions {
  readonly tolerance: number;
  readonly at?: Date;
  readonly incidentSink?: ForecastIncidentSink;
  readonly onAdmissionCapsRecomputed?: (
    caps: Readonly<Record<string, number>>,
  ) => Promise<void> | void;
}

export class CostForecast {
  async compute(
    snapshot: ForecastSnapshot,
    options: CostForecastOptions,
  ): Promise<CostForecastResult> {
    const at = options.at ?? new Date();
    assertVerified(snapshot, at);
    if (!Number.isFinite(options.tolerance) || options.tolerance < 0)
      throw new Error('forecast tolerance must be nonnegative');
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
    let withinTolerance = true;
    for (const key of keys) {
      const limit = snapshot.planLimitsJson[key] ?? 0;
      const actual = snapshot.observedUsageJson[key] ?? 0;
      const estimate = snapshot.estimatedForecastJson[key] ?? limit * actual;
      const difference = actual - estimate;
      estimatedForecast[key] = estimate;
      actualObserved[key] = actual;
      delta[key] = difference;
      const permitted =
        options.tolerance <= 1
          ? Math.max(options.tolerance * Math.max(estimate, 1), options.tolerance)
          : options.tolerance;
      if (difference > permitted) withinTolerance = false;
      recomputedAdmissionCaps[key] = Math.max(0, limit - Math.max(0, difference));
    }
    let incidentId: string | null = null;
    if (!withinTolerance) {
      incidentId =
        (await options.incidentSink?.raise({
          type: 'CAPACITY_CONTRACT_BREACH',
          snapshotId: snapshot.snapshotId,
          delta,
        })) ?? `capacity-breach:${snapshot.snapshotId}`;
      await options.onAdmissionCapsRecomputed?.(recomputedAdmissionCaps);
    }
    return {
      estimatedForecast,
      actualObserved,
      delta,
      withinTolerance,
      recomputedAdmissionCaps,
      incidentId,
    };
  }
}
