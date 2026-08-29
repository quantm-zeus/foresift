import type { UtcTimestamp } from '@foresift/domain';

export type CollectorGapState =
  | 'OPEN'
  | 'BACKFILL_QUEUED'
  | 'BACKFILLING'
  | 'RESOLVED_COMPLETE'
  | 'RESOLVED_EMPTY_PROOF'
  | 'PARTIAL'
  | 'UNRESOLVED'
  | 'WAIVED_FOR_NARROW_SCOPE';

export interface CollectorGapFixture {
  readonly gapId: string;
  readonly partitionId: string;
  readonly startSlot: string;
  readonly endSlot: string;
  readonly state: CollectorGapState;
  readonly detectedAt: UtcTimestamp;
  readonly resolvedAt?: UtcTimestamp;
  readonly backfillMethod?: 'BOUNDED_INDEXER_RPC' | 'ARCHIVE_REPLAY';
  readonly emptyRangeProofSha256?: string;
  readonly waiverRef?: {
    readonly waiverId: string;
    readonly signedBy: string;
    readonly expiresAt: UtcTimestamp;
    readonly narrowScopeOnly: boolean;
  };
}

export const DETECTED_SLOT_GAP: CollectorGapFixture = {
  gapId: 'gap_slot_300100101_300100104',
  partitionId: 'part_solana_pump_0',
  startSlot: '300100101',
  endSlot: '300100104',
  state: 'OPEN',
  detectedAt: '2026-08-20T10:00:01.000Z' as UtcTimestamp,
};

export const BACKFILLED_SLOT_GAP: CollectorGapFixture = {
  ...DETECTED_SLOT_GAP,
  state: 'RESOLVED_COMPLETE',
  resolvedAt: '2026-08-20T10:00:03.000Z' as UtcTimestamp,
  backfillMethod: 'BOUNDED_INDEXER_RPC',
};

export const EMPTY_RANGE_PROOF_GAP: CollectorGapFixture = {
  gapId: 'gap_empty_range_300100201_300100205',
  partitionId: 'part_solana_pump_0',
  startSlot: '300100201',
  endSlot: '300100205',
  state: 'RESOLVED_EMPTY_PROOF',
  detectedAt: '2026-08-20T10:05:00.000Z' as UtcTimestamp,
  resolvedAt: '2026-08-20T10:05:02.000Z' as UtcTimestamp,
  emptyRangeProofSha256: 'sha256:verified_empty_range_proof_hash_001',
};

export const UNRESOLVED_SLOT_GAP: CollectorGapFixture = {
  gapId: 'gap_unresolved_001',
  partitionId: 'part_solana_pump_0',
  startSlot: '290000000',
  endSlot: '290000100',
  state: 'UNRESOLVED',
  detectedAt: '2026-08-19T00:00:00.000Z' as UtcTimestamp,
};

export const NARROW_SCOPE_WAIVED_GAP: CollectorGapFixture = {
  gapId: 'gap_waived_001',
  partitionId: 'part_solana_pump_0',
  startSlot: '295000000',
  endSlot: '295000050',
  state: 'WAIVED_FOR_NARROW_SCOPE',
  detectedAt: '2026-08-19T12:00:00.000Z' as UtcTimestamp,
  waiverRef: {
    waiverId: 'waiver_sec_20260819_01',
    signedBy: 'key_sec_admin_01',
    expiresAt: '2026-09-19T12:00:00Z' as UtcTimestamp,
    narrowScopeOnly: true,
  },
};
