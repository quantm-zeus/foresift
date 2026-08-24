/**
 * Recovery tiers, RPO/RTO classes, and degraded-capability states
 * (FR-DR-001, FR-DR-002; §34.4/§34.9/§34.10).
 *
 * Tier ceilings are product law: critical metadata ≤15 min RPO; critical
 * observations/checkpoints ≤60 min RPO; replayable raw payloads ≤24 h RPO
 * when rights permit reconstruction. Deployments may configure stricter
 * targets — never looser ones.
 */
import { ErrorCode, RecoveryError } from './errors.ts';

declare const brand: unique symbol;
export type RecoveryTierId = string & { readonly [brand]: 'RecoveryTierId' };

/** The three FR-DR-001 data/service classes this package owns storage for. */
export const RecoveryDataClass = {
  /** Configuration, policies, approvals, decisions index, evidence index metadata. */
  CRITICAL_METADATA: 'CRITICAL_METADATA',
  /** Observations and collector checkpoints. */
  CRITICAL_OBSERVATIONS_CHECKPOINTS: 'CRITICAL_OBSERVATIONS_CHECKPOINTS',
  /** Replayable raw payloads (when rights permit reconstruction). */
  REPLAYABLE_RAW_PAYLOADS: 'REPLAYABLE_RAW_PAYLOADS',
} as const;

export type RecoveryDataClass = (typeof RecoveryDataClass)[keyof typeof RecoveryDataClass];

/**
 * Ceiling in minutes — the FR-DR-001 MAXIMA (§34.4-bound). Note the posture
 * separation: these values are product law as ceilings, while §34.4's DEFAULT
 * targets are stricter; deployments configure within the ceilings and may be
 * required to sit at the stricter defaults.
 */
export const TIER_RPO_CEILING_MINUTES: Readonly<Record<RecoveryDataClass, number>> = {
  CRITICAL_METADATA: 15,
  CRITICAL_OBSERVATIONS_CHECKPOINTS: 60,
  REPLAYABLE_RAW_PAYLOADS: 24 * 60,
};

/** A configured recovery tier. RTO is deployment-configured within reason; RPO ceilings are hard. */
export interface RecoveryTier {
  readonly id: RecoveryTierId;
  readonly dataClass: RecoveryDataClass;
  /** Configured target in minutes; MUST be ≤ the class ceiling. */
  readonly rpoTargetMinutes: number;
  readonly rtoTargetMinutes: number;
}

export function validateRecoveryTier(tier: RecoveryTier): void {
  const ceiling = TIER_RPO_CEILING_MINUTES[tier.dataClass];
  if (!Number.isFinite(tier.rpoTargetMinutes) || tier.rpoTargetMinutes <= 0) {
    throw new RecoveryError(
      'RPO target must be a positive number',
      { tierId: tier.id },
      ErrorCode.BACKUP_POLICY_INVALID,
    );
  }
  if (tier.rpoTargetMinutes > ceiling) {
    throw new RecoveryError(
      `RPO target exceeds the ${String(ceiling)}-minute ceiling for ${tier.dataClass}`,
      { tierId: tier.id, rpoTargetMinutes: tier.rpoTargetMinutes, ceiling },
      ErrorCode.RECOVERY_TIER_CEILING_EXCEEDED,
    );
  }
  if (!Number.isFinite(tier.rtoTargetMinutes) || tier.rtoTargetMinutes <= 0) {
    throw new RecoveryError(
      'RTO target must be a positive number',
      { tierId: tier.id },
      ErrorCode.BACKUP_POLICY_INVALID,
    );
  }
}

/** Outcome of measuring an actual restore against a tier. */
export type TierMeasurementOutcome = 'WITHIN_TIER' | 'MISSED_RPO' | 'MISSED_RTO' | 'MISSED_BOTH';

/** Measured RPO/RTO for one tier during a drill. */
export interface TierMeasurement {
  readonly tierId: RecoveryTierId;
  readonly achievedRpoMinutes: number;
  readonly achievedRtoMinutes: number;
  readonly outcome: TierMeasurementOutcome;
}

/** Machine-readable health of a capability after recovery evaluation. */
export const RecoveryHealthStateKind = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
} as const;

export type RecoveryHealthStateKind =
  (typeof RecoveryHealthStateKind)[keyof typeof RecoveryHealthStateKind];

/**
 * Degraded-capability state record (AC-260/262): when a tier is missed the
 * affected capability degrades machine-readably — confirmed-opportunity
 * influence is blocked while safe deterministic risk monitoring remains
 * allowed (never both suppressed).
 */
export interface RecoveryHealthState {
  readonly capability: string;
  readonly kind: RecoveryHealthStateKind;
  /** True ⇒ confirmed-opportunity claims/alerts blocked until repaired. */
  readonly confirmedOpportunityInfluenceBlocked: boolean;
  /**
   * Enforced at the storage layer (recovery_health_states CHECK
   * `recovery_health_preserves_risk_monitoring` in g0_dr_0002) and re-validated
   * by `recordRecoveryHealthState` before the database — risk alerts stay
   * permitted; AC-262's degraded contract.
   */
  readonly deterministicRiskMonitoringAllowed: boolean;
  /** Incident reference when degraded (§34.9). */
  readonly incidentId: string | null;
  readonly evaluatedAt: string;
  readonly reason: string;
}

/** Build the required post-violation state: opportunity blocked, risk monitoring preserved. */
export function degradedHealthState(
  capability: string,
  incidentId: string,
  evaluatedAt: string,
  reason: string,
): RecoveryHealthState {
  return {
    capability,
    kind: RecoveryHealthStateKind.DEGRADED,
    confirmedOpportunityInfluenceBlocked: true,
    deterministicRiskMonitoringAllowed: true,
    incidentId,
    evaluatedAt,
    reason,
  };
}
