/**
 * CAIP-2-compatible canonical chain identifiers with mapping-quality state
 * (FR-DATA-001, §11.5).
 *
 * Where a registered CAIP namespace exists the CAIP-2 form is canonical;
 * otherwise a versioned internal identifier is used and an explicit
 * mapping-quality state is retained. Unknown namespaces fail closed.
 */
import { ErrorCode, ForesiftError } from './errors.ts';

declare const brand: unique symbol;

/** A validated CAIP-2-compatible chain id: `<namespace>:<reference>`. */
export type ChainId = string & { readonly [brand]: 'ChainId' };

const CAIP2_PATTERN = /^[-a-z0-9]{3,8}:[-a-zA-Z0-9_]{1,64}$/;

/** Well-known namespaces this substrate understands natively. */
export const ChainNamespace = {
  EIP155: 'eip155',
  SOLANA: 'solana',
  BIP122: 'bip122',
} as const;

export type ChainNamespace = (typeof ChainNamespace)[keyof typeof ChainNamespace];

/**
 * Mapping quality of a chain identifier (§11.5: registered namespace vs
 * versioned internal identifier with explicit state).
 */
export const ChainMappingQuality = {
  /** Registered CAIP-2 namespace; reference is the canonical registry value. */
  REGISTERED_CAIP2: 'REGISTERED_CAIP2',
  /** EIP-155 network id known to be canonical for this deployment. */
  REGISTERED_EIP155_REFERENCE: 'REGISTERED_EIP155_REFERENCE',
  /**
   * No registered namespace exists; identity is a versioned internal
   * identifier whose mapping must never be silently reinterpreted.
   */
  INTERNAL_VERSIONED: 'INTERNAL_VERSIONED',
  /** Mapping asserted by exactly one source and not yet cross-checked. */
  UNVERIFIED_ASSERTION: 'UNVERIFIED_ASSERTION',
} as const;

export type ChainMappingQuality = (typeof ChainMappingQuality)[keyof typeof ChainMappingQuality];

/** Canonical chain record. */
export interface ChainIdentity {
  readonly chainId: ChainId;
  readonly namespace: string;
  readonly reference: string;
  readonly mappingQuality: ChainMappingQuality;
  /** Version of the internal identifier scheme when `INTERNAL_VERSIONED`. */
  readonly internalIdVersion?: number;
}

export function parseChainId(value: string): ChainId {
  if (!CAIP2_PATTERN.test(value)) {
    throw new ForesiftError(
      ErrorCode.IDENTITY_CHAIN_ID_INVALID,
      'not a CAIP-2-compatible chain id',
      {
        value,
      },
    );
  }
  return value as ChainId;
}

export function isChainId(value: unknown): value is ChainId {
  return typeof value === 'string' && CAIP2_PATTERN.test(value);
}

export function chainNamespaceOf(chainId: ChainId): string {
  const idx = chainId.indexOf(':');
  return idx === -1 ? '' : chainId.slice(0, idx);
}

export function chainReferenceOf(chainId: ChainId): string {
  const idx = chainId.indexOf(':');
  return idx === -1 ? '' : chainId.slice(idx + 1);
}

/** Build a chain identity, deriving its default mapping quality from the namespace. */
export function chainIdentity(input: {
  chainId: string;
  internalIdVersion?: number;
}): ChainIdentity {
  const chainId = parseChainId(input.chainId);
  const namespace = chainNamespaceOf(chainId);
  let mappingQuality: ChainMappingQuality = ChainMappingQuality.UNVERIFIED_ASSERTION;
  if (Object.values<string>(ChainNamespace).includes(namespace)) {
    mappingQuality =
      namespace === ChainNamespace.EIP155
        ? ChainMappingQuality.REGISTERED_EIP155_REFERENCE
        : ChainMappingQuality.REGISTERED_CAIP2;
  } else if (input.internalIdVersion !== undefined) {
    mappingQuality = ChainMappingQuality.INTERNAL_VERSIONED;
  }
  const identity: {
    chainId: ChainId;
    namespace: string;
    reference: string;
    mappingQuality: ChainMappingQuality;
    internalIdVersion?: number;
  } = {
    chainId,
    namespace,
    reference: chainReferenceOf(chainId),
    mappingQuality,
  };
  if (input.internalIdVersion !== undefined) {
    identity.internalIdVersion = input.internalIdVersion;
  }
  if (
    mappingQuality === ChainMappingQuality.INTERNAL_VERSIONED &&
    input.internalIdVersion === undefined
  ) {
    throw new ForesiftError(
      ErrorCode.IDENTITY_CHAIN_ID_INVALID,
      'internal identifiers require an explicit id version',
      { chainId },
    );
  }
  return Object.freeze(identity);
}

/** CAIP-10-compatible account id: `<chainId>:<accountAddress>`. */
export type Caip10AccountId = string & { readonly [brand]: 'Caip10AccountId' };

export function caip10(chainId: ChainId, accountAddress: string): Caip10AccountId {
  // The address part is opaque here beyond forbidding the separator; chain-
  // specific validation/normalization lives in address.ts.
  if (accountAddress.includes(':') || accountAddress.length === 0) {
    throw new ForesiftError(
      ErrorCode.IDENTITY_ADDRESS_INVALID,
      'address cannot form a CAIP-10 id',
      {
        chainId,
        accountAddress,
      },
    );
  }
  return `${chainId}:${accountAddress}` as Caip10AccountId;
}
