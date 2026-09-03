/** Runtime contracts for §66 economic-trade normalization (FR-TRD-001/002). */
import { z } from 'zod';
import {
  ChainIdSchema,
  QualityCodesSchema,
  UtcTimestampSchema,
} from './data.ts';

/** Canonical signed decimal. Raw net deltas may be negative; exponent notation is forbidden. */
export const SignedDecimalStringSchema = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/, 'expected canonical signed decimal string')
  .refine((value) => !/^-0(?:\.0+)?$/.test(value), { message: 'negative zero is not canonical' });

export const EconomicTradeSideSchema = z.enum([
  'BUY',
  'SELL',
  'ROUND_TRIP',
  'INVENTORY_NEUTRAL',
  'UNKNOWN',
]);
export type EconomicTradeSide = z.infer<typeof EconomicTradeSideSchema>;

/** Whether infrastructure/token accounts could be attributed to one economic actor. */
export const ActorResolutionStateSchema = z.enum([
  'RESOLVED',
  'PARTIALLY_RESOLVED',
  'UNRESOLVED',
]);
export type ActorResolutionState = z.infer<typeof ActorResolutionStateSchema>;

/** Auditable raw swap/transfer/aggregator hop retained behind one economic event. */
export const EconomicRouteLegSchema = z
  .object({
    routeLegId: z.string().min(1),
    eventId: z.string().min(1),
    legIndex: z.number().int().nonnegative(),
    kind: z.enum(['SWAP', 'TRANSFER', 'AGGREGATOR_HOP', 'MIGRATION']),
    fromAccount: z.string().min(1).optional(),
    toAccount: z.string().min(1).optional(),
    assetRepresentationId: z.string().min(1),
    netAssetDeltaRaw: SignedDecimalStringSchema,
    rawObservationIds: z.array(z.string().min(1)).min(1),
    eventAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.availableAt) >= Date.parse(value.eventAt), {
    message: 'route leg cannot be available before its event time',
  });
export type EconomicRouteLeg = z.infer<typeof EconomicRouteLegSchema>;

/** §66.2 normalized economic event, counted once from the actor's net deltas. */
export const EconomicTradeEventSchema = z
  .object({
    eventId: z.string().min(1),
    chainId: ChainIdSchema,
    transactionHash: z.string().min(1),
    actorEntityId: z.string().min(1).optional(),
    actorResolutionState: ActorResolutionStateSchema,
    assetRepresentationId: z.string().min(1),
    netAssetDeltaRaw: SignedDecimalStringSchema,
    netQuoteDeltaUsd: SignedDecimalStringSchema.optional(),
    side: EconomicTradeSideSchema,
    routeLegIds: z.array(z.string().min(1)).min(1),
    classificationConfidence: z.number().finite().min(0).max(1),
    eventAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.actorResolutionState !== 'RESOLVED' || value.actorEntityId !== undefined,
    { message: 'resolved actor state requires actorEntityId' },
  )
  .refine((value) => Date.parse(value.availableAt) >= Date.parse(value.eventAt), {
    message: 'economic event cannot be available before its event time',
  });
export type EconomicTradeEvent = z.infer<typeof EconomicTradeEventSchema>;

export const TRADE_SCHEMAS = {
  EconomicTradeEvent: EconomicTradeEventSchema,
  EconomicRouteLeg: EconomicRouteLegSchema,
} as const;

export function parseTradeSchema<T extends keyof typeof TRADE_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof TRADE_SCHEMAS)[T]> {
  return TRADE_SCHEMAS[name].parse(payload) as z.infer<(typeof TRADE_SCHEMAS)[T]>;
}

