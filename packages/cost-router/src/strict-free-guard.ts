import { CostClass, CostMode } from '@foresift/domain';
import type { OperationCostDeclaration } from '@foresift/shared-schemas';
import { shapeCostDenial, type CostDenial } from './cost-audit.ts';

export interface StrictFreeGuardInput {
  readonly mode?: CostMode;
  readonly declaration: OperationCostDeclaration;
  readonly candidate?: string;
  readonly caller?: string;
  readonly workloadClass?: string;
  readonly callerId?: string;
  readonly remainingUnits?: number;
  readonly estimatedUnits?: number;
  readonly requestedUnits?: number;
  readonly automaticUpgrade?: boolean;
  readonly paidFallback?: boolean;
  readonly paidFallbackAttempted?: boolean;
  readonly alternative?: string;
}

function denial(input: StrictFreeGuardInput, reason: string): CostDenial {
  return shapeCostDenial({
    candidate:
      input.candidate ?? `${input.declaration.providerId}/${input.declaration.operationId}`,
    caller: input.caller ?? input.callerId ?? 'unknown-caller',
    reason,
    alternative: input.alternative ?? 'RETURN_CACHE',
  });
}

/** Undefined means admitted; a record means the call must stop before egress. */
export function strictFreeGuard(input: StrictFreeGuardInput): CostDenial | undefined {
  if ((input.mode ?? CostMode.STRICT_FREE) !== CostMode.STRICT_FREE) return undefined;
  const declaration = input.declaration;
  if (declaration.costClass === CostClass.PAID_EXPLICIT) {
    return denial(input, 'PAID_BLOCKED: paid provider operation requires an active policy');
  }
  if (
    declaration.costClass === CostClass.UNKNOWN_COST ||
    declaration.costClass === CostClass.DISABLED
  ) {
    return denial(input, 'UNKNOWN_COST: operation cost is not admissible');
  }
  if (!declaration.allowedInStrictFree) {
    return denial(input, 'STRICT_FREE_BLOCKED: operation is not explicitly free-enabled');
  }
  if (
    input.automaticUpgrade ||
    declaration.batchCapability?.automaticUpgrade === true ||
    declaration.batchCapability?.autoUpgrade === true
  ) {
    return denial(input, 'AUTO_UPGRADE_BLOCKED: automatic billing upgrade is forbidden');
  }
  if (
    input.paidFallback ||
    input.paidFallbackAttempted ||
    declaration.paidFallbackAllowed === true
  ) {
    return denial(input, 'PAID_FALLBACK_BLOCKED: paid fallback is forbidden');
  }
  if (
    input.remainingUnits !== undefined &&
    (input.estimatedUnits ?? input.requestedUnits ?? declaration.quotaUnitCost) >
      input.remainingUnits
  ) {
    return denial(input, 'QUOTA_EXHAUSTED: free quota would be exceeded');
  }
  return undefined;
}

export interface StrictFreeGuardVerdict {
  readonly allowed: boolean;
  readonly denial?: CostDenial;
}

export function evaluateStrictFreeGuard(input: StrictFreeGuardInput): StrictFreeGuardVerdict {
  const blocked = strictFreeGuard(input);
  return blocked === undefined ? { allowed: true } : { allowed: false, denial: blocked };
}

export class StrictFreeGuard {
  evaluate(input: StrictFreeGuardInput): CostDenial | undefined {
    return strictFreeGuard(input);
  }
  assert(input: StrictFreeGuardInput): void {
    const blocked = strictFreeGuard(input);
    if (blocked !== undefined) throw new Error(blocked.reason);
  }
}
