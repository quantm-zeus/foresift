/**
 * Canonical asset identity and verified-equivalence grouping (FR-DATA-001,
 * §11.2, §11.3; AC-022/023 substrate).
 *
 * Identity rule: `(chain_id, canonical_contract_address)` identifies an asset
 * REPRESENTATION. An `asset_id` groups representations ONLY when equivalence
 * is verified. Symbols/names never participate in identity.
 */
import type { ChainId } from './chain.ts';
import { ErrorCode, ForesiftError } from './errors.ts';

declare const brand: unique symbol;

/** Stable opaque identifier minted by the persistence layer. */
export type AssetId = string & { readonly [brand]: 'AssetId' };
export type PoolId = string & { readonly [brand]: 'PoolId' };

/** A representation: one canonical address on one chain. */
export interface AssetRepresentation {
  readonly chainId: ChainId;
  /** Chain-specific canonical address (lowercase hex for EVM, validated base58 for Solana). */
  readonly canonicalAddress: string;
  readonly decimalsState: DecimalsResolutionState;
}

/**
 * Token-decimals lifecycle state (§11.2 "sourced, cross-checked, versioned";
 * §11.8 uncertain decimals produce an explicit quality state — never a guess).
 */
export const DecimalsResolutionState = {
  /** At least one source observation exists; not yet cross-checked. */
  SOURCED: 'SOURCED',
  /** Two or more independent sources agree at the latest observed version. */
  CROSS_CHECKED: 'CROSS_CHECKED',
  /** Independent sources disagree; the value is explicitly unusable. */
  CONFLICTING: 'CONFLICTING',
} as const;

export type DecimalsResolutionState =
  (typeof DecimalsResolutionState)[keyof typeof DecimalsResolutionState];

/** Verified-equivalence membership edge between a representation and an asset. */
export interface AssetRepresentationMembership {
  readonly assetId: AssetId;
  readonly chainId: ChainId;
  readonly canonicalAddress: string;
  /** How equivalence was verified; heuristic merges are refused upstream. */
  readonly verification: VerifiedEquivalence;
}

export const VerifiedEquivalence = {
  /** Same underlying token observed across a native bridge with matching locks/mints. */
  BRIDGE_VERIFIED: 'BRIDGE_VERIFIED',
  /** Canonical wrapped-native mapping declared by the chain itself. */
  NATIVE_WRAPPER_DECLARED: 'NATIVE_WRAPPER_DECLARED',
  /** Issuer-attested equivalence backed by verifiable issuer metadata. */
  ISSUER_ATTESTED: 'ISSUER_ATTESTED',
} as const;

export type VerifiedEquivalence = (typeof VerifiedEquivalence)[keyof typeof VerifiedEquivalence];

/** Refuse unverified equivalences before they can enter an asset grouping. */
export function assertVerifiedEquivalence(
  verification: string,
): asserts verification is VerifiedEquivalence {
  if (!Object.values<string>(VerifiedEquivalence).includes(verification)) {
    throw new ForesiftError(
      ErrorCode.IDENTITY_EQUIVALENCE_UNVERIFIED,
      'equivalence claim is not a registered verification kind',
      { verification },
    );
  }
}
