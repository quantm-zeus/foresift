/**
 * Twelve-line decomposition reports (FR-OBJ-004): gross return,
 * execution costs, failed/partial fills, drawdown, CVaR, capital
 * utilization, turnover, opportunity cost, concentration,
 * shared-liquidity impact, provider/model/infrastructure cost, and
 * uncertainty.
 *
 * Lines sum exactly to reported net in integer micro-units; the report
 * carries its uncertainty line, consumed ESS reference, and the
 * eval-proven uncertainty method. Reports are frozen on build.
 */
import {
  ALL_INTERVAL_METHODS,
  ALL_UTILITY_LINE_KINDS,
  ObjError,
  ObjErrorCode,
  assertDecompositionReconciles,
  assertIntegerMicros,
  frozenRecordImmutable,
  type IntervalMethod,
  type UtilityLineKind,
} from '@foresift/domain';

/** Twelve decomposition lines in integer micro-units. */
export type DecompositionLines = Readonly<Record<UtilityLineKind, number | bigint>>;

/** Inputs to one twelve-line report. */
export interface DecompositionInput {
  readonly runId: string;
  readonly capitalDay: string;
  readonly lines: DecompositionLines;
  readonly consumedEssReference: string;
  readonly intervalMethod: string;
}

/** Reconciled, frozen twelve-line report. */
export interface DecompositionReport {
  readonly runId: string;
  readonly capitalDay: string;
  readonly lines: Readonly<Record<UtilityLineKind, bigint>>;
  readonly netMicros: bigint;
  readonly uncertaintyMicros: bigint;
  readonly consumedEssReference: string;
  readonly intervalMethod: IntervalMethod;
}

/**
 * Build a reconciling report: every line present and integer, lines
 * summing exactly to net, uncertainty method from the eval-proven
 * vocabulary, then frozen. Anything else refuses.
 */
export function buildDecompositionReport(input: DecompositionInput): DecompositionReport {
  if (input.runId.length === 0)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'decomposition report requires a run id', {});
  if (input.consumedEssReference.length === 0)
    throw new ObjError(
      ObjErrorCode.OBJ_UNCERTAINTY_DISCLOSURE_MISSING,
      'decomposition report requires a consumed ESS reference',
      {},
    );
  if (!(ALL_INTERVAL_METHODS as readonly string[]).includes(input.intervalMethod))
    throw new ObjError(
      ObjErrorCode.OBJ_CLAIM_FIELD_UNKNOWN,
      'decomposition report requires an eval-proven uncertainty method',
      { value: input.intervalMethod },
    );
  const lines = {} as Record<UtilityLineKind, bigint>;
  for (const kind of ALL_UTILITY_LINE_KINDS)
    lines[kind] = assertIntegerMicros(input.lines[kind] as number | bigint, kind);
  let net = 0n;
  for (const kind of ALL_UTILITY_LINE_KINDS) net += lines[kind];
  assertDecompositionReconciles(input.lines, net);
  return frozenRecordImmutable({
    runId: input.runId,
    capitalDay: input.capitalDay,
    lines,
    netMicros: net,
    uncertaintyMicros: lines.UNCERTAINTY,
    consumedEssReference: input.consumedEssReference,
    intervalMethod: input.intervalMethod as IntervalMethod,
  });
}
