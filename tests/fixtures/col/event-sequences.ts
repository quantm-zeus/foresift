import type { CollectorStreamRecordFixture } from './stream-records.ts';
import { STREAM_RECORD_PUMP_BUY } from './stream-records.ts';
import type { UtcTimestamp } from '@foresift/domain';

export interface EventSequenceFixture {
  readonly sequenceId: string;
  readonly description: string;
  readonly initialRecords: readonly CollectorStreamRecordFixture[];
  readonly subsequentRecords: readonly CollectorStreamRecordFixture[];
  readonly expectedCanonicalCount: number;
  readonly expectedRevisionsCount: number;
}

export const REORG_EVENT_SEQUENCE: EventSequenceFixture = {
  sequenceId: 'seq_reorg_001',
  description:
    'Two competing blocks at slot 300100200; chain tip reorganizes and emits compensating revision',
  initialRecords: [
    {
      ...STREAM_RECORD_PUMP_BUY,
      recordId: 'rec_fork_a_001',
      blockHash: 'BlockHashForkA11111111111111111111111111111',
      finality: 'confirmed',
    },
  ],
  subsequentRecords: [
    {
      ...STREAM_RECORD_PUMP_BUY,
      recordId: 'rec_fork_b_canonical_002',
      blockHash: 'BlockHashForkBCanonical22222222222222222222222',
      finality: 'finalized',
      availableAt: '2026-08-20T10:00:02.000Z' as UtcTimestamp,
    },
  ],
  expectedCanonicalCount: 1,
  expectedRevisionsCount: 2,
};

export const DUPLICATE_EVENT_SEQUENCE: EventSequenceFixture = {
  sequenceId: 'seq_dup_001',
  description: 'Identical stream record re-received across websocket reconnect',
  initialRecords: [STREAM_RECORD_PUMP_BUY],
  subsequentRecords: [
    {
      ...STREAM_RECORD_PUMP_BUY,
      recordId: 'rec_pump_001_dup',
      receivedAt: '2026-08-20T10:00:05.000Z' as UtcTimestamp,
      availableAt: '2026-08-20T10:00:05.005Z' as UtcTimestamp,
    },
  ],
  expectedCanonicalCount: 1,
  expectedRevisionsCount: 1,
};

export const OUT_OF_ORDER_EVENT_SEQUENCE: EventSequenceFixture = {
  sequenceId: 'seq_ooo_001',
  description: 'Records received out of slot sequence order [100, 105, 102, 101]',
  initialRecords: [
    { ...STREAM_RECORD_PUMP_BUY, slot: '300100100', recordId: 'rec_slot_100' },
    { ...STREAM_RECORD_PUMP_BUY, slot: '300100105', recordId: 'rec_slot_105' },
  ],
  subsequentRecords: [
    { ...STREAM_RECORD_PUMP_BUY, slot: '300100102', recordId: 'rec_slot_102' },
    { ...STREAM_RECORD_PUMP_BUY, slot: '300100101', recordId: 'rec_slot_101' },
  ],
  expectedCanonicalCount: 4,
  expectedRevisionsCount: 4,
};
