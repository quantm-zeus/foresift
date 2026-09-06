/**
 * §64.9 versioned `TransferSemanticsAdapter` — the transfer-side counterpart
 * of the pool-math adapter plane. Keyed by chain/program/program-version/
 * layout-version, it consumes the PROVEN `@foresift/solana-security` verdict
 * substrate read-only (verdicts are never restated) and produces the cost
 * model the execution simulator composes into net return. Unknown required
 * semantics → `INSUFFICIENT_DATA` (§64.9); zero cost is never assumed.
 *
 * Traces: FR-EXEC-003, FR-EXEC-013, FR-EXEC-018, AC-121, AC-233.
 */
import {
  AdapterSupportState,
  ExecErrorCode,
  ExecVocabularyError,
  ExecutionStatus,
  TransferSemanticsSupport,
} from '@foresift/domain';
import type { TokenExtensionSupport } from '@foresift/shared-schemas';
import {
  blocksCompleteExecutionModeling,
  evaluateTransferSemantics,
  type TransferSemanticsPolicy,
} from '@foresift/solana-security';
import type { AccountCreationCost, FeeModelResult, TransferFeeConfiguration } from './fee-model.ts';
import { applyOutTransferFee, composeTransferCosts } from './fee-model.ts';

export { applyOutTransferFee, composeTransferCosts } from './fee-model.ts';
export type {
  AccountCreationCost,
  CostComponent,
  FeeModelInput,
  FeeModelResult,
  TransferFeeConfiguration,
} from './fee-model.ts';
export { transferFeeOn } from './fee-model.ts';

/** Why an adapter resolution refused or degraded. */
export type TransferResolutionRefusal =
  | 'UNSUPPORTED_PROGRAM_VERSION'
  | 'UNSUPPORTED_PROGRAM'
  | 'DEPRECATED_OPERATION'
  | 'VERDICT_POLICY_UNAVAILABLE';

/** Successful binding of an observed mint to the verdict substrate. */
export interface TransferSemanticsBinding {
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly accountLayoutVersion: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly supportState: AdapterSupportState;
  readonly verdictPolicyVersion: string;
}

export type TransferResolution =
  | {
      readonly resolution: 'BOUND';
      readonly binding: TransferSemanticsBinding;
    }
  | {
      readonly resolution: 'REFUSED';
      readonly executionStatus: ExecutionStatus;
      readonly refusal: TransferResolutionRefusal;
      readonly qualityCodes: readonly string[];
    };

export interface TransferAdapterQuery {
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly accountLayoutVersion: string;
}

/**
 * A versioned transfer-semantics adapter serving one program/layout pair.
 * `supportedProgramVersions` is explicit — a version outside it is refused
 * with UNSUPPORTED_PROGRAM_VERSION, never approximated by another version's
 * verdicts.
 */
export class TransferSemanticsAdapter {
  readonly adapterId: string;
  readonly version: string;
  readonly chainId: string;
  readonly programId: string;
  readonly accountLayoutVersion: string;
  readonly supportedProgramVersions: readonly string[];
  readonly verdictPolicyVersion: string;
  private readonly policies: readonly TransferSemanticsPolicy[];

  constructor(config: {
    readonly adapterId: string;
    readonly version: string;
    readonly chainId: string;
    readonly programId: string;
    readonly accountLayoutVersion: string;
    readonly supportedProgramVersions: readonly string[];
    readonly verdictPolicyVersion: string;
    readonly policies?: readonly TransferSemanticsPolicy[];
  }) {
    this.adapterId = config.adapterId;
    this.version = config.version;
    this.chainId = config.chainId;
    this.programId = config.programId;
    this.accountLayoutVersion = config.accountLayoutVersion;
    this.supportedProgramVersions = [...config.supportedProgramVersions];
    this.verdictPolicyVersion = config.verdictPolicyVersion;
    this.policies = config.policies ?? [];
  }

  /** Fail-closed resolution: only exact chain/program/version/layout binds. */
  resolve(query: TransferAdapterQuery): TransferResolution {
    if (query.chainId !== this.chainId || query.programId !== this.programId) {
      return {
        resolution: 'REFUSED',
        executionStatus: ExecutionStatus.EXECUTION_UNAVAILABLE,
        refusal: 'UNSUPPORTED_PROGRAM',
        // Closed-vocabulary quality codes only (must satisfy QualityCodesSchema
        // at the shared-schemas boundary); the transfer plane has no pool-math
        // involvement, so a program mismatch is plain EXECUTION_UNAVAILABLE.
        qualityCodes: ['EXECUTION_UNAVAILABLE'],
      };
    }
    if (!this.supportedProgramVersions.includes(query.programVersion)) {
      return {
        resolution: 'REFUSED',
        executionStatus: ExecutionStatus.EXECUTION_UNAVAILABLE,
        refusal: 'UNSUPPORTED_PROGRAM_VERSION',
        qualityCodes: ['UNSUPPORTED_PROGRAM_VERSION'],
      };
    }
    if (query.accountLayoutVersion !== this.accountLayoutVersion) {
      return {
        resolution: 'REFUSED',
        executionStatus: ExecutionStatus.EXECUTION_UNAVAILABLE,
        refusal: 'UNSUPPORTED_PROGRAM_VERSION',
        qualityCodes: ['UNSUPPORTED_PROGRAM_VERSION'],
      };
    }
    return {
      resolution: 'BOUND',
      binding: {
        chainId: query.chainId,
        programId: query.programId,
        programVersion: query.programVersion,
        accountLayoutVersion: query.accountLayoutVersion,
        adapterId: this.adapterId,
        adapterVersion: this.version,
        supportState: AdapterSupportState.AVAILABLE,
        verdictPolicyVersion: this.verdictPolicyVersion,
      },
    };
  }

  /**
   * Produce extension-evidence rows for a mint via the solsec substrate
   * (read-only consumption — verdicts come from the proven policy engine).
   */
  extensionEvidence(input: {
    readonly assessmentId: string;
    readonly programVersion: string;
    readonly extensions: readonly (
      string | number | { readonly type: string | number; readonly data?: unknown }
    )[];
    readonly observedAt: string;
    readonly availableAt: string;
  }): readonly TokenExtensionSupport[] {
    return evaluateTransferSemantics({
      assessmentId: input.assessmentId,
      programId: this.programId,
      programVersion: input.programVersion,
      extensions: input.extensions,
      verdictPolicyVersion: this.verdictPolicyVersion,
      observedAt: input.observedAt,
      availableAt: input.availableAt,
      ...(this.policies.length > 0 ? { policies: this.policies } : {}),
    });
  }
}

/** Registry of transfer-semantics adapters with the same fail-closed law. */
export class TransferSemanticsRegistry {
  private readonly adapters: readonly TransferSemanticsAdapter[];

  constructor(adapters: readonly TransferSemanticsAdapter[]) {
    const keys = new Set(
      adapters.map((a) => `${a.chainId}:${a.programId}:${a.accountLayoutVersion}:${a.version}`),
    );
    if (keys.size !== adapters.length) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'DUPLICATE_TRANSFER_ADAPTER_BINDING',
      });
    }
    this.adapters = adapters;
  }

  resolve(query: TransferAdapterQuery): TransferResolution {
    for (const adapter of this.adapters) {
      const resolution = adapter.resolve(query);
      if (resolution.resolution === 'BOUND') return resolution;
    }
    return {
      resolution: 'REFUSED',
      executionStatus: ExecutionStatus.EXECUTION_UNAVAILABLE,
      refusal: 'UNSUPPORTED_PROGRAM_VERSION',
      qualityCodes: ['UNSUPPORTED_PROGRAM_VERSION'],
    };
  }
}

export interface EvaluateFillTransferCostsInput {
  readonly adapter: TransferSemanticsAdapter;
  readonly programVersion: string;
  readonly assessmentId: string;
  readonly inTokenMint: string;
  readonly outTokenMint: string;
  readonly rawAmountIn: bigint;
  /** Observed extension types on the input mint. */
  readonly inMintExtensions: readonly (
    string | number | { readonly type: string | number; readonly data?: unknown }
  )[];
  /** Observed extension types on the output mint. */
  readonly outMintExtensions: readonly (
    string | number | { readonly type: string | number; readonly data?: unknown }
  )[];
  readonly observedAt: string;
  readonly availableAt: string;
  /** Transfer-fee configs actually observed on the mints (null = none). */
  readonly inTokenTransferFee: TransferFeeConfiguration | null;
  readonly outTokenTransferFee: TransferFeeConfiguration | null;
  readonly accountCreations?: readonly AccountCreationCost[];
  /** Evidenced hook/aggregator costs; absence with a hook present blocks. */
  readonly hookCostRaw?: bigint;
  readonly aggregatorFeeRaw?: bigint;
  /** Pool-side gross output, for output-side transfer-fee application. */
  readonly poolOutputRaw?: bigint;
}

export type FillTransferCosts =
  | {
      readonly outcome: 'MODELED';
      readonly result: FeeModelResult;
      /** Net output after the output-side transfer fee, when requested. */
      readonly netPoolOutput: bigint | null;
    }
  | {
      readonly outcome: 'INSUFFICIENT_DATA';
      readonly reasons: readonly string[];
      readonly qualityCodes: readonly string[];
    };

/**
 * End-to-end fill transfer-cost evaluation: resolve verdicts through the
 * adapter (solsec substrate), compose costs with explicit evidence only,
 * and block on unknown required semantics (§64.9, FR-SOLSEC-004).
 */
export function evaluateFillTransferCosts(
  input: EvaluateFillTransferCostsInput,
): FillTransferCosts {
  if (typeof input.rawAmountIn !== 'bigint' || input.rawAmountIn <= 0n) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'FEE_MODEL_INPUT_INVALID',
      field: 'rawAmountIn',
    });
  }
  const inRows = input.adapter.extensionEvidence({
    assessmentId: input.assessmentId,
    programVersion: input.programVersion,
    extensions: input.inMintExtensions,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
  });
  const outRows = input.adapter.extensionEvidence({
    assessmentId: input.assessmentId,
    programVersion: input.programVersion,
    extensions: input.outMintExtensions,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
  });
  const inUnknown = inRows.filter((row) => blocksCompleteExecutionModeling(row));
  const outUnknown = outRows.filter((row) => blocksCompleteExecutionModeling(row));
  const insufficient: string[] = [
    ...inUnknown.map((row) => `IN_MINT_EXTENSION_${row.extensionType}_UNSUPPORTED`),
    ...outUnknown.map((row) => `OUT_MINT_EXTENSION_${row.extensionType}_UNSUPPORTED`),
  ];
  if (insufficient.length > 0) {
    return {
      outcome: 'INSUFFICIENT_DATA',
      reasons: insufficient,
      qualityCodes: ['INSUFFICIENT_DATA'],
    };
  }
  const result = composeTransferCosts({
    inTokenMint: input.inTokenMint,
    outTokenMint: input.outTokenMint,
    rawAmountIn: input.rawAmountIn,
    inTokenTransferFee: input.inTokenTransferFee,
    outTokenTransferFee: input.outTokenTransferFee,
    extensionEvidence: [...inRows, ...outRows],
    ...(input.accountCreations !== undefined ? { accountCreations: input.accountCreations } : {}),
    ...(input.hookCostRaw !== undefined ? { hookCostRaw: input.hookCostRaw } : {}),
    ...(input.aggregatorFeeRaw !== undefined ? { aggregatorFeeRaw: input.aggregatorFeeRaw } : {}),
  });
  if (!result.sufficientData) {
    return {
      outcome: 'INSUFFICIENT_DATA',
      reasons: result.insufficientReasons,
      qualityCodes: ['INSUFFICIENT_DATA'],
    };
  }
  const netPoolOutput =
    input.poolOutputRaw === undefined
      ? null
      : applyOutTransferFee(input.poolOutputRaw, input.outTokenTransferFee).net;
  return { outcome: 'MODELED', result, netPoolOutput };
}

/** Convenience re-export of the NOT_PRESENT gate used by callers. */
export function isNotPresent(row: TokenExtensionSupport): boolean {
  return row.support === TransferSemanticsSupport.NOT_PRESENT;
}
