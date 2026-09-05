/**
 * §64.3 `PoolMathAdapter` contract and the fail-closed resolution registry
 * (FR-EXEC-013, FR-EXEC-015).
 *
 * Resolution is keyed by chain, program, program version, curve type, and
 * account-layout version over the signed program-support manifests consumed
 * from `@foresift/program-decoders` (read-only; no decoder changes). An
 * unknown or mismatched design returns an explicit
 * `EXECUTION_UNAVAILABLE`/`POOL_MATH_UNSUPPORTED` state — never a generic
 * constant-product fallback (FR-EXEC-015, INV-015).
 */
import {
  AdapterFamily,
  AdapterSupportState,
  ExecErrorCode,
  ExecVocabularyError,
  adapterFamily,
} from '@foresift/domain';
import type { ProgramSupportManifest } from '@foresift/shared-schemas';

/** The raw on-chain account bundle a decoder produced (already read-only). */
export interface RawAccountStateBundle {
  readonly programId: string;
  readonly programVersion: string;
  readonly accountLayoutVersion: string;
  readonly slot: string;
  readonly accounts: readonly {
    readonly owner: string;
    readonly layoutFamily: string;
    readonly dataHash: string;
  };
}

/** Decoded, versioned pool state handed to adapters and completeness checks. */
export interface DecodedPoolState {
  readonly programId: string;
  readonly programVersion: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly reserves: Readonly<Record<string, string>>;
  readonly curveState: Readonly<Record<string, unknown>>;
  readonly feeConfiguration: Readonly<Record<string, unknown>>;
  readonly stateCompleteness: 'COMPLETE' | 'INCOMPLETE_BLOCKING';
}

/** §64.4 coverage assessment over decoded state. */
export interface CoverageAssessment {
  readonly stateCompleteness: 'COMPLETE' | 'INCOMPLETE_BLOCKING';
  readonly missingAccountFamilies: readonly string[];
  readonly materialToFill: boolean;
  readonly uncertaintyBound: number | null;
}

export interface QuoteExactInInput {
  readonly inTokenMint: string;
  readonly outTokenMint: string;
  readonly rawAmountIn: bigint;
  readonly poolState: DecodedPoolState;
}

export interface QuoteExactOutInput {
  readonly inTokenMint: string;
  readonly outTokenMint: string;
  readonly rawAmountOut: bigint;
  readonly poolState: DecodedPoolState;
}

export interface QuoteResult {
  readonly rawAmountIn: bigint;
  readonly rawAmountOut: bigint;
  readonly feeRawAmount: bigint;
  readonly priceImpactBps: number;
  readonly minimumOutputRaw: bigint | null;
}

export interface LiquidityMutationInput {
  readonly poolState: DecodedPoolState;
  readonly mutation: 'ADD' | 'REMOVE';
  readonly rawAmounts: Readonly<Record<string, bigint>>;
}

export interface AccountRequirement {
  readonly accountFamily: string;
  readonly required: boolean;
  readonly purpose: string;
}

/**
 * §64.3 adapter contract. Implementations are versioned and immutable;
 * `quoteExactIn`/`quoteExactOut` are pure functions of state.
 */
export interface PoolMathAdapter {
  readonly adapterId: string;
  readonly version: string;
  readonly chainId: string;
  readonly programId: string;
  readonly supportedProgramVersions: readonly string[];
  readonly curveTypes: readonly string[];
  readonly family: AdapterFamily;
  decodeState(input: RawAccountStateBundle): DecodedPoolState;
  validateStateCompleteness(state: DecodedPoolState): CoverageAssessment;
  quoteExactIn(input: QuoteExactInInput): QuoteResult;
  quoteExactOut(input: QuoteExactOutInput): QuoteResult;
  modelLiquidityMutation(input: LiquidityMutationInput): DecodedPoolState;
  requiredAccounts(input: { readonly programId: string }): readonly AccountRequirement[];
}

/** Explicit refusal instead of a guessed adapter (fail-closed). */
export type AdapterResolution =
  | {
      readonly resolved: true;
      readonly adapter: PoolMathAdapter;
      readonly manifest: ProgramSupportManifest;
    }
  | {
      readonly resolved: false;
      readonly executionStatus: 'EXECUTION_UNAVAILABLE' | 'POOL_MATH_UNSUPPORTED';
      readonly qualityCodes: readonly (
        | 'UNSUPPORTED_PROGRAM_VERSION'
        | 'EXECUTION_UNAVAILABLE'
        | 'POOL_MATH_UNSUPPORTED'
        | 'DEPRECATED_OPERATION'
      )[];
      readonly reason: string;
    };

/** Signed-manifest adapter binding: a manifest plus its one adapter. */
export interface AdapterBinding {
  readonly manifest: ProgramSupportManifest;
  readonly adapter: PoolMathAdapter;
  readonly supportState: AdapterSupportState;
}

export interface ResolveAdapterInput {
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly curveType: string;
  readonly accountLayoutVersion: string;
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed resolution registry (FR-EXEC-013). Bindings are derived from
 * signed program-support manifests; a manifest whose capability state is not
 * `ACTIVE`, whose layout hash does not match the query, or whose program
 * version is unsupported yields an explicit unsupported resolution — the
 * registry has no "closest match" behavior.
 */
export class PoolMathAdapterRegistry {
  private readonly bindings: readonly AdapterBinding[];

  constructor(bindings: readonly AdapterBinding[]) {
    for (const binding of bindings) {
      if (!isStringRecord(binding.manifest)) {
        throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, binding.manifest);
      }
      adapterFamily(binding.adapter.family);
    }
    this.bindings = bindings;
  }

  resolve(query: ResolveAdapterInput): AdapterResolution {
    for (const binding of this.bindings) {
      const m = binding.manifest;
      if (m.chainId !== query.chainId) continue;
      if (m.programId !== query.programId) continue;
      if (m.accountLayoutVersion !== query.accountLayoutVersion) continue;
      // Program version must be explicitly supported by the adapter.
      if (!binding.adapter.supportedProgramVersions.includes(query.programVersion)) {
        return {
          resolved: false,
          executionStatus: 'POOL_MATH_UNSUPPORTED',
          qualityCodes: ['UNSUPPORTED_PROGRAM_VERSION'],
          reason: `program version ${query.programVersion} is not supported by adapter ${binding.adapter.adapterId}@${binding.adapter.version}`,
        };
      }
      // The curve type must be one the adapter verified.
      if (!binding.adapter.curveTypes.includes(query.curveType)) {
        return {
          resolved: false,
          executionStatus: 'POOL_MATH_UNSUPPORTED',
          qualityCodes: ['POOL_MATH_UNSUPPORTED'],
          reason: `curve type ${query.curveType} is not verified for adapter ${binding.adapter.adapterId}@${binding.adapter.version}`,
        };
      }
      // Only ACTIVE manifests resolve to an executable adapter.
      if (m.capabilityState === 'RETIRED' || m.capabilityState === 'UNAVAILABLE') {
        return {
          resolved: false,
          executionStatus: 'EXECUTION_UNAVAILABLE',
          qualityCodes: ['DEPRECATED_OPERATION'],
          reason: `program support manifest ${m.manifestId} is ${m.capabilityState}`,
        };
      }
      if (m.capabilityState !== 'ACTIVE') {
        return {
          resolved: false,
          executionStatus: 'EXECUTION_UNAVAILABLE',
          qualityCodes: ['EXECUTION_UNAVAILABLE'],
          reason: `program support manifest ${m.manifestId} is ${m.capabilityState}; no confirmed adapter`,
        };
      }
      if (binding.supportState !== AdapterSupportState.AVAILABLE) {
        return {
          resolved: false,
          executionStatus: 'EXECUTION_UNAVAILABLE',
          qualityCodes: ['EXECUTION_UNAVAILABLE'],
          reason: `adapter ${binding.adapter.adapterId}@${binding.adapter.version} is ${binding.supportState}`,
        };
      }
      return { resolved: true, adapter: binding.adapter, manifest: m };
    }
    return {
      resolved: false,
      executionStatus: 'EXECUTION_UNAVAILABLE',
      qualityCodes: ['EXECUTION_UNAVAILABLE', 'UNSUPPORTED_PROGRAM_VERSION'],
      reason: `no signed program-support manifest matches chain=${query.chainId} program=${query.programId} layout=${query.accountLayoutVersion}`,
    };
  }
}
