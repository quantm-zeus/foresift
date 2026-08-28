/** Protected reserve routing and broad-scan non-invasion (FR-COST-003/004). */
import { ReserveId, WorkloadClass } from '@foresift/domain';
import type {
  ReserveId as ReserveIdType,
  WorkloadClass as WorkloadClassType,
} from '@foresift/domain';

export const BROAD_SCAN_WORKLOADS = Object.freeze([
  WorkloadClass.BACKFILL_LOW,
  WorkloadClass.EVALUATION_LOW,
  WorkloadClass.SCHEDULED_NORMAL,
] as const);

export interface ReserveRouteInput {
  readonly workloadClass: WorkloadClassType;
  readonly operation: string;
  readonly protectedReserveEligible?: boolean;
  readonly generalPoolExhausted?: boolean;
  readonly breadthDegraded?: boolean;
  readonly depthDegraded?: boolean;
}

export interface ReserveRouteDecision {
  readonly reserveId: ReserveIdType | null;
  readonly allowed: boolean;
  readonly reason: string;
  readonly degradationRequired: 'BREADTH' | 'DEPTH' | null;
}

function isBroad(workloadClass: WorkloadClassType): boolean {
  return (BROAD_SCAN_WORKLOADS as readonly string[]).includes(workloadClass);
}

export function decideReserveRoute(input: ReserveRouteInput): ReserveRouteDecision {
  if (isBroad(input.workloadClass)) {
    const degradationRequired =
      input.generalPoolExhausted !== true
        ? null
        : input.breadthDegraded !== true
          ? 'BREADTH'
          : input.depthDegraded !== true
            ? 'DEPTH'
            : null;
    return {
      reserveId: null,
      allowed: input.generalPoolExhausted !== true,
      reason:
        degradationRequired === null
          ? 'BROAD_SCAN_RESERVE_INELIGIBLE'
          : `DEGRADE_${degradationRequired}_BEFORE_PROTECTED_QUOTA`,
      degradationRequired,
    };
  }
  if (input.protectedReserveEligible === false) {
    return {
      reserveId: null,
      allowed: true,
      reason: 'OPERATION_RESERVE_INELIGIBLE',
      degradationRequired: null,
    };
  }
  const operation = input.operation.toUpperCase();
  let reserveId: ReserveIdType | null = null;
  if (
    operation.includes('ALERT') &&
    (operation.includes('VERIFY') || operation.includes('VERIFICATION'))
  ) {
    reserveId = ReserveId.ALERT_VERIFICATION;
  } else if (operation.includes('EMERGENCY') || operation.includes('GAP_RECOVERY')) {
    reserveId = ReserveId.EMERGENCY_BACKFILL;
  } else if (input.workloadClass === WorkloadClass.RISK_MONITOR_HIGH) {
    reserveId = ReserveId.RISK_MONITORING;
  } else if (input.workloadClass === WorkloadClass.INTERACTIVE_HIGH) {
    reserveId = ReserveId.INTERACTIVE_MCP;
  }
  return {
    reserveId,
    allowed: reserveId !== null || input.generalPoolExhausted !== true,
    reason: reserveId === null ? 'GENERAL_POOL' : `PROTECTED_RESERVE:${reserveId}`,
    degradationRequired: null,
  };
}

export function routeReserve(
  workloadClass: WorkloadClassType,
  operation: string,
): ReserveIdType | null;
export function routeReserve(input: ReserveRouteInput): ReserveIdType | null;
export function routeReserve(
  inputOrWorkload: ReserveRouteInput | WorkloadClassType,
  operation?: string,
): ReserveIdType | null {
  const input: ReserveRouteInput =
    typeof inputOrWorkload === 'string'
      ? { workloadClass: inputOrWorkload, operation: operation ?? '' }
      : inputOrWorkload;
  return decideReserveRoute(input).reserveId;
}

export class ProtectedReserveRouter {
  route(input: ReserveRouteInput): ReserveRouteDecision {
    return decideReserveRoute(input);
  }
}

export { ProtectedReserveRouter as ReserveRouter };

const DIRECT_RESERVE_WORKLOADS: Readonly<Record<string, ReserveIdType>> = {
  RISK_MONITORING: ReserveId.RISK_MONITORING,
  ALERT_VERIFICATION: ReserveId.ALERT_VERIFICATION,
  INTERACTIVE_MCP: ReserveId.INTERACTIVE_MCP,
  EMERGENCY_BACKFILL: ReserveId.EMERGENCY_BACKFILL,
};

export function resolveReserveBucket(
  workloadClass: string,
  _operation: string,
): ReserveIdType | null {
  if (
    (BROAD_SCAN_WORKLOADS as readonly string[]).includes(workloadClass) ||
    workloadClass === 'DISCOVERY_BROAD'
  )
    return null;
  return DIRECT_RESERVE_WORKLOADS[workloadClass] ?? null;
}

export function canAdmitFromReserve(
  workloadClass: string,
  balances: Readonly<Record<string, number>>,
): boolean {
  const reserve = resolveReserveBucket(workloadClass, '');
  return reserve !== null && Number.isFinite(balances[reserve]) && (balances[reserve] ?? 0) > 0;
}

export function allocateFromReserve(input: {
  readonly targetReserve: string;
  readonly workloadClass: string;
  readonly units: number;
}): { readonly success: boolean; readonly error?: string } {
  const authorized = resolveReserveBucket(input.workloadClass, '') === input.targetReserve;
  return authorized && Number.isFinite(input.units) && input.units > 0
    ? { success: true }
    : { success: false, error: 'RESERVE_ACCESS_UNAUTHORIZED: WORKLOAD_NOT_ELIGIBLE' };
}
