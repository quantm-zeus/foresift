/** Economic-trade truth shared by normalization and downstream features. */
import type { QualityCode } from './quality.ts';
import type { UtcTimestamp } from './timestamps.ts';

export const ActorResolutionState = {
  RESOLVED: 'RESOLVED',
  ROUTER_RESOLVED: 'ROUTER_RESOLVED',
  PARTIALLY_RESOLVED: 'PARTIALLY_RESOLVED',
  UNRESOLVED: 'UNRESOLVED',
} as const;
export type ActorResolutionState =
  (typeof ActorResolutionState)[keyof typeof ActorResolutionState];

export const EconomicTradeClassification = {
  ORGANIC_DEMAND: 'ORGANIC_DEMAND',
  SAME_TRANSACTION_ROUND_TRIP: 'SAME_TRANSACTION_ROUND_TRIP',
  ARBITRAGE: 'ARBITRAGE',
  INVENTORY_NEUTRAL: 'INVENTORY_NEUTRAL',
} as const;
export type EconomicTradeClassification =
  (typeof EconomicTradeClassification)[keyof typeof EconomicTradeClassification];

export interface ActorResolution {
  readonly state: ActorResolutionState;
  readonly actorAddress: string | null;
  readonly routerAddresses: readonly string[];
  readonly confidence: number;
  readonly method: string;
}

export interface NetActorDelta {
  readonly assetId: string;
  /** Signed integer raw units; positive means the actor received inventory. */
  readonly rawAmount: string;
}

export interface RawEconomicLegAudit {
  readonly legId: string;
  readonly observationId: string;
  readonly kind: 'SWAP' | 'TRANSFER' | 'AGGREGATOR_HOP';
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly assetId: string;
  readonly rawAmount: string;
  readonly poolId?: string;
  readonly routeIndex?: number;
  readonly migrationEquivalenceKey?: string;
}

export interface EconomicTradeEvent {
  readonly eventId: `sha256:${string}`;
  readonly economicTransactionId: string;
  readonly chainId: string;
  readonly transactionHash: string;
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly actorResolution: ActorResolution;
  readonly actorResolutionState: ActorResolutionState;
  readonly netActorDeltas: readonly NetActorDelta[];
  readonly classification: EconomicTradeClassification;
  readonly rawLegs: readonly RawEconomicLegAudit[];
  readonly blockedDuplicateLegIds: readonly string[];
  readonly qualityCodes: readonly QualityCode[];
  readonly actorUncertaintyFactor: number;
  readonly cappedContributionFactor: number;
}
