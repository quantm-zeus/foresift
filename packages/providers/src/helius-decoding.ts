/**
 * LOCAL supported-program decoding (FR-PROV-007).
 *
 * Deterministic decoding of recorded raw `getTransaction` payloads over an
 * explicitly supported program set, separated from provider-side parsing.
 * The deprecated enhanced parser's output is supporting evidence only:
 * normalized economic events flow exclusively through THIS deterministic
 * pass, and only when coverage over the transaction's instruction set is
 * complete — partial coverage refuses (fail-closed) rather than guessing.
 */
import { ForesiftProviderError, ProvErrorCode } from '@foresift/provider-lifecycle';

/** Explicitly supported program ids. Anything outside this map is
 * unsupported and surfaces in the coverage report — never guessed at. */
export const SUPPORTED_PROGRAM_IDS = Object.freeze({
  SYSTEM_PROGRAM: '11111111111111111111111111111111',
  SPL_TOKEN_PROGRAM: 'TokenkegQfeZYiWF7vJU4qRDrGPnsKVXf1CGGmVkJTzye',
  ASSOCIATED_TOKEN_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  MEMO_PROGRAM: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
} as const);

const KIND_BY_PROGRAM_ID: Readonly<Record<string, string>> = Object.freeze({
  [SUPPORTED_PROGRAM_IDS.SYSTEM_PROGRAM]: 'SYSTEM_TRANSFER',
  [SUPPORTED_PROGRAM_IDS.SPL_TOKEN_PROGRAM]: 'SPL_TOKEN_TRANSFER',
  [SUPPORTED_PROGRAM_IDS.ASSOCIATED_TOKEN_PROGRAM]: 'ATA_CREATION',
  [SUPPORTED_PROGRAM_IDS.MEMO_PROGRAM]: 'MEMO_NOTE',
});

export type LocalInstructionKind = 'SYSTEM_TRANSFER' | 'SPL_TOKEN_TRANSFER' | 'ATA_CREATION' | 'MEMO_NOTE';

export interface DecodedInstruction {
  readonly index: number;
  readonly programId: string;
  readonly kind: LocalInstructionKind;
  readonly accounts: readonly string[];
}

export interface LocalDecodingResult {
  readonly instructions: readonly DecodedInstruction[];
  /** Sorted unique program ids the local decoder does not support. */
  readonly unsupportedProgramIds: readonly string[];
  /** True ONLY when every instruction decoded and at least one exists. */
  readonly fullyCovered: boolean;
}

export interface RawInstructionShape {
  readonly programId?: unknown;
  readonly accounts?: unknown;
}

export interface RawTransactionShape {
  readonly transaction?: {
    readonly message?: {
      readonly instructions?: unknown;
    };
  };
}

/**
 * Decode every instruction of a raw payload against the supported program
 * map. Purely structural — no heuristics, no provider-parsed summaries.
 */
export function decodeInstructionsLocally(raw: RawTransactionShape): LocalDecodingResult {
  const instructions: unknown = raw.transaction?.message?.instructions;
  if (!Array.isArray(instructions)) {
    throw new ForesiftProviderError(
      ProvErrorCode.PROV_ALLOWLIST_RESPONSE_SCHEMA_REFUSED,
      'raw transaction payload carries no instruction array for local decoding',
    );
  }
  const decoded: DecodedInstruction[] = [];
  const unsupported = new Set<string>();
  let index = 0;
  for (const candidate of instructions as readonly RawInstructionShape[]) {
    const programId = candidate?.programId;
    if (typeof programId !== 'string' || programId === '') {
      throw new ForesiftProviderError(
        ProvErrorCode.PROV_DECODING_COVERAGE_INCOMPLETE,
        'instruction without a programId cannot be classified deterministically',
        { index },
      );
    }
    const kind = KIND_BY_PROGRAM_ID[programId];
    if (kind === undefined) {
      unsupported.add(programId);
      continue;
    }
    decoded.push({
      index,
      programId,
      kind: kind as LocalInstructionKind,
      accounts: Array.isArray(candidate.accounts)
        ? candidate.accounts.filter((a): a is string => typeof a === 'string')
        : [],
    });
    index += 1;
  }
  return {
    instructions: Object.freeze(decoded),
    unsupportedProgramIds: Object.freeze([...unsupported].sort()),
    fullyCovered: unsupported.size === 0 && instructions.length > 0 && decoded.length > 0,
  };
}

/**
 * Normalized economic events require COMPLETE deterministic coverage: an
 * unsupported program means the transaction's economic content is not fully
 * understood locally, and provider parsing must never fill that gap.
 */
export function assertDeterministicCoverage(result: LocalDecodingResult): void {
  if (!result.fullyCovered) {
    throw new ForesiftProviderError(
      ProvErrorCode.PROV_DECODING_COVERAGE_INCOMPLETE,
      `local decoding coverage incomplete — unsupported programs: ${result.unsupportedProgramIds.join(', ') || '(none decoded)'}`,
      { unsupportedProgramIds: result.unsupportedProgramIds.join(',') },
    );
  }
}
