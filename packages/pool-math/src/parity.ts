/**
 * §64.11/FR-EXEC-016 parity gate suite over the proven
 * `@foresift/program-decoders` parity seam. Failure transitions the adapter
 * to DEGRADED and opens an incident (FR-EXEC-021). Tolerance is
 * version-specific and predeclared — never chosen after observing output.
 */
import type { QuoteResult } from '@foresift/program-decoders';
import { detectUpgradeChange } from '@foresift/program-decoders';
import { AdapterSupportState } from '@foresift/domain';
import type { PoolMathAdapter } from './adapter-contract.ts';

export { detectUpgradeChange };

/** A deterministic vector: state + quote input → expected exact output. */
export interface DeterministicVector {
  readonly vectorId: string;
  readonly expectedOutRaw: bigint;
}

/** A historical observed economic trade used for parity (fixture-encoded). */
export interface ObservedTradeParityCase {
  readonly caseId: string;
  readonly inTokenMint: string;
  readonly outTokenMint: string;
  readonly rawAmountIn: bigint;
  readonly observedOutRaw: bigint;
  /** Predeclared tolerance for this notional band (§64.11). */
  readonly toleranceBps: number;
}

export interface ReferenceQuoteParityCase {
  readonly caseId: string;
  readonly quote: QuoteResult;
  readonly referenceOutRaw: bigint;
  readonly toleranceBps: number;
}

export type ParityFailureCause =
  | 'DETERMINISTIC_VECTOR_MISMATCH'
  | 'OBSERVED_TRADE_PARITY_DRIFT'
  | 'REFERENCE_QUOTE_PARITY_DRIFT'
  | 'TOLERANCE_GATE_EXCEEDED'
  | 'IDL_OR_LAYOUT_HASH_MISMATCH'
  | 'DECODER_HASH_MISMATCH';

export interface ParityGateResult {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly passed: boolean;
  readonly failures: readonly ParityFailureCause[];
  readonly failingCaseIds: readonly string[];
  readonly resultingSupportState: AdapterSupportState;
  /** FR-EXEC-021: failure opens an incident; this is its machine cause. */
  readonly incidentCause: 'PARITY_DRIFT' | 'PROGRAM_UPGRADE' | 'FIXTURE_FAILURE' | null;
}

function withinTolerance(actual: bigint, expected: bigint, toleranceBps: number): boolean {
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0) return false;
  if (expected === 0n) return actual === 0n;
  const diff = actual > expected ? actual - expected : expected - actual;
  return diff * 10_000n <= expected * BigInt(toleranceBps);
}

export interface RunParityGateInput {
  readonly adapter: PoolMathAdapter;
  readonly vectors: readonly DeterministicVector[];
  readonly quoteForVector: (vectorId: string) => QuoteResult;
  readonly observedTrades: readonly ObservedTradeParityCase[];
  readonly quoteForObservedTrade: (caseId: string) => QuoteResult;
  readonly referenceQuotes: readonly ReferenceQuoteParityCase[];
  readonly manifestLayoutHash: string;
  readonly observedLayoutHash: string;
  /** Decoder hash recorded in the signed manifest at approval time. */
  readonly manifestDecoderHash: string;
  /** Decoder hash of the decoder actually serving the adapter now. */
  readonly decoderHash: string;
}

/**
 * Run the full parity gate. Deterministic vectors must match exactly;
 * observed-trade and reference-quote parity use the predeclared per-case
 * tolerance bands. Any failure degrades the adapter (§64.11).
 */
export function runParityGate(input: RunParityGateInput): ParityGateResult {
  const failures: ParityFailureCause[] = [];
  const failingCaseIds: string[] = [];

  for (const vector of input.vectors) {
    try {
      const quote = input.quoteForVector(vector.vectorId);
      if (quote.rawAmountOut !== vector.expectedOutRaw) {
        failures.push('DETERMINISTIC_VECTOR_MISMATCH');
        failingCaseIds.push(vector.vectorId);
      }
    } catch {
      failures.push('DETERMINISTIC_VECTOR_MISMATCH');
      failingCaseIds.push(vector.vectorId);
    }
  }

  for (const trade of input.observedTrades) {
    try {
      const quote = input.quoteForObservedTrade(trade.caseId);
      if (!withinTolerance(quote.rawAmountOut, trade.observedOutRaw, trade.toleranceBps)) {
        failures.push('OBSERVED_TRADE_PARITY_DRIFT');
        failingCaseIds.push(trade.caseId);
      }
    } catch {
      failures.push('OBSERVED_TRADE_PARITY_DRIFT');
      failingCaseIds.push(trade.caseId);
    }
  }

  for (const ref of input.referenceQuotes) {
    if (!withinTolerance(ref.quote.rawAmountOut, ref.referenceOutRaw, ref.toleranceBps)) {
      failures.push('REFERENCE_QUOTE_PARITY_DRIFT');
      failingCaseIds.push(ref.caseId);
    }
  }

  // §64.11 upgrade detection: any manifest-vs-observed drift on layout or
  // decoder hashes means the program changed under the adapter.
  const upgradeFindings = detectUpgradeChange({
    manifestLayoutHash: input.manifestLayoutHash,
    observedLayoutHash: input.observedLayoutHash,
    manifestDecoderHash: input.manifestDecoderHash,
    decoderHash: input.decoderHash,
  });
  for (const finding of upgradeFindings) {
    failures.push(finding as ParityFailureCause);
    failingCaseIds.push(finding);
  }

  const passed = failures.length === 0;
  const incidentCause: ParityGateResult['incidentCause'] = passed
    ? null
    : upgradeFindings.length > 0
      ? 'PROGRAM_UPGRADE'
      : 'PARITY_DRIFT';
  return {
    adapterId: input.adapter.adapterId,
    adapterVersion: input.adapter.version,
    passed,
    failures: [...new Set(failures)],
    failingCaseIds: [...new Set(failingCaseIds)],
    resultingSupportState: passed ? AdapterSupportState.AVAILABLE : AdapterSupportState.DEGRADED,
    incidentCause,
  };
}
