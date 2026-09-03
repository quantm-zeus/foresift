import type { ActorResolutionState, TradeSide, UtcTimestamp } from '@foresift/domain';

export type EconomicLegKind = 'SWAP' | 'TRANSFER' | 'AGGREGATOR_HOP' | 'MIGRATION';

/** Read-only projection of an already-persisted swap/transfer observation. */
export interface PersistedEconomicLeg {
  readonly observationId: string;
  readonly routeLegId?: string;
  readonly chainId: string;
  readonly transactionHash: string;
  readonly legIndex: number;
  readonly kind: EconomicLegKind;
  readonly fromAccount?: string;
  readonly toAccount?: string;
  readonly poolAddress?: string;
  readonly tokenIn?: string;
  readonly amountIn?: string;
  readonly tokenOut?: string;
  readonly amountOut?: string;
  /** Transfer-shaped alternative to tokenIn/tokenOut. */
  readonly assetRepresentationId?: string;
  readonly amountRaw?: string;
  /** Marks a provider duplicate of another raw observation in this transaction. */
  readonly duplicateOfObservationId?: string;
  /** Migration maps the old representation to the new one without creating volume. */
  readonly migrationFromAssetId?: string;
  readonly migrationToAssetId?: string;
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly qualityCodes?: readonly string[];
}

export interface EconomicTradeContext {
  readonly actorEntityId?: string;
  readonly actorAccounts?: readonly string[];
  readonly knownRouterAccounts?: readonly string[];
  readonly targetAssetRepresentationId: string;
  readonly quoteAssetRepresentationIds?: readonly string[];
  readonly classificationConfidence?: number;
}

export interface NetActorDelta {
  readonly assetRepresentationId: string;
  readonly deltaRaw: string;
}

export interface AuditableEconomicRouteLeg {
  readonly routeLegId: string;
  readonly legIndex: number;
  readonly kind: EconomicLegKind;
  readonly fromAccount?: string;
  readonly toAccount?: string;
  readonly assetRepresentationIds: readonly string[];
  readonly rawObservationIds: readonly string[];
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly qualityCodes: readonly string[];
}

export interface NormalizedEconomicTradeEvent {
  readonly eventId: string;
  readonly chainId: string;
  readonly transactionHash: string;
  readonly actorEntityId?: string;
  readonly actorResolutionState: ActorResolutionState;
  readonly assetRepresentationId: string;
  readonly netAssetDeltaRaw: string;
  readonly side: TradeSide;
  readonly routeLegIds: readonly string[];
  readonly classificationConfidence: number;
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly qualityCodes: readonly string[];
  readonly netActorDeltas: readonly NetActorDelta[];
  readonly rawLegs: readonly AuditableEconomicRouteLeg[];
  readonly isOrganicDemand: boolean;
  readonly doubleCountPrevented: boolean;
}
