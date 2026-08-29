import { randomUUID } from 'node:crypto';
import {
  assertNoBackdating,
  recordBackfillReceipt,
  type DatabaseEngine,
} from '@foresift/persistence';
import type { UtcTimestamp } from '@foresift/domain';
import type { RetrievalClock } from './retrieval-clock.ts';
export interface BackfillCostAdmission {
  admit(input: {
    provider: string;
    operation: string;
    workloadClass: 'COLLECTOR_BACKFILL';
    reserveId: null | 'EMERGENCY_BACKFILL';
    units: number;
  }): Promise<{ allowed: boolean; reason: string }>;
}
export interface BackfillDeclaration {
  readonly provider: string;
  readonly operation: string;
  readonly maximumRange: number;
  readonly maximumJobs: number;
  readonly estimatedUnitsPerJob: number;
  readonly emergencyReserveEligible: boolean;
}
export interface GapForBackfill {
  readonly gapId: string;
  readonly start: number;
  readonly end: number;
  readonly eligibleForEmergency: boolean;
}
export interface BackfillJob {
  readonly jobId: string;
  readonly gapId: string;
  readonly start: number;
  readonly end: number;
  readonly reserveId: null | 'EMERGENCY_BACKFILL';
}
export class BackfillPlanner {
  constructor(
    private readonly declaration: BackfillDeclaration,
    private readonly cost: BackfillCostAdmission,
    private readonly clock: RetrievalClock,
  ) {}
  async plan(gaps: readonly GapForBackfill[]): Promise<readonly BackfillJob[]> {
    const jobs: BackfillJob[] = [];
    for (const gap of gaps) {
      for (
        let start = gap.start;
        start <= gap.end && jobs.length < this.declaration.maximumJobs;
        start += this.declaration.maximumRange
      ) {
        const end = Math.min(gap.end, start + this.declaration.maximumRange - 1);
        const reserveId =
          gap.eligibleForEmergency && this.declaration.emergencyReserveEligible
            ? 'EMERGENCY_BACKFILL'
            : null;
        const admission = await this.cost.admit({
          provider: this.declaration.provider,
          operation: this.declaration.operation,
          workloadClass: 'COLLECTOR_BACKFILL',
          reserveId,
          units: this.declaration.estimatedUnitsPerJob,
        });
        if (!admission.allowed) throw new Error(`COST_OR_QUOTA_BLOCKED:${admission.reason}`);
        jobs.push({ jobId: randomUUID(), gapId: gap.gapId, start, end, reserveId });
      }
    }
    return jobs;
  }
  retrievalTime(): UtcTimestamp {
    return this.clock.now();
  }
}
export async function persistRecoveredEvent(
  engine: DatabaseEngine,
  input: {
    receiptId: string;
    jobId: string;
    eventAt: UtcTimestamp;
    retrievedAt: UtcTimestamp;
    availableAt?: UtcTimestamp;
    liveReceiptRef?: string;
  },
): Promise<void> {
  const availableAt = input.availableAt ?? input.retrievedAt;
  const proofMethod = input.liveReceiptRef ? 'LIVE_RECEIPT_REFERENCE' : 'RECOVERY_FETCH_COMMIT';
  assertNoBackdating({
    availableAt,
    retrievedAt: input.retrievedAt,
    proofMethod,
    ...(input.liveReceiptRef ? { liveReceiptRef: input.liveReceiptRef } : {}),
  });
  await recordBackfillReceipt(engine, {
    backfillReceiptId: input.receiptId,
    backfillJobId: input.jobId,
    backfillReason: 'COLLECTOR_GAP_RECOVERY',
    historicalEventAt: input.eventAt,
    retrievedAt: input.retrievedAt,
    availableAt,
    retrospectiveOnly: false,
    wouldHaveBeenObservableLive: null,
    proofMethod,
    ...(input.liveReceiptRef ? { liveReceiptRef: input.liveReceiptRef } : {}),
  });
}
export function coverageDowngrade(
  status: 'RESOLVED_COMPLETE' | 'RESOLVED_EMPTY_PROOF' | 'PARTIAL' | 'UNRESOLVED',
): { coverage: 'COMPLETE' | 'PARTIAL' | 'UNRESOLVED'; populationClaimsAllowed: boolean } {
  return status === 'RESOLVED_COMPLETE' || status === 'RESOLVED_EMPTY_PROOF'
    ? { coverage: 'COMPLETE', populationClaimsAllowed: true }
    : status === 'PARTIAL'
      ? { coverage: 'PARTIAL', populationClaimsAllowed: false }
      : { coverage: 'UNRESOLVED', populationClaimsAllowed: false };
}
