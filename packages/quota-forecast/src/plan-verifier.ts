/** Expiry-exact verified plan state; stale limits are never estimated from. */
import { ErrorCode, ForesiftError } from '@foresift/domain';
import { ForecastSnapshotSchema, type ForecastSnapshot } from '@foresift/shared-schemas';

export type VerificationState = 'VERIFIED' | 'UNVERIFIED';

export interface VerifiablePlanMetadata {
  readonly verificationExpiresAt: string;
}

function epoch(value: string): number {
  const result = new Date(value).getTime();
  if (!Number.isFinite(result)) throw new TypeError(`invalid verification timestamp: ${value}`);
  return result;
}

export function verificationState(expiresAt: string, at: string): VerificationState {
  return epoch(at) < epoch(expiresAt) ? 'VERIFIED' : 'UNVERIFIED';
}

export class PlanVerifier {
  private readonly snapshots = new Map<string, ForecastSnapshot>();
  constructor(
    snapshots: readonly ForecastSnapshot[] = [],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    for (const snapshot of snapshots) this.reVerify(snapshot);
  }

  reVerify(snapshot: ForecastSnapshot): ForecastSnapshot {
    const parsed = ForecastSnapshotSchema.parse(snapshot);
    if (epoch(parsed.expiresAt) <= epoch(parsed.verifiedAt)) {
      throw new ForesiftError(
        ErrorCode.COST_PLAN_UNVERIFIED,
        'UNVERIFIED: expiry must follow verification',
      );
    }
    this.snapshots.set(parsed.snapshotId, parsed);
    return parsed;
  }

  status(
    snapshotOrMetadata: string | ForecastSnapshot | VerifiablePlanMetadata,
    at = this.now(),
  ): VerificationState {
    if (typeof snapshotOrMetadata === 'string') {
      const snapshot = this.snapshots.get(snapshotOrMetadata);
      return snapshot === undefined ? 'UNVERIFIED' : verificationState(snapshot.expiresAt, at);
    }
    const expiresAt =
      'expiresAt' in snapshotOrMetadata
        ? snapshotOrMetadata.expiresAt
        : snapshotOrMetadata.verificationExpiresAt;
    return verificationState(expiresAt, at);
  }

  requireVerified(snapshotId: string, at = this.now()): ForecastSnapshot {
    const snapshot = this.snapshots.get(snapshotId);
    if (snapshot === undefined || this.status(snapshot, at) === 'UNVERIFIED') {
      throw new ForesiftError(
        ErrorCode.COST_PLAN_UNVERIFIED,
        `UNVERIFIED: current verified plan snapshot required for ${snapshotId}`,
        { snapshotId, at },
      );
    }
    return snapshot;
  }

  /** Estimation callback is never invoked for stale or missing metadata. */
  estimate<T>(
    snapshotId: string,
    estimator: (snapshot: ForecastSnapshot) => T,
    at = this.now(),
  ): T {
    return estimator(this.requireVerified(snapshotId, at));
  }
}

export { PlanVerifier as VerifiedPlanVerifier };
