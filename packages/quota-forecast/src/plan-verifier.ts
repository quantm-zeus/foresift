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
  private readonly operationExpiries = new Map<string, string>();
  private readonly now: () => string;
  constructor(
    snapshotsOrEngine: readonly ForecastSnapshot[] | unknown = [],
    now: (() => string) | undefined = undefined,
  ) {
    this.now = now ?? (() => new Date().toISOString());
    if (Array.isArray(snapshotsOrEngine)) {
      for (const snapshot of snapshotsOrEngine as readonly ForecastSnapshot[])
        this.reVerify(snapshot);
    }
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

  async isOperationAdmissible(
    operationId: string,
    asOf: string,
  ): Promise<{ readonly admissible: boolean; readonly state: VerificationState }> {
    const expiresAt = this.operationExpiries.get(operationId);
    const state = expiresAt === undefined ? 'UNVERIFIED' : verificationState(expiresAt, asOf);
    return { admissible: state === 'VERIFIED', state };
  }

  async reVerifyOperation(operationId: string, ttlSeconds: number, asOf: string): Promise<void> {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)
      throw new RangeError('TTL must be positive');
    this.operationExpiries.set(
      operationId,
      new Date(epoch(asOf) + ttlSeconds * 1000).toISOString(),
    );
  }
}

export { PlanVerifier as VerifiedPlanVerifier };

export function checkPlanFreshness(
  plan: { readonly expiresAt: string },
  asOf: string,
): { readonly isVerified: boolean; readonly status: VerificationState } {
  const status = verificationState(plan.expiresAt, asOf);
  return { isVerified: status === 'VERIFIED', status };
}

export function assertPlanVerified(plan: {
  readonly isVerified: boolean;
  readonly status: string;
  readonly planId: string;
}): void {
  if (!plan.isVerified || plan.status !== 'VERIFIED')
    throw new ForesiftError(ErrorCode.COST_PLAN_UNVERIFIED, `UNVERIFIED: ${plan.planId}`);
}

export function assertPlanValidity(plan: {
  readonly planId: string;
  readonly expiresAt: string;
  readonly asOf: string;
}): void {
  if (verificationState(plan.expiresAt, plan.asOf) === 'UNVERIFIED')
    throw new ForesiftError(ErrorCode.COST_PLAN_UNVERIFIED, `PLAN_EXPIRED: ${plan.planId}`);
}

export function reVerifyPlan(
  _planId: string,
  freshTtlSeconds: number,
  now: string,
): { readonly isVerified: true; readonly status: 'VERIFIED'; readonly newExpiresAt: string } {
  if (!Number.isFinite(freshTtlSeconds) || freshTtlSeconds <= 0)
    throw new RangeError('fresh TTL must be positive');
  return {
    isVerified: true,
    status: 'VERIFIED',
    newExpiresAt: new Date(epoch(now) + freshTtlSeconds * 1000).toISOString().replace('.000Z', 'Z'),
  };
}
