import { canonicalJson, sha256Text } from '@foresift/persistence';
import { AvailabilityProvenanceClass } from '@foresift/domain';
import { CollectorStreamRecordSchema, type CollectorStreamRecord } from '@foresift/shared-schemas';
export function canonicalReceiptHash(record: Record<string, unknown>): string {
  return sha256Text(canonicalJson(record));
}
export type AssembledCollectorStreamRecord = CollectorStreamRecord & {
  readonly receiptHash: string;
  readonly availabilityProvenance: typeof AvailabilityProvenanceClass.FIRST_PARTY_LIVE_OBSERVED;
};
export function assembleCollectorStreamRecord(input: unknown): AssembledCollectorStreamRecord {
  const record = CollectorStreamRecordSchema.parse(input);
  return {
    ...record,
    receiptHash: canonicalReceiptHash(record),
    availabilityProvenance: AvailabilityProvenanceClass.FIRST_PARTY_LIVE_OBSERVED,
  };
}
export function processStreamRecord(input: unknown): { valid: boolean; normalizedHash?: string } {
  const parsed = CollectorStreamRecordSchema.safeParse(input);
  return parsed.success
    ? { valid: true, normalizedHash: canonicalReceiptHash(parsed.data) }
    : { valid: false };
}
