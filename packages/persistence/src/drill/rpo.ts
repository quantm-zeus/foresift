/**
 * Measured-RPO/RTO drill evaluation (FR-DR-001, §34.9–§34.10,
 * AC-062/AC-260/AC-262).
 *
 * All instants are injected through ClockPort/scripted timelines so tier
 * measurements are exact and deterministic. A missed tier:
 *  - opens a durable incident record,
 *  - records the tier measurement with that incident reference,
 *  - flips the affected capability's recovery_health_states to DEGRADED
 *    with confirmed-opportunity influence BLOCKED while deterministic risk
 *    monitoring stays ALLOWED.
 */
import {
  degradedHealthState,
  ErrorCode,
  ForesiftError,
  type ClockPort,
  type RecoveryTier,
  type TierMeasurement,
  type TierMeasurementOutcome,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';
import {
  classifyMeasurement,
  INCIDENT_KIND_FOR_OUTCOME,
  openIncident,
  recordRecoveryHealthState,
  recordTierMeasurement,
} from '../repos/recovery.ts';

const MS_PER_MINUTE = 60_000;

/** Raw timeline of one restore attempt against one tier. */
export interface RestoreAttemptTimeline {
  /** Last write durably acknowledged before the loss. */
  readonly lastDurableWriteAt: UtcTimestamp;
  /** Instant the loss/incident was detected and restore began. */
  readonly restoreStartedAt: UtcTimestamp;
  /** Newest data instant present in the restored state. */
  readonly dataRecoveredThroughAt: UtcTimestamp;
  /** Instant service was verified restored (checks green). */
  readonly restoreCompletedAt: UtcTimestamp;
}

/**
 * Compute achieved RPO/RTO minutes from a timeline; classification vs targets
 * is separate. A negative or non-finite delta means the reported timeline is
 * itself inconsistent (restore completed before it started, recovered data
 * predating acknowledged durable writes, unparseable instants) — such input
 * is refused, never clamped into a fabricated healthy score.
 */
export function achievedMinutes(timeline: RestoreAttemptTimeline): {
  rpoMinutes: number;
  rtoMinutes: number;
} {
  const rpoMs =
    Date.parse(timeline.dataRecoveredThroughAt) - Date.parse(timeline.lastDurableWriteAt);
  const rtoMs = Date.parse(timeline.restoreCompletedAt) - Date.parse(timeline.restoreStartedAt);
  if (!Number.isFinite(rpoMs) || !Number.isFinite(rtoMs)) {
    throw new ForesiftError(
      ErrorCode.DRILL_TIMELINE_INVALID,
      'drill timeline contains unparseable instants',
      {
        lastDurableWriteAt: timeline.lastDurableWriteAt,
        restoreStartedAt: timeline.restoreStartedAt,
        dataRecoveredThroughAt: timeline.dataRecoveredThroughAt,
        restoreCompletedAt: timeline.restoreCompletedAt,
      },
    );
  }
  if (rpoMs < 0 || rtoMs < 0) {
    throw new ForesiftError(
      ErrorCode.DRILL_TIMELINE_INVALID,
      'drill timeline deltas must be non-negative (recovered-through may not precede the last durable write; completion may not precede start)',
      { rpoDeltaMs: rpoMs, rtoDeltaMs: rtoMs },
    );
  }
  return {
    rpoMinutes: rpoMs / MS_PER_MINUTE,
    rtoMinutes: rtoMs / MS_PER_MINUTE,
  };
}

export function measureAgainstTier(
  tier: RecoveryTier,
  timeline: RestoreAttemptTimeline,
): TierMeasurement {
  const achieved = achievedMinutes(timeline);
  const outcome: TierMeasurementOutcome = classifyMeasurement(
    tier,
    achieved.rpoMinutes,
    achieved.rtoMinutes,
  );
  return {
    tierId: tier.id,
    achievedRpoMinutes: achieved.rpoMinutes,
    achievedRtoMinutes: achieved.rtoMinutes,
    outcome,
  };
}

export interface RecordedDrillOutcome {
  readonly measurement: TierMeasurement;
  readonly incidentId: string | null;
  readonly healthKind: 'HEALTHY' | 'DEGRADED';
}

/**
 * Run one destructive-drill evaluation for a capability under a tier:
 * classify, persist the measurement, and on miss open the incident + flip
 * the machine-readable health state. Within-tier leaves health untouched
 * (healthy by default) and writes no incident.
 */
export async function evaluateAndRecordDrill(input: {
  engine: DatabaseEngine;
  clock: ClockPort;
  tier: RecoveryTier;
  /** Capability whose health degrades on a miss (e.g. 'observations'). */
  readonly capability: string;
  timeline: RestoreAttemptTimeline;
  measurementId: string;
}): Promise<RecordedDrillOutcome> {
  const measurement = measureAgainstTier(input.tier, input.timeline);
  const now = input.clock.now();

  if (measurement.outcome === 'WITHIN_TIER') {
    await recordTierMeasurement(input.engine, {
      measurementId: input.measurementId,
      measurement,
      measuredAt: now,
    });
    return { measurement, incidentId: null, healthKind: 'HEALTHY' };
  }

  const incidentId = `incident-${input.measurementId}`;
  await openIncident(input.engine, {
    incidentId,
    tierId: input.tier.id,
    kind: INCIDENT_KIND_FOR_OUTCOME[measurement.outcome],
    reason: `${input.capability}: ${measurement.outcome} (RPO ${measurement.achievedRpoMinutes}min, RTO ${measurement.achievedRtoMinutes}min vs targets ${input.tier.rpoTargetMinutes}/${input.tier.rtoTargetMinutes}min)`,
    openedAt: now,
  });
  await recordTierMeasurement(input.engine, {
    measurementId: input.measurementId,
    measurement,
    incidentId,
    measuredAt: now,
  });
  await recordRecoveryHealthState(input.engine, {
    healthStateId: `health-${input.measurementId}`,
    state: degradedHealthState(
      input.capability,
      incidentId,
      now,
      `recovery tier ${input.tier.id} missed (${measurement.outcome}); confirmed-opportunity claims blocked until repaired`,
    ),
  });
  return { measurement, incidentId, healthKind: 'DEGRADED' };
}
