import { CostDenialRecordSchema, type CostDenialRecord } from '@foresift/shared-schemas';

export type CostDenial = CostDenialRecord;

/** Shapes only the four public audit fields; surplus/secret fields are discarded. */
export function shapeCostDenial(input: CostDenialRecord): CostDenial {
  return CostDenialRecordSchema.parse({
    candidate: input.candidate,
    caller: input.caller,
    reason: input.reason,
    alternative: input.alternative,
  });
}

export const costDenial = shapeCostDenial;
