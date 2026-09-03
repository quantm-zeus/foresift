/** Runtime contracts for §65.6 supply confidence and market-cap basis (FR-SUP-001/002). */
import { z } from 'zod';
import { DigitStringSchema, QualityCodesSchema, UtcTimestampSchema } from './data.ts';

export const MarketCapBasisSchema = z.enum([
  'TOTAL_SUPPLY',
  'PROVIDER_CIRCULATING_SUPPLY',
  'ESTIMATED_CIRCULATING_SUPPLY',
]);
export type MarketCapBasis = z.infer<typeof MarketCapBasisSchema>;

/** §65.6 supply record. Amounts remain raw non-negative integer strings. */
export const SupplyAssessmentSchema = z
  .object({
    assetRepresentationId: z.string().min(1),
    asOf: UtcTimestampSchema,
    totalSupplyRaw: DigitStringSchema,
    estimatedCirculatingSupplyRaw: DigitStringSchema.optional(),
    excludedSupplyRaw: DigitStringSchema.optional(),
    source: z.string().min(1),
    method: z.string().min(1),
    confidence: z.number().finite().min(0).max(1),
    exclusionEvidenceIds: z.array(z.string().min(1)),
    qualityCodes: QualityCodesSchema,
    marketCapBasis: MarketCapBasisSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.excludedSupplyRaw === undefined ||
      BigInt(value.excludedSupplyRaw) <= BigInt(value.totalSupplyRaw),
    { message: 'excluded supply cannot exceed total supply' },
  )
  .refine(
    (value) =>
      value.estimatedCirculatingSupplyRaw === undefined ||
      BigInt(value.estimatedCirculatingSupplyRaw) <= BigInt(value.totalSupplyRaw),
    { message: 'estimated circulating supply cannot exceed total supply' },
  )
  .refine(
    (value) =>
      value.excludedSupplyRaw === undefined || value.exclusionEvidenceIds.length > 0,
    { message: 'excluded supply requires exclusion evidence' },
  )
  .refine(
    (value) =>
      value.marketCapBasis !== 'ESTIMATED_CIRCULATING_SUPPLY' ||
      value.estimatedCirculatingSupplyRaw !== undefined,
    { message: 'estimated circulating market-cap basis requires an estimate' },
  );
export type SupplyAssessment = z.infer<typeof SupplyAssessmentSchema>;

export const SUPPLY_SCHEMAS = { SupplyAssessment: SupplyAssessmentSchema } as const;

export function parseSupplySchema<T extends keyof typeof SUPPLY_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof SUPPLY_SCHEMAS)[T]> {
  return SUPPLY_SCHEMAS[name].parse(payload) as z.infer<(typeof SUPPLY_SCHEMAS)[T]>;
}

