import type { UtcTimestamp } from '@foresift/domain';

/** A projection of an already-persisted observation. No construction seam exists here. */
export interface PersistedTradeLeg {
  readonly legId: string;
  readonly observationId: string;
  readonly kind: 'SWAP' | 'TRANSFER' | 'AGGREGATOR_HOP';
  readonly chainId: string;
  readonly transactionHash: string;
  readonly economicTransactionId?: string;
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly assetId: string;
  readonly rawAmount: string;
  readonly poolId?: string;
  readonly routeIndex?: number;
  readonly signerAddress?: string;
  readonly initiatorAddress?: string;
  /** Equivalent launch/migrated-pool legs share this key and count once. */
  readonly migrationEquivalenceKey?: string;
}

export interface NormalizerOptions {
  readonly knownRouterAddresses?: ReadonlySet<string>;
  readonly actorByTransaction?: Readonly<Record<string, string>>;
  /** Maximum ranking contribution even when resolution is perfect. */
  readonly maximumContributionFactor?: number;
}

export interface DoubleCountGuardResult {
  readonly retained: readonly PersistedTradeLeg[];
  readonly blockedLegIds: readonly string[];
}
