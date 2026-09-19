/**
 * Diagnostic metrics (FR-OBJ-005): per-alert precision,
 * tradable-success rate, recall, and alerts per researched candidate.
 *
 * Diagnostics are computed and labeled diagnostic-only. They never enter
 * the promotion verdict: the verdict input type carries no diagnostic
 * fields (see `diagnosticsExcludedByConstruction`), and this module
 * exports no verdict-shaped type. Ratios stay exact integer
 * numerator/denominator pairs; basis-point views are display-only.
 */
import {
  ALL_DIAGNOSTIC_KINDS,
  ObjError,
  ObjErrorCode,
  diagnosticsExcludedByConstruction,
  type DiagnosticKind,
} from '@foresift/domain';

/** One diagnostic as exact integer counts — never a float. */
export interface DiagnosticMetric {
  readonly numerator: number;
  readonly denominator: number;
}

/** Four diagnostics with the structural diagnostic-only marker. */
export interface DiagnosticReport {
  readonly runId: string;
  readonly metrics: Readonly<Record<DiagnosticKind, DiagnosticMetric>>;
  readonly diagnosticOnly: true;
}

function assertMetric(kind: string, metric: DiagnosticMetric | undefined): DiagnosticMetric {
  if (metric === undefined)
    throw new ObjError(ObjErrorCode.OBJ_DIAGNOSTIC_KIND_UNKNOWN, 'diagnostic metric missing', {
      kind,
    });
  if (!Number.isSafeInteger(metric.numerator) || metric.numerator < 0)
    throw new ObjError(
      ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
      'diagnostic numerator must be a non-negative integer',
      { kind },
    );
  if (!Number.isSafeInteger(metric.denominator) || metric.denominator <= 0)
    throw new ObjError(
      ObjErrorCode.OBJ_FLOAT_ARITHMETIC_REFUSED,
      'diagnostic denominator must be a positive integer',
      { kind },
    );
  return metric;
}

/** Compute the four diagnostics; the report is marked diagnostic-only by construction. */
export function computeDiagnostics(
  runId: string,
  metrics: Readonly<Partial<Record<DiagnosticKind, DiagnosticMetric>>>,
): DiagnosticReport {
  if (runId.length === 0)
    throw new ObjError(ObjErrorCode.OBJ_DIMENSION_UNKNOWN, 'diagnostics require a run id', {});
  const computed = {} as Record<DiagnosticKind, DiagnosticMetric>;
  for (const kind of ALL_DIAGNOSTIC_KINDS) computed[kind] = assertMetric(kind, metrics[kind]);
  return { runId, metrics: computed, diagnosticOnly: true };
}

/**
 * Display-only basis points for one metric, floored to integer hundredths
 * of a percent. Never a gate input — gates consume utility, never this.
 */
export function diagnosticBasisPoints(metric: DiagnosticMetric): bigint {
  const checked = assertMetric('basis-points-input', metric);
  return (BigInt(checked.numerator) * 10000n) / BigInt(checked.denominator);
}

/**
 * Assert a diagnostic report stays diagnostic-only: the literal marker
 * holds and no diagnostic key rides on a verdict-shaped input.
 */
export function assertDiagnosticOnly(report: DiagnosticReport): void {
  if (report.diagnosticOnly !== true)
    throw new ObjError(
      ObjErrorCode.OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED,
      'diagnostic report lost its diagnostic-only marker',
      {},
    );
  diagnosticsExcludedByConstruction(report);
}
