import { ErrorCode, ForesiftError } from '@foresift/domain';
import type { OperationCostDeclaration, ForecastSnapshot } from '@foresift/shared-schemas';

export type PlanVerificationState = 'VERIFIED' | 'UNVERIFIED';
export interface VerifiablePlan {
  readonly verificationExpiresAt?: string | undefined;
  readonly expiresAt?: string | undefined;
}

export function planVerificationState(
  plan: VerifiablePlan,
  at: Date = new Date(),
): PlanVerificationState {
  const expiry = plan.verificationExpiresAt ?? plan.expiresAt;
  if (
    expiry === undefined ||
    !Number.isFinite(Date.parse(expiry)) ||
    at.getTime() >= Date.parse(expiry)
  ) {
    return 'UNVERIFIED';
  }
  return 'VERIFIED';
}

export function isPlanMetadataVerified(expiresAt: string, at: string): boolean {
  return Number.isFinite(Date.parse(expiresAt)) && Date.parse(at) < Date.parse(expiresAt);
}

export function verifyPlanFreshness(
  snapshot: { readonly expiresAt: string },
  at: string,
): { readonly verified: boolean; readonly status: PlanVerificationState } {
  const verified = isPlanMetadataVerified(snapshot.expiresAt, at);
  return { verified, status: verified ? 'VERIFIED' : 'UNVERIFIED' };
}

export class PlanVerifier {
  private readonly refreshed = new Map<string, string>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  state(plan: VerifiablePlan, at: Date = this.now()): PlanVerificationState {
    return planVerificationState(plan, at);
  }
  assertVerified(plan: OperationCostDeclaration | ForecastSnapshot, at: Date = this.now()): void {
    const identity =
      'snapshotId' in plan ? plan.snapshotId : `${plan.providerId}/${plan.operationId}`;
    const override = this.refreshed.get(identity);
    const target: VerifiablePlan =
      override === undefined ? plan : { verificationExpiresAt: override };
    if (this.state(target, at) !== 'VERIFIED') {
      throw new ForesiftError(
        ErrorCode.PLAN_UNVERIFIED,
        'UNVERIFIED_PLAN: verified plan metadata is stale',
        { identity },
      );
    }
  }
  reVerify(identity: string, expiresAt: string): void {
    if (!(Date.parse(expiresAt) > this.now().getTime())) {
      throw new ForesiftError(
        ErrorCode.PLAN_UNVERIFIED,
        're-verification must have a future expiry',
      );
    }
    this.refreshed.set(identity, expiresAt);
  }
}
