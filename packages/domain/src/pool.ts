/**
 * Pool identity (FR-DATA-001, §11.2/§11.4): `pool_id` = chain + DEX + pool
 * address. All pools are retained; a provider's "best pair" never overwrites
 * others without evidence.
 */
import type { AssetId } from './asset.ts';
import type { ChainId } from './chain.ts';
import type { PoolId } from './asset.ts';

/** DEX identity within a chain. */
export interface DexIdentity {
  readonly chainId: ChainId;
  readonly dexId: string;
}

/** Canonical pool identity triple. */
export interface PoolKey {
  readonly chainId: ChainId;
  readonly dexId: string;
  readonly poolAddress: string;
}

export function composePoolId(key: PoolKey): PoolId {
  return `${key.chainId}/${key.dexId}/${key.poolAddress}` as PoolId;
}

/** A pair as observed on a specific pool (quote/base ordering is per-pool). */
export interface PairObservation {
  readonly poolId: PoolId;
  readonly baseAssetId: AssetId;
  readonly quoteAssetId: AssetId;
  /** True when quote/base orientation is provider-declared and unverified. */
  readonly orientationUnverified: boolean;
}
