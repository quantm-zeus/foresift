import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import { AvailabilityProvenanceClass, utcTimestamp } from '@foresift/domain';
import { CollectorStreamRecordSchema, type CollectorStreamRecord } from '@foresift/shared-schemas';

export type StreamRecordInput = Omit<
  CollectorStreamRecord,
  'recordId' | 'receiptHash' | 'availableAt' | 'availabilityProvenance'
> & {
  readonly recordId?: string;
  readonly availableAt?: never;
  readonly availabilityProvenance?: never;
};
export function canonicalReceiptHash(record: Record<string, unknown>): string {
  return sha256Text(canonicalJson(record));
}
export function assembleCollectorStreamRecord(
  input: StreamRecordInput,
  availableAt: Date = new Date(),
): CollectorStreamRecord {
  const receivedMs = Date.parse(input.receivedAt);
  const availableMs = availableAt.getTime();
  if (!Number.isFinite(receivedMs) || availableMs < receivedMs)
    throw new Error('COLLECTOR_STREAM_COORDINATE_MISSING: availability precedes receipt');
  const unsigned = {
    ...input,
    recordId: input.recordId ?? randomUUID(),
    availableAt: utcTimestamp(availableAt.toISOString()),
    availabilityProvenance: AvailabilityProvenanceClass.FIRST_PARTY_LIVE_OBSERVED,
  };
  const receiptHash = canonicalReceiptHash(unsigned);
  return CollectorStreamRecordSchema.parse({ ...unsigned, receiptHash });
}
