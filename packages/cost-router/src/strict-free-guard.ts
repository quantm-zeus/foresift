/** Deny-closed egress guard for free-first provider calls (FR-COST-002). */
import { CostClass, CostMode } from '@foresift/domain';
import type { CostDenialRecord } from '@foresift/shared-schemas';
import type { CostDeclaration } from './cost-declaration.ts';

export type CostDenial = CostDenialRecord;

export interface StrictFreeGuardInput {
  readonly mode: CostMode;
  readonly declaration: CostDeclaration;
  readonly candidate: string;
  readonly caller: string;
  readonly alternative: string;
  readonly quotaExhausted?: boolean;
  readonly automaticUpgrade?: boolean;
  readonly paidFallback?: boolean;
}

function denial(input: StrictFreeGuardInput, reason: string): CostDenial {
  return {
    candidate: input.candidate,
    caller: input.caller,
    reason,
    alternative: input.alternative,
  };
}

/** Null means admission; every unsafe or ambiguous branch returns a denial. */
export function strictFreeDenial(input: StrictFreeGuardInput): CostDenial | null {
  const { declaration } = input;
  if (
    declaration.costClass === CostClass.UNKNOWN_COST ||
    declaration.costClass === CostClass.DISABLED
  ) {
    return denial(input, `UNKNOWN_COST:${declaration.providerId}/${declaration.operationId}`);
  }
  if (input.automaticUpgrade === true) {
    return denial(
      input,
      `AUTO_UPGRADE_BLOCKED:${declaration.providerId}/${declaration.operationId}`,
    );
  }
  if (input.paidFallback === true) {
    return denial(
      input,
      `PAID_FALLBACK_BLOCKED:${declaration.providerId}/${declaration.operationId}`,
    );
  }
  if (input.mode === CostMode.STRICT_FREE) {
    if (declaration.costClass === CostClass.PAID_EXPLICIT) {
      return denial(
        input,
        `STRICT_FREE_BLOCKED:PAID_EXPLICIT:${declaration.providerId}/${declaration.operationId}`,
      );
    }
    if (!declaration.allowedInStrictFree) {
      return denial(
        input,
        `STRICT_FREE_BLOCKED:NOT_ALLOWED:${declaration.providerId}/${declaration.operationId}`,
      );
    }
    if (input.quotaExhausted === true) {
      return denial(
        input,
        `STRICT_FREE_BLOCKED:QUOTA_EXHAUSTED:${declaration.providerId}/${declaration.operationId}`,
      );
    }
  } else if (declaration.costClass === CostClass.PAID_EXPLICIT && input.quotaExhausted === true) {
    return denial(
      input,
      `PAID_BLOCKED:BUDGET_EXHAUSTED:${declaration.providerId}/${declaration.operationId}`,
    );
  }
  return null;
}

export class StrictFreeGuard {
  evaluate(input: StrictFreeGuardInput): CostDenial | null {
    return strictFreeDenial(input);
  }

  allows(input: StrictFreeGuardInput): boolean {
    return this.evaluate(input) === null;
  }
}
