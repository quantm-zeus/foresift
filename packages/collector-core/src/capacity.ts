/**
 * Capacity ceiling validation (FR-COL-010).
 *
 * Deterministic, stateless check of a {@link CollectorCeilingSet} against the
 * collector's eight resource dimensions. A ceiling set is WITHIN LIMITS when
 * every dimension is a positive finite number; a breach names every violating
 * dimension so the capacity governor can pause affected partitions and open a
 * typed incident (see `capacity-governor.ts` for the stateful enforcement
 * layer built on this predicate).
 *
 * The task graph predicted this module as `packages/collector-core/src/
 * capacity.ts`; it lives alongside the governor that consumes it. Restored
 * from checkpoint lane core (wave 9cf2bf57) — the AGY-authored acceptance
 * substrate imports `checkCapacityCeilings` from here.
 */
import type { CollectorCeilingSet } from '@foresift/shared-schemas';

export interface CapacityCeilingCheck {
  readonly withinLimits: boolean;
  readonly violatedDimensions?: string[];
  readonly ceilingSetId: string;
}

const CEILING_DIMENSIONS = [
  'cpuCoreLimit',
  'memoryMbLimit',
  'networkBandwidthMbps',
  'activeSubscriptionLimit',
  'eventRatePerSecLimit',
  'rawStorageDailyMbLimit',
  'retryMaxPerHour',
  'monthlyCreditQuota',
] as const satisfies readonly (keyof CollectorCeilingSet)[];

export function checkCapacityCeilings(ceilings: unknown): CapacityCeilingCheck {
  if (typeof ceilings !== 'object' || ceilings === null)
    return { withinLimits: false, violatedDimensions: ['CEILING_SET'], ceilingSetId: '' };
  const c = ceilings as CollectorCeilingSet;
  const violated: string[] = [];
  for (const dimension of CEILING_DIMENSIONS) {
    const value = c[dimension];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      violated.push(dimension);
  }
  if (violated.length === 0) return { withinLimits: true, ceilingSetId: c.ceilingSetId ?? '' };
  return {
    withinLimits: false,
    violatedDimensions: [...violated].sort(),
    ceilingSetId: c.ceilingSetId ?? '',
  };
}
