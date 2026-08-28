/** Secret-free typed denial payload shaping for pipeline stage 23 (FR-COST-007). */
import { CostDenialRecordSchema, type CostDenialRecord } from '@foresift/shared-schemas';

const SECRET_PATTERN =
  /(bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|token|secret|private[_-]?key)\s*[:=]\s*\S+)/gi;

function safe(value: string): string {
  return value.replace(SECRET_PATTERN, '[REDACTED]').slice(0, 1_024);
}

export function shapeCostDenial(input: CostDenialRecord): CostDenialRecord {
  return CostDenialRecordSchema.parse({
    candidate: safe(input.candidate),
    caller: safe(input.caller),
    reason: safe(input.reason),
    alternative: safe(input.alternative),
  });
}

export interface CostDenialSink {
  write(record: CostDenialRecord): Promise<void>;
}

export class CostAudit {
  constructor(private readonly sink: CostDenialSink) {}

  async blocked(input: CostDenialRecord): Promise<CostDenialRecord> {
    const record = shapeCostDenial(input);
    await this.sink.write(record);
    return record;
  }
}
