import {
  ReserveId,
  WorkloadClass,
  type ReserveId as ReserveIdType,
  type WorkloadClass as WorkloadClassType,
} from '@foresift/domain';

export interface ReserveRouteInput {
  readonly workloadClass: WorkloadClassType;
  readonly operation: string;
  readonly protectedReserveEligible: boolean;
  readonly breadthDegraded?: boolean;
  readonly depthDegraded?: boolean;
}

const BROAD_SCAN = new Set<WorkloadClassType>([
  WorkloadClass.BACKFILL_LOW,
  WorkloadClass.EVALUATION_LOW,
  WorkloadClass.SCHEDULED_NORMAL,
]);

export function routeProtectedReserve(input: ReserveRouteInput): ReserveIdType | null {
  if (!input.protectedReserveEligible || BROAD_SCAN.has(input.workloadClass)) return null;
  const operation = input.operation.toUpperCase();
  if (operation.includes('ALERT')) return ReserveId.ALERT_VERIFICATION;
  if (operation.includes('EMERGENCY')) return ReserveId.EMERGENCY_BACKFILL;
  if (input.workloadClass === WorkloadClass.RISK_MONITOR_HIGH) return ReserveId.RISK_MONITORING;
  if (input.workloadClass === WorkloadClass.INTERACTIVE_HIGH) return ReserveId.INTERACTIVE_MCP;
  return null;
}

export class ReserveRouter {
  route(input: ReserveRouteInput): ReserveIdType | null {
    return routeProtectedReserve(input);
  }
  isBroadScan(workloadClass: WorkloadClassType): boolean {
    return BROAD_SCAN.has(workloadClass);
  }
}
