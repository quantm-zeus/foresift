/** Secret-free denial shaping for pipeline stage 23 (FR-COST-007). */
import { CostDenialRecordSchema, type CostDenialRecord } from '@foresift/shared-schemas';

export interface CostDenialSink {
  write(record: CostDenialRecord): Promise<void>;
}

export function shapeCostDenial(input: CostDenialRecord): CostDenialRecord {
  // Explicit field selection prevents arguments, tokens, headers, or credentials
  // on an input object from leaking into the audit payload.
  return CostDenialRecordSchema.parse({
    candidate: input.candidate,
    caller: input.caller,
    reason: input.reason,
    alternative: input.alternative,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.operation === undefined ? {} : { operation: input.operation }),
    ...(input.blockedAt === undefined ? {} : { blockedAt: input.blockedAt }),
  });
}

export class CostAuditor {
  constructor(private readonly sink: CostDenialSink) {}
  async blocked(input: CostDenialRecord): Promise<CostDenialRecord> {
    const record = shapeCostDenial(input);
    await this.sink.write(record);
    return record;
  }
}
