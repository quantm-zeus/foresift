import {
  BudgetDimensionDenialRecordSchema,
  CostDenialRecordSchema,
  type BudgetDimensionDenialRecord,
  type CostDenialRecord,
} from '@foresift/shared-schemas';

export type CostDenial = CostDenialRecord;
export type BudgetDimensionDenial = BudgetDimensionDenialRecord;

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

/**
 * Shapes a budget-dimension denial (FR-COST-011 audit law): the refused
 * dimension and the full §62.12 rendered classes at refusal time travel with
 * the record so a denial can never be read as "zero total cost". Surplus and
 * secret fields are discarded exactly like the G0 cost denial.
 */
export function shapeBudgetDimensionDenial(input: BudgetDimensionDenialRecord): BudgetDimensionDenial {
  return BudgetDimensionDenialRecordSchema.parse({
    ...(input.denialId === undefined ? {} : { denialId: input.denialId }),
    dimension: input.dimension,
    candidate: input.candidate,
    caller: input.caller,
    reason: input.reason,
    alternative: input.alternative,
    renderedClasses: input.renderedClasses,
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
  });
}

export const budgetDimensionDenial = shapeBudgetDimensionDenial;
