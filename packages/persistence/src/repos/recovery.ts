/**
 * Recovery tier repository (T042, FR-DR-001, §34.4): tier registration under
 * the product-law RPO ceilings, the protected-asset registry mapping every
 * table/store this package creates onto its covering tier, and tier
 * measurement recording (§34.10 — measurements are never backdated).
 */
import {
  ErrorCode,
  ForesiftError,
  validateRecoveryTier,
  type RecoveryDataClass as RecoveryDataClassType,
  type RecoveryHealthState,
  type RecoveryTier,
  type RecoveryTierId,
  type TierMeasurement,
  type TierMeasurementOutcome,
  type UtcTimestamp,
} from '@foresift/domain';
import type { DatabaseEngine } from '../db.ts';

/** Register (or re-assert) a recovery tier; looser-than-ceiling RPO is refused. */
export async function registerRecoveryTier(
  engine: DatabaseEngine,
  tier: RecoveryTier,
  at: UtcTimestamp,
): Promise<void> {
  validateRecoveryTier(tier);
  await engine.query(
    `INSERT INTO recovery_tiers (tier_id, data_class, rpo_target_minutes, rto_target_minutes, created_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tier_id) DO UPDATE SET
       data_class = EXCLUDED.data_class,
       rpo_target_minutes = EXCLUDED.rpo_target_minutes,
       rto_target_minutes = EXCLUDED.rto_target_minutes`,
    [tier.id, tier.dataClass, tier.rpoTargetMinutes, tier.rtoTargetMinutes, at],
  );
}

/**
 * Seed the §34.4 default tiers. Idempotent: existing rows are re-asserted at
 * their defaults so a partially-seeded database converges.
 */
export async function seedDefaultRecoveryTiers(
  engine: DatabaseEngine,
  at: UtcTimestamp,
): Promise<void> {
  const defaults: readonly RecoveryTier[] = [
    {
      id: 'tier-critical-metadata' as RecoveryTierId,
      dataClass: 'CRITICAL_METADATA',
      rpoTargetMinutes: 5,
      rtoTargetMinutes: 60,
    },
    {
      id: 'tier-critical-observations-checkpoints' as RecoveryTierId,
      dataClass: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
      rpoTargetMinutes: 15,
      rtoTargetMinutes: 120,
    },
    {
      id: 'tier-replayable-raw-payloads' as RecoveryTierId,
      dataClass: 'REPLAYABLE_RAW_PAYLOADS',
      rpoTargetMinutes: 1440,
      rtoTargetMinutes: 480,
    },
  ];
  for (const tier of defaults) {
    await registerRecoveryTier(engine, tier, at);
  }
}

/**
 * Register a protected asset onto its covering tier. The asset's declared
 * class must match the tier's class — an observation table must never hide
 * behind a metadata tier.
 */
export async function registerProtectedAsset(
  engine: DatabaseEngine,
  input: { assetKey: string; dataClass: RecoveryDataClassType; tierId: string; at: UtcTimestamp },
): Promise<void> {
  const rows = await engine.query<{ data_class: string }>(
    'SELECT data_class FROM recovery_tiers WHERE tier_id = $1',
    [input.tierId],
  );
  const tierClass = rows.rows[0]?.data_class;
  if (tierClass === undefined) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      `unknown recovery tier ${input.tierId}`,
      {
        tierId: input.tierId,
      },
    );
  }
  if (tierClass !== input.dataClass) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      `asset class ${input.dataClass} does not match tier class ${tierClass}`,
      { assetKey: input.assetKey, tierId: input.tierId },
    );
  }
  await engine.query(
    `INSERT INTO protected_assets (asset_key, data_class, tier_id, registered_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (asset_key) DO UPDATE SET
       data_class = EXCLUDED.data_class,
       tier_id = EXCLUDED.tier_id`,
    [input.assetKey, input.dataClass, input.tierId, input.at],
  );
}

/**
 * Record one measured drill outcome for a tier (§34.10). A missed outcome
 * MUST carry an incident reference — the SQL CHECK enforces it; the domain
 * layer refuses before reaching the database so the refusal is typed.
 */
export async function recordTierMeasurement(
  engine: DatabaseEngine,
  input: {
    measurementId: string;
    measurement: TierMeasurement;
    incidentId?: string;
    measuredAt: UtcTimestamp;
  },
): Promise<TierMeasurementOutcome> {
  if (input.measurement.outcome !== 'WITHIN_TIER' && input.incidentId === undefined) {
    throw new ForesiftError(
      ErrorCode.DRILL_INCIDENT_RECORDED,
      `missed ${input.measurement.outcome} requires an incident reference`,
      { measurementId: input.measurementId, tierId: input.measurement.tierId },
    );
  }
  await engine.query(
    `INSERT INTO tier_measurements
       (measurement_id, tier_id, achieved_rpo_minutes, achieved_rto_minutes, outcome, incident_id, measured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.measurementId,
      input.measurement.tierId,
      input.measurement.achievedRpoMinutes,
      input.measurement.achievedRtoMinutes,
      input.measurement.outcome,
      input.incidentId ?? null,
      input.measuredAt,
    ],
  );
  return input.measurement.outcome;
}

/** Classify achieved values against a tier's configured targets. */
export function classifyMeasurement(
  tier: Pick<RecoveryTier, 'rpoTargetMinutes' | 'rtoTargetMinutes'>,
  achievedRpoMinutes: number,
  achievedRtoMinutes: number,
): TierMeasurementOutcome {
  const missedRpo = achievedRpoMinutes > tier.rpoTargetMinutes;
  const missedRto = achievedRtoMinutes > tier.rtoTargetMinutes;
  if (missedRpo && missedRto) return 'MISSED_BOTH';
  if (missedRpo) return 'MISSED_RPO';
  if (missedRto) return 'MISSED_RTO';
  return 'WITHIN_TIER';
}

// --- Incidents + recovery health (§34.9–§34.10, AC-260/AC-262) ----------------

export type IncidentKind = 'RPO_MISSED' | 'RTO_MISSED' | 'RPO_AND_RTO_MISSED' | 'RESTORE_FAILED';

export const INCIDENT_KIND_FOR_OUTCOME: Readonly<
  Record<Exclude<TierMeasurementOutcome, 'WITHIN_TIER'>, IncidentKind>
> = {
  MISSED_RPO: 'RPO_MISSED',
  MISSED_RTO: 'RTO_MISSED',
  MISSED_BOTH: 'RPO_AND_RTO_MISSED',
};

/** Open a durable incident record (§34.9 — a missed tier creates an incident). */
export async function openIncident(
  engine: DatabaseEngine,
  input: {
    incidentId: string;
    tierId?: string | undefined;
    kind: IncidentKind;
    reason: string;
    openedAt: UtcTimestamp;
  },
): Promise<void> {
  await engine.query(
    `INSERT INTO recovery_incidents (incident_id, tier_id, opened_at, kind, reason)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.incidentId, input.tierId ?? null, input.openedAt, input.kind, input.reason],
  );
}

/** Close an incident once the affected capability is repaired and re-verified. */
export async function resolveIncident(
  engine: DatabaseEngine,
  input: { incidentId: string; resolvedAt: UtcTimestamp },
): Promise<void> {
  const rows = await engine.query<{ resolved_at: string | null }>(
    'SELECT resolved_at FROM recovery_incidents WHERE incident_id = $1',
    [input.incidentId],
  );
  if (rows.rows[0] === undefined) {
    throw new ForesiftError(
      ErrorCode.DRILL_INCIDENT_RECORDED,
      `unknown incident ${input.incidentId}`,
      {
        incidentId: input.incidentId,
      },
    );
  }
  await engine.query('UPDATE recovery_incidents SET resolved_at = $2 WHERE incident_id = $1', [
    input.incidentId,
    input.resolvedAt,
  ]);
}

/**
 * Persist one machine-readable recovery-health evaluation. The degraded
 * contract is validated here BEFORE the database so refusals are typed:
 * degraded requires an incident reference and blocks confirmed-opportunity
 * influence while deterministic risk monitoring stays allowed.
 */
export async function recordRecoveryHealthState(
  engine: DatabaseEngine,
  input: { healthStateId: string; state: RecoveryHealthState },
): Promise<void> {
  const { state } = input;
  if (!state.deterministicRiskMonitoringAllowed) {
    throw new ForesiftError(
      ErrorCode.BACKUP_POLICY_INVALID,
      'deterministic risk monitoring is never suppressed alongside opportunity influence',
      { healthStateId: input.healthStateId },
    );
  }
  if (state.kind === 'DEGRADED') {
    if (state.incidentId === null || !state.confirmedOpportunityInfluenceBlocked) {
      throw new ForesiftError(
        ErrorCode.BACKUP_POLICY_INVALID,
        'degraded states require an incident and blocked opportunity influence',
        { healthStateId: input.healthStateId },
      );
    }
  } else if (state.kind === 'HEALTHY' && state.incidentId !== null) {
    throw new ForesiftError(ErrorCode.BACKUP_POLICY_INVALID, 'healthy states carry no incident', {
      healthStateId: input.healthStateId,
    });
  }
  await engine.query(
    `INSERT INTO recovery_health_states
       (health_state_id, capability, kind, confirmed_opportunity_influence_blocked,
        deterministic_risk_monitoring_allowed, incident_id, evaluated_at, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.healthStateId,
      state.capability,
      state.kind,
      state.confirmedOpportunityInfluenceBlocked,
      state.deterministicRiskMonitoringAllowed,
      state.incidentId,
      state.evaluatedAt,
      state.reason,
    ],
  );
}
