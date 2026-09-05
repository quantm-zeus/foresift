/**
 * §64.9 fee model on BigInt raw amounts — pool fees are composed by the
 * pool-math adapters; this module composes the transfer side: Token-2022
 * transfer fee (at the applicable epoch/configuration), transfer-hook
 * effects, account creation and rent. Zero cost is NEVER assumed: every
 * cost input must be explicitly evidenced; absence is `INSUFFICIENT_DATA`,
 * not free (§64.9, FR-EXEC-003, FR-EXEC-018, AC-233).
 *
 * Verdict substrate: `@foresift/solana-security` (KNOWN_MODELED /
 * KNOWN_UNMODELED / UNKNOWN_REQUIRED / NOT_PRESENT) is consumed read-only —
 * verdicts are never restated here.
 *
 * Traces: FR-EXEC-003, FR-EXEC-013, FR-EXEC-018, AC-121, AC-233.
 */
import { ExecErrorCode, ExecVocabularyError, TransferSemanticsSupport } from '@foresift/domain';
import type { TokenExtensionSupport } from '@foresift/shared-schemas';
import { blocksCompleteExecutionModeling } from '@foresift/solana-security';

/** One cost component with its provenance label (never "assumed zero"). */
export interface CostComponent {
  readonly kind:
    | 'POOL_FEE'
    | 'AGGREGATOR_FEE'
    | 'TRANSFER_FEE'
    | 'TRANSFER_HOOK_COST'
    | 'ACCOUNT_RENT'
    | 'PRIORITY_FEE'
    | 'NETWORK_FEE'
    | 'EXECUTION_IMPACT'
    | 'MEV_BUFFER'
    | 'QUOTE_CONVERSION'
    | 'MINIMUM_OUTPUT_SHORTFALL'
    | 'RESIDUAL_INVENTORY';
  /** Raw token amount of the cost (positive = cost to the trader). */
  readonly rawAmount: bigint;
  /** Mint the amount is denominated in. */
  readonly mint: string;
  /** Explicit evidence basis; a cost without evidence is refused. */
  readonly basis: 'OBSERVED' | 'CONFIGURED' | 'DERIVED' | 'CONSERVATIVE_BOUND';
}

/** Token-2022 transfer-fee configuration actually observed on the mint. */
export interface TransferFeeConfiguration {
  /** Applicable epoch — the configuration in force at simulated fill time. */
  readonly applicableEpoch: number;
  readonly transferFeeBps: number;
  readonly maxFeeRaw: bigint;
  /** Withheld fees recorded on the account being modeled, if any. */
  readonly withheldAmountRaw: bigint | null;
  readonly observedAt: string;
}

/** Rent-evidence for accounts created by a simulated fill. */
export interface AccountCreationCost {
  readonly accountFamily: string;
  readonly lamportsRequired: bigint;
  readonly basis: CostComponent['basis'];
}

export interface FeeModelInput {
  readonly inTokenMint: string;
  readonly outTokenMint: string;
  /** Gross swap amount entering the input side. */
  readonly rawAmountIn: bigint;
  /** Transfer-fee configs for the mints involved; null = NOT_PRESENT. */
  readonly inTokenTransferFee: TransferFeeConfiguration | null;
  readonly outTokenTransferFee: TransferFeeConfiguration | null;
  /** Extension evidence rows for both mints (from the solsec substrate). */
  readonly extensionEvidence: readonly TokenExtensionSupport[];
  /** Account creations the modeled fill would incur, with rent evidence. */
  readonly accountCreations?: readonly AccountCreationCost[];
  /** Explicitly evidenced flat hook cost in output-mint raw units. */
  readonly hookCostRaw?: bigint;
  /** Explicitly evidenced aggregator fee, when a route uses one. */
  readonly aggregatorFeeRaw?: bigint;
}

export interface FeeModelResult {
  /** Amount actually received by the pool after input-side transfer fee. */
  readonly effectiveAmountIn: bigint;
  readonly costs: readonly CostComponent[];
  /** §64.9: any unknown required semantics makes the fill INSUFFICIENT_DATA. */
  readonly sufficientData: boolean;
  readonly insufficientReasons: readonly string[];
}

function requirePositiveRaw(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'FEE_MODEL_INPUT_INVALID',
      field: label,
      value: String(value),
    });
  }
  return value;
}

/** Transfer-fee bps + max-fee clamp at the applicable epoch configuration. */
export function transferFeeOn(rawAmount: bigint, config: TransferFeeConfiguration): bigint {
  requirePositiveRaw(rawAmount, 'rawAmount');
  if (!Number.isInteger(config.transferFeeBps) || config.transferFeeBps < 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'TRANSFER_FEE_CONFIG_INVALID',
    });
  }
  const fee = (rawAmount * BigInt(config.transferFeeBps)) / 10_000n;
  return config.maxFeeRaw > 0n && fee > config.maxFeeRaw ? config.maxFeeRaw : fee;
}

const HOOK_FAMILIES = new Set(['TRANSFER_HOOK', 'CONFIDENTIAL_TRANSFER']);

/**
 * Compose transfer-side costs for a fill. Transfer fees are modeled at the
 * applicable epoch configuration; hooks require explicit evidence; account
 * rent uses the provided lamport evidence. Zero cost is never assumed —
 * a required dimension without evidence yields `INSUFFICIENT_DATA`.
 */
export function composeTransferCosts(input: FeeModelInput): FeeModelResult {
  requirePositiveRaw(input.rawAmountIn, 'rawAmountIn');
  const costs: CostComponent[] = [];
  const insufficientReasons: string[] = [];

  // §64.9/FR-SOLSEC-004: unknown required transfer semantics never pass.
  // KNOWN_UNMODELED hooks also block fee modeling (we cannot quantify them),
  // but KNOWN_MODELED/NOT_PRESENT rows are fine.
  for (const row of input.extensionEvidence) {
    if (!blocksCompleteExecutionModeling(row)) continue;
    insufficientReasons.push(`EXTENSION_${row.extensionType}_UNSUPPORTED`);
  }
  for (const row of input.extensionEvidence) {
    if (HOOK_FAMILIES.has(row.extensionType)) {
      if (row.support === TransferSemanticsSupport.KNOWN_UNMODELED) {
        insufficientReasons.push(`HOOK_${row.extensionType}_UNMODELED`);
      } else if (row.support === TransferSemanticsSupport.KNOWN_MODELED) {
        if (input.hookCostRaw === undefined) {
          // Hook present and modeled, but no cost evidence provided.
          insufficientReasons.push('HOOK_COST_EVIDENCE_MISSING');
        }
      }
    }
  }

  let effectiveAmountIn = input.rawAmountIn;
  if (input.inTokenTransferFee !== null) {
    const fee = transferFeeOn(input.rawAmountIn, input.inTokenTransferFee);
    effectiveAmountIn -= fee;
    costs.push({
      kind: 'TRANSFER_FEE',
      rawAmount: fee,
      mint: input.inTokenMint,
      basis: 'OBSERVED',
    });
  }

  if (input.aggregatorFeeRaw !== undefined) {
    requirePositiveRaw(input.aggregatorFeeRaw, 'aggregatorFeeRaw');
    costs.push({
      kind: 'AGGREGATOR_FEE',
      rawAmount: input.aggregatorFeeRaw,
      mint: input.inTokenMint,
      basis: 'OBSERVED',
    });
  }

  if (input.hookCostRaw !== undefined) {
    requirePositiveRaw(input.hookCostRaw, 'hookCostRaw');
    costs.push({
      kind: 'TRANSFER_HOOK_COST',
      rawAmount: input.hookCostRaw,
      mint: input.outTokenMint,
      basis: 'OBSERVED',
    });
  }

  for (const creation of input.accountCreations ?? []) {
    if (creation.lamportsRequired < 0n) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'RENT_EVIDENCE_INVALID',
        accountFamily: creation.accountFamily,
      });
    }
    if (creation.lamportsRequired === 0n && creation.basis !== 'OBSERVED') {
      // Zero rent is never assumed; a zero claim must be observed evidence.
      insufficientReasons.push(`RENT_${creation.accountFamily}_EVIDENCE_MISSING`);
      continue;
    }
    costs.push({
      kind: 'ACCOUNT_RENT',
      rawAmount: creation.lamportsRequired,
      mint: 'SOL',
      basis: creation.basis,
    });
  }

  return {
    effectiveAmountIn,
    costs,
    sufficientData: insufficientReasons.length === 0,
    insufficientReasons,
  };
}

/** Apply the output-side transfer fee to a pool quote output (exact, floored). */
export function applyOutTransferFee(
  poolOutputRaw: bigint,
  config: TransferFeeConfiguration | null,
): { readonly net: bigint; readonly fee: bigint } {
  requirePositiveRaw(poolOutputRaw, 'poolOutputRaw');
  if (config === null) return { net: poolOutputRaw, fee: 0n };
  const fee = transferFeeOn(poolOutputRaw, config);
  return { net: poolOutputRaw - fee, fee };
}
