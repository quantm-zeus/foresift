/** Protected-reserve routing with broad-scan non-invasion (FR-COST-003/004). */
import { ReserveId, WorkloadClass, type ReserveId as ReserveIdValue } from '@foresift/domain';
import type { CostDeclaration } from './cost-declaration.ts';

export type ReservePurpose =
  'RISK_MONITORING' | 'ALERT_VERIFICATION' | 'INTERACTIVE_MCP' | 'EMERGENCY_BACKFILL';

export interface ReserveRouteInput {
  readonly workloadClass: WorkloadClass;
  readonly operation: CostDeclaration | { readonly protectedReserveEligible: boolean };
  readonly purpose?: ReservePurpose;
  readonly generalPoolExhausted?: boolean;
  readonly breadthDegraded?: boolean;
  readonly depthDegraded?: boolean;
}

export interface ReserveRouteDecision {
  readonly reserveId: ReserveIdValue | null;
  readonly reason: string;
  readonly degradationRequired: boolean;
}

export const BROAD_SCAN_WORKLOADS: readonly WorkloadClass[] = [
  WorkloadClass.BACKFILL_LOW,
  WorkloadClass.EVALUATION_LOW,
  WorkloadClass.SCHEDULED_NORMAL,
];

export class ReserveRouter {
  decide(input: ReserveRouteInput): ReserveRouteDecision {
    if (!input.operation.protectedReserveEligible) {
      return {
        reserveId: null,
        reason: 'OPERATION_NOT_RESERVE_ELIGIBLE',
        degradationRequired: false,
      };
    }
    if (BROAD_SCAN_WORKLOADS.includes(input.workloadClass)) {
      const degradationRequired =
        input.generalPoolExhausted === true &&
        !(input.breadthDegraded === true && input.depthDegraded === true);
      return {
        reserveId: null,
        reason: degradationRequired ? 'DEGRADE_BREADTH_THEN_DEPTH' : 'BROAD_SCAN_RESERVE_REFUSED',
        degradationRequired,
      };
    }
    if (input.workloadClass === WorkloadClass.RISK_MONITOR_HIGH) {
      return {
        reserveId: ReserveId.RISK_MONITORING,
        reason: 'RISK_MONITORING',
        degradationRequired: false,
      };
    }
    if (input.workloadClass === WorkloadClass.INTERACTIVE_HIGH) {
      if (input.purpose === 'ALERT_VERIFICATION') {
        return {
          reserveId: ReserveId.ALERT_VERIFICATION,
          reason: 'ALERT_VERIFICATION',
          degradationRequired: false,
        };
      }
      if (input.purpose === 'EMERGENCY_BACKFILL') {
        return {
          reserveId: ReserveId.EMERGENCY_BACKFILL,
          reason: 'EMERGENCY_BACKFILL',
          degradationRequired: false,
        };
      }
      return {
        reserveId: ReserveId.INTERACTIVE_MCP,
        reason: 'INTERACTIVE_MCP',
        degradationRequired: false,
      };
    }
    return { reserveId: null, reason: 'NO_PROTECTED_ROUTE', degradationRequired: false };
  }

  route(input: ReserveRouteInput): ReserveIdValue | null {
    return this.decide(input).reserveId;
  }
}

export { ReserveRouter as ProtectedReserveRouter };
