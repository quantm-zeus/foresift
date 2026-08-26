/**
 * LOCAL supported-program decoding of raw Helius RPC transactions
 * (FR-PROV-007, §15.8; T117).
 *
 * The normative path: raw `getTransaction` output + THIS deterministic local
 * decoder — provider-parsed transaction summaries are supporting evidence at
 * most, never the source of normalized economic events.
 *
 * Determinism contract: same raw JSON in, same events + coverage report out;
 * no clock, no network, no randomness. Coverage is explicit: every examined
 * instruction is either decoded against a SUPPORTED program layout or
 * reported under `unsupportedProgramIds` so downstream coverage/quality
 * checks can gate event normalization (never silently dropped).
 */

/** Program layouts this decoder supports (Solana mainnet addresses). */
export const SUPPORTED_DECODER_PROGRAMS = {
  SPL_TOKEN: 'TokenkegQfeZYiSFpPdmLpNSuQUhXZ8B2zLxNTLBZVdPQ',
  TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
} as const;

export type SupportedDecoderProgramId =
  (typeof SUPPORTED_DECODER_PROGRAMS)[keyof typeof SUPPORTED_DECODER_PROGRAMS];

export interface DecodedTokenTransferEvent {
  readonly eventType: 'TOKEN_TRANSFER';
  readonly program: 'spl-token' | 'token-2022';
  readonly instructionType: 'transfer' | 'transferChecked' | 'mintTo' | 'burn';
  /** Base58 mint when the instruction carries it (transferChecked/mintTo/burn). */
  readonly mint: string | null;
  readonly amount: string;
  readonly decimals: number | null;
  readonly source: string | null;
  readonly destination: string | null;
}

/** Raw parsed-instruction shape as recorded from Solana JSON-RPC responses. */
export interface RawParsedInstruction {
  readonly program?: string | undefined;
  readonly programId?: string | undefined;
  readonly parsed?:
    | {
        readonly type?: string | undefined;
        readonly info?: Record<string, unknown> | undefined;
      }
    | undefined;
}

export interface DecodingCoverage {
  readonly instructionsExamined: number;
  readonly instructionsDecoded: number;
  /** Program ids present but without a supported deterministic layout. */
  readonly unsupportedProgramIds: readonly string[];
}

export interface LocalDecodingResult {
  readonly events: readonly DecodedTokenTransferEvent[];
  readonly coverage: DecodingCoverage;
}

function isSupportedProgram(programId: string): boolean {
  return (
    programId === SUPPORTED_DECODER_PROGRAMS.SPL_TOKEN ||
    programId === SUPPORTED_DECODER_PROGRAMS.TOKEN_2022
  );
}

function str(info: Record<string, unknown>, key: string): string | null {
  const value = info[key];
  return typeof value === 'string' ? value : null;
}

/** Deterministically decodes ONE recorded raw transaction body. */
export function decodeRawTransaction(raw: {
  readonly instructions?: readonly RawParsedInstruction[] | undefined;
  readonly innerInstructions?:
    readonly { readonly instructions?: readonly RawParsedInstruction[] | undefined }[] | undefined;
}): LocalDecodingResult {
  const topLevel = raw.instructions ?? [];
  const nested = (raw.innerInstructions ?? []).flatMap((group) => group.instructions ?? []);
  const all = [...topLevel, ...nested];

  const events: DecodedTokenTransferEvent[] = [];
  const unsupported = new Set<string>();
  let decoded = 0;

  for (const instruction of all) {
    const programId = instruction.programId ?? '';
    if (!isSupportedProgram(programId)) {
      if (programId.length > 0) unsupported.add(programId);
      continue;
    }
    const parsedType = instruction.parsed?.type ?? '';
    const info = instruction.parsed?.info ?? {};
    const program: DecodedTokenTransferEvent['program'] =
      programId === SUPPORTED_DECODER_PROGRAMS.SPL_TOKEN ? 'spl-token' : 'token-2022';

    switch (parsedType) {
      case 'transfer': {
        // Legacy transfer: amounts ride pre-decoded token accounts; the mint
        // is not carried on the instruction itself.
        events.push({
          eventType: 'TOKEN_TRANSFER',
          program,
          instructionType: 'transfer',
          mint: null,
          amount: str(info, 'amount') ?? '',
          decimals: null,
          source: str(info, 'source'),
          destination: str(info, 'destination'),
        });
        decoded += 1;
        break;
      }
      case 'transferChecked': {
        const tokenAmount =
          info.tokenAmount !== undefined &&
          info.tokenAmount !== null &&
          typeof info.tokenAmount === 'object'
            ? (info.tokenAmount as Record<string, unknown>)
            : {};
        events.push({
          eventType: 'TOKEN_TRANSFER',
          program,
          instructionType: 'transferChecked',
          mint: str(info, 'mint'),
          amount: typeof tokenAmount['amount'] === 'string' ? tokenAmount['amount'] : '',
          decimals: typeof tokenAmount['decimals'] === 'number' ? tokenAmount['decimals'] : null,
          source: str(info, 'source'),
          destination: str(info, 'destination'),
        });
        decoded += 1;
        break;
      }
      case 'mintTo':
      case 'burn': {
        events.push({
          eventType: 'TOKEN_TRANSFER',
          program,
          instructionType: parsedType,
          mint: str(info, 'mint'),
          amount: str(info, 'amount') ?? '',
          decimals: typeof info['decimals'] === 'number' ? (info['decimals'] as number) : null,
          source: parsedType === 'burn' ? str(info, 'account') : null,
          destination: parsedType === 'mintTo' ? str(info, 'account') : null,
        });
        decoded += 1;
        break;
      }
      default:
        // Supported PROGRAM, unsupported INSTRUCTION type — counted but not
        // fabricated into an event.
        unsupported.add(`${programId}:${parsedType || '<unparsed>'}`);
        break;
    }
  }

  return {
    events,
    coverage: {
      instructionsExamined: all.length,
      instructionsDecoded: decoded,
      unsupportedProgramIds: [...unsupported].sort(),
    },
  };
}
