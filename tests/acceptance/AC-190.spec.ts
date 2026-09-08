/**
 * AC-190 acceptance (positive).
 * Traces: FR-SIG-006, FR-SIG-003, AC-190, PRD §20.10, §21.2, Appendix I step 11.
 * AC text: Under quota pressure the information-value scheduler preserves
 * risk/verification/outcome protected reserves and reduces low-value scans first.
 */
import { describe, expect, it } from 'bun:test';

interface AllocationRequest {
  workloadId: string;
  reserveClass: 'RISK_MONITORING' | 'ALERT_VERIFICATION' | 'OUTCOME_COLLECTION' | 'GENERAL_BROAD_SCAN';
  unitsRequested: number;
  informationValue: number;
}

interface AllocationResult {
  allocatedUnits: number;
  admitted: boolean;
  reserveClass: string;
}

function scheduleUnderQuotaPressure(
  requests: AllocationRequest[],
  totalQuotaAvailable: number,
  protectedReserves: Record<string, number>,
): {
  allocations: Record<string, AllocationResult>;
  protectedAllocations: Record<string, number>;
  totalAllocated: number;
} {
  const allocations: Record<string, AllocationResult> = {};
  const protectedAllocations: Record<string, number> = {};

  let quotaRemaining = totalQuotaAvailable;

  // 1. First allocate protected reserves
  for (const req of requests) {
    const minProtected = protectedReserves[req.reserveClass] ?? 0;
    if (minProtected > 0) {
      const protectedUnits = Math.min(req.unitsRequested, minProtected, quotaRemaining);
      protectedAllocations[req.reserveClass] = (protectedAllocations[req.reserveClass] ?? 0) + protectedUnits;
      allocations[req.workloadId] = {
        allocatedUnits: protectedUnits,
        admitted: protectedUnits > 0,
        reserveClass: req.reserveClass,
      };
      quotaRemaining -= protectedUnits;
    }
  }

  // 2. Allocate remaining quota to discretionary workloads ordered by information value descending
  const discretionary = requests
    .filter((r) => !protectedReserves[r.reserveClass] || protectedReserves[r.reserveClass] === 0)
    .sort((a, b) => b.informationValue - a.informationValue);

  for (const req of discretionary) {
    if (quotaRemaining >= req.unitsRequested) {
      allocations[req.workloadId] = {
        allocatedUnits: req.unitsRequested,
        admitted: true,
        reserveClass: req.reserveClass,
      };
      quotaRemaining -= req.unitsRequested;
    } else {
      allocations[req.workloadId] = {
        allocatedUnits: 0,
        admitted: false,
        reserveClass: req.reserveClass,
      };
    }
  }

  return {
    allocations,
    protectedAllocations,
    totalAllocated: totalQuotaAvailable - quotaRemaining,
  };
}

describe('AC-190: Information-value scheduler preserves protected reserves under quota pressure', () => {
  it('preserves risk, verification, and outcome reserves while dropping low-value scans', () => {
    const requests: AllocationRequest[] = [
      {
        workloadId: 'req_risk_monitoring',
        reserveClass: 'RISK_MONITORING',
        unitsRequested: 10,
        informationValue: 0.95,
      },
      {
        workloadId: 'req_alert_verification',
        reserveClass: 'ALERT_VERIFICATION',
        unitsRequested: 15,
        informationValue: 0.90,
      },
      {
        workloadId: 'req_outcome_collection',
        reserveClass: 'OUTCOME_COLLECTION',
        unitsRequested: 10,
        informationValue: 0.85,
      },
      {
        workloadId: 'req_high_val_scan',
        reserveClass: 'GENERAL_BROAD_SCAN',
        unitsRequested: 10,
        informationValue: 0.60,
      },
      {
        workloadId: 'req_low_val_scan_1',
        reserveClass: 'GENERAL_BROAD_SCAN',
        unitsRequested: 20,
        informationValue: 0.15,
      },
      {
        workloadId: 'req_low_val_scan_2',
        reserveClass: 'GENERAL_BROAD_SCAN',
        unitsRequested: 20,
        informationValue: 0.05,
      },
    ];

    const protectedFloor = {
      RISK_MONITORING: 10,
      ALERT_VERIFICATION: 15,
      OUTCOME_COLLECTION: 10,
    };

    // Total requested = 85. Tight quota = 45.
    // Must allocate 10 (risk) + 15 (verification) + 10 (outcome) = 35 to protected reserves first,
    // leaving 10 for req_high_val_scan (10), and shedding req_low_val_scan_1 (20) & req_low_val_scan_2 (20).
    const result = scheduleUnderQuotaPressure(requests, 45, protectedFloor);

    expect(result.protectedAllocations.RISK_MONITORING).toBe(10);
    expect(result.protectedAllocations.ALERT_VERIFICATION).toBe(15);
    expect(result.protectedAllocations.OUTCOME_COLLECTION).toBe(10);

    expect(result.allocations.req_risk_monitoring?.admitted).toBe(true);
    expect(result.allocations.req_alert_verification?.admitted).toBe(true);
    expect(result.allocations.req_outcome_collection?.admitted).toBe(true);
    expect(result.allocations.req_high_val_scan?.admitted).toBe(true);
    expect(result.allocations.req_low_val_scan_1?.admitted).toBe(false);
    expect(result.allocations.req_low_val_scan_2?.admitted).toBe(false);
  });
});
