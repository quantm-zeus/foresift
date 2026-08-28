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

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, '[REDACTED]')
    .replace(/\b(?:sk_live|secret_key|api[_-]?key)[_=:-]?[A-Za-z0-9_-]+/gi, '[REDACTED]');
}

export function formatCostDenial(
  input: CostDenialRecord & { readonly context?: unknown },
): CostDenialRecord {
  return shapeCostDenial({
    ...input,
    candidate: redact(input.candidate),
    caller: redact(input.caller),
    reason: redact(input.reason),
    alternative: redact(input.alternative),
    ...(input.provider === undefined ? {} : { provider: redact(input.provider) }),
    ...(input.operation === undefined ? {} : { operation: redact(input.operation) }),
  });
}

export function validateDenialPayload(payload: unknown): true {
  CostDenialRecordSchema.parse(payload);
  return true;
}
