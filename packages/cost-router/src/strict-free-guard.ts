/** Deny-closed data-provider mode guard, evaluated before any egress (FR-COST-002). */
import { CostClass, CostMode } from '@foresift/domain';
import type { CostClass as CostClassType, CostMode as CostModeType } from '@foresift/domain';
import type { CostDenialRecord } from '@foresift/shared-schemas';

export type CostDenial = CostDenialRecord;

export interface StrictFreeGuardInput {
  readonly mode: CostModeType;
  readonly costClass: CostClassType;
  readonly allowedInStrictFree: boolean;
  readonly quotaAvailable?: boolean;
  readonly autoUpgrade?: boolean;
  readonly paidFallback?: boolean;
  readonly hasActivePaidPolicy?: boolean;
  readonly candidate: string;
  readonly caller: string;
  readonly alternative?: string;
  readonly provider?: string;
  readonly operation?: string;
}

function denial(input: StrictFreeGuardInput, reason: string, alternative: string): CostDenial {
  return {
    candidate: input.candidate,
    caller: input.caller,
    reason,
    alternative,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.operation === undefined ? {} : { operation: input.operation }),
  };
}

/** Null means admitted. Every non-null result is safe to emit as a cost denial record. */
export function strictFreeDenial(input: StrictFreeGuardInput): CostDenial | null {
  if (input.costClass === CostClass.UNKNOWN_COST || input.costClass === CostClass.DISABLED) {
    return denial(input, `UNKNOWN_COST:${input.costClass}`, 'USE_VERIFIED_FREE_OPERATION');
  }
  if (input.autoUpgrade === true) {
    return denial(
      input,
      'AUTO_UPGRADE_BLOCKED:EXPLICIT_POLICY_REQUIRED',
      'REMAIN_ON_VERIFIED_PLAN',
    );
  }
  if (input.paidFallback === true) {
    return denial(
      input,
      'PAID_FALLBACK_BLOCKED:EXPLICIT_POLICY_REQUIRED',
      'RETURN_PARTIAL_OR_CACHE',
    );
  }
  if (input.mode === CostMode.STRICT_FREE) {
    if (input.costClass === CostClass.PAID_EXPLICIT) {
      return denial(input, 'PAID_BLOCKED:PAID_EXPLICIT', 'USE_FREE_ALTERNATIVE');
    }
    if (!input.allowedInStrictFree) {
      return denial(
        input,
        'STRICT_FREE_BLOCKED:OPERATION_NOT_ALLOWED',
        'USE_STRICT_FREE_OPERATION',
      );
    }
    if (input.quotaAvailable === false) {
      return denial(
        input,
        'STRICT_FREE_BLOCKED:QUOTA_EXHAUSTED',
        input.alternative ?? 'RETURN_CACHE',
      );
    }
  } else if (input.costClass === CostClass.PAID_EXPLICIT && input.hasActivePaidPolicy !== true) {
    return denial(input, 'PAID_BLOCKED:ACTIVE_POLICY_REQUIRED', 'CREATE_APPROVE_ACTIVATE_POLICY');
  }
  return null;
}

export class StrictFreeGuard {
  evaluate(input: StrictFreeGuardInput): CostDenial | null {
    return strictFreeDenial(input);
  }
  allows(input: StrictFreeGuardInput): boolean {
    return strictFreeDenial(input) === null;
  }
}

export const evaluateStrictFree = strictFreeDenial;
