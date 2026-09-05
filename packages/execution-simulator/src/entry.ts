/**
 * §64.6 entry modeling (FR-EXEC-002, FR-EXEC-018).
 *
 * An entry fill record carries every dimension the PRD names: requested and
 * filled quantity, average execution price, marginal and average impact,
 * pool/aggregator/token/network fees, failed/rejected amounts, start and
 * completion instants, and the state/route uncertainty the fill was modeled
 * under. Partial-fill policy and unfilled-capital treatment are explicit —
 * unfilled capital is returned to the caller unmodified, never silently
 * re-attempted or counted as filled.
 *
 * Fail-closed: quantities are decimal strings (never JS numbers), fractions
 * are finite [0,1], and an EXECUTED_FULL result with a non-1 fill fraction is
 * refused.
 *
 * Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, AC-121.
 */
import { ExecErrorCode, ExecVocabularyError, ExecutionStatus } from '@foresift/domain';
import { composeNetReturn, type NetReturnInput } from './net-return.ts';
import type { NetReturnBreakdown } from './net-return.ts';

export type { NetReturnBreakdown };

/** Where the entry route's pricing evidence came from (§64.6). */
export type EntryRouteUncertainty =
  | 'NONE'
  | 'STALE_QUOTE'
  | 'INCOMPLETE_STATE'
  | 'ROUTE_UNVERIFIED';

export interface EntryFillInput {
  readonly fillId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  /** Requested notional in quote-asset decimal units. */
  readonly requestedQuantity: string;
  /** Actually filled notional in quote-asset decimal units. */
  readonly filledQuantity: string;
  /** Average execution price achieved, quote asset per base asset. */
  readonly averageExecutionPrice: string;
  /** Marginal (last-increment) price impact, fraction [0,1]. */
  readonly marginalPriceImpact: number;
  /** Volume-weighted average price impact, fraction [0,1]. */
  readonly averagePriceImpact: number;
  /** Notional rejected/failed outright (decimal string, same asset as requested). */
  readonly failedAmount: string;
  readonly startSlot: number;
  readonly completionSlot: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: ExecutionStatus;
  /** Uncertainty the fill was modeled under (§64.4/§64.6). */
  readonly routeUncertainty: EntryRouteUncertainty;
  /** Partial-fill policy: minimum fill fraction the scenario accepts. */
  readonly minimumFillFraction: number;
  /** Net-return cost legs for this entry (§64.9). */
  readonly netReturn: NetReturnInput;
}

export interface EntryFillResult {
  readonly fillId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly requestedQuantity: string;
  readonly filledQuantity: string;
  readonly fillFraction: number;
  readonly averageExecutionPrice: string;
  readonly marginalPriceImpact: number;
  readonly averagePriceImpact: number;
  readonly failedAmount: string;
  /** Unfilled capital returned to the model untouched (§64.6). */
  readonly unfilledQuantity: string;
  readonly startSlot: number;
  readonly completionSlot: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: ExecutionStatus;
  readonly routeUncertainty: EntryRouteUncertainty;
  readonly netReturn: NetReturnBreakdown;
}

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function requireDecimal(value: string, label: string): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ENTRY_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

function requireFraction(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ENTRY_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

function requireSlotOrder(start: number, completion: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(completion) || completion < start) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ENTRY_COMPLETION_PRECEDES_START',
      startSlot: start,
      completionSlot: completion,
    });
  }
}

/**
 * Model a modeled entry fill: validate every leg, derive the fill fraction
 * and unfilled-capital treatment, and compose the net return. The result is
 * a pure record — nothing here mutates state or talks to a network.
 */
export function modelEntryFill(input: EntryFillInput): EntryFillResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  const requested = requireDecimal(input.requestedQuantity, 'requestedQuantity');
  const filled = requireDecimal(input.filledQuantity, 'filledQuantity');
  requireDecimal(input.averageExecutionPrice, 'averageExecutionPrice');
  requireDecimal(input.failedAmount, 'failedAmount');
  const marginal = requireFraction(input.marginalPriceImpact, 'marginalPriceImpact');
  const average = requireFraction(input.averagePriceImpact, 'averagePriceImpact');
  const minimumFillFraction = requireFraction(input.minimumFillFraction, 'minimumFillFraction');
  requireSlotOrder(input.startSlot, input.completionSlot);

  const requestedValue = BigInt(requested.split('.')[0] ?? '0');
  const filledValue = BigInt(filled.split('.')[0] ?? '0');
  const failedValue = BigInt(input.failedAmount.split('.')[0] ?? '0');
  if (filledValue + failedValue > requestedValue) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ENTRY_FILL_EXCEEDS_REQUESTED',
      filled,
      failed: input.failedAmount,
      requested,
    });
  }

  const fillFraction =
    requestedValue === 0n ? 0 : Number(filledValue * 10_000n / requestedValue) / 10_000;
  if (input.status === ExecutionStatus.EXECUTED_FULL && fillFraction !== 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ENTRY_FULL_STATUS_WITH_PARTIAL_FILL',
      fillFraction,
    });
  }
  if (
    fillFraction > 0 &&
    fillFraction < 1 &&
    fillFraction < minimumFillFraction &&
    input.status !== ExecutionStatus.INSUFFICIENT_DATA
  ) {
    // Below the pre-registered minimum fill fraction the entry is not an
    // executable partial — it is a failed attempt (§64.6 partial-fill policy).
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ENTRY_FILL_BELOW_DECLARED_MINIMUM',
      fillFraction,
      minimumFillFraction,
    });
  }

  const unfilledValue = requestedValue - filledValue - failedValue;
  return {
    fillId: input.fillId,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    requestedQuantity: requested,
    filledQuantity: filled,
    fillFraction,
    averageExecutionPrice: input.averageExecutionPrice,
    marginalPriceImpact: marginal,
    averagePriceImpact: average,
    failedAmount: input.failedAmount,
    unfilledQuantity: unfilledValue.toString(),
    startSlot: input.startSlot,
    completionSlot: input.completionSlot,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    status: input.status,
    routeUncertainty: input.routeUncertainty,
    netReturn: composeNetReturn(input.netReturn),
  };
}
