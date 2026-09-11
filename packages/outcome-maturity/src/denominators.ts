/** Exhaustive denominator disclosure and anti-selection laws (FR-MAT-010). */
import {
  DenominatorDisclosureClass,
  ErrorCode,
  MatError,
  type DenominatorDisclosureClass as DisclosureClass,
} from '@foresift/domain';

export interface DenominatorCase {
  readonly candidateId: string;
  readonly disclosureClass: DisclosureClass;
  /** Defined only for fully matured valid objective outcomes. */
  readonly successful?: boolean;
}

export type DenominatorCounts = Readonly<Record<DisclosureClass, number>>;

export interface DenominatorDisclosureReport {
  readonly eligibleCount: number;
  readonly counts: DenominatorCounts;
  readonly fullyMaturedValidCount: number;
  readonly excludedCount: number;
  readonly successCount: number;
  /** Final metric denominator; null unless the disclosure is complete. */
  readonly finalSuccessRate: number | null;
  /** Anti-gaming companion rate whose denominator remains the eligible population. */
  readonly eligiblePopulationSuccessRate: number;
  readonly complete: boolean;
  readonly disclosureRef: string;
}

function emptyCounts(): Record<DisclosureClass, number> {
  return Object.fromEntries(
    Object.values(DenominatorDisclosureClass).map((value) => [value, 0]),
  ) as Record<DisclosureClass, number>;
}

/** Assemble exactly one disclosed class for every eligible case. */
export function assembleDenominatorDisclosure(
  cases: readonly DenominatorCase[],
  disclosureRef = 'inline:denominator-disclosure',
): DenominatorDisclosureReport {
  if (!disclosureRef)
    throw new MatError(
      'denominator disclosure reference is required',
      {},
      ErrorCode.MAT_DENOMINATOR_CLASS_UNDISCLOSED,
    );
  const counts = emptyCounts();
  const seen = new Set<string>();
  let successCount = 0;
  for (const item of cases) {
    if (seen.has(item.candidateId))
      throw new MatError(
        'candidate occupies more than one denominator class',
        { candidateId: item.candidateId },
        ErrorCode.MAT_DENOMINATOR_CLASS_UNDISCLOSED,
      );
    seen.add(item.candidateId);
    if (!(item.disclosureClass in counts))
      throw new MatError(
        'eligible case has an undisclosed denominator class',
        { candidateId: item.candidateId },
        ErrorCode.MAT_DENOMINATOR_CLASS_UNDISCLOSED,
      );
    counts[item.disclosureClass] += 1;
    if (item.successful === true) {
      if (item.disclosureClass !== DenominatorDisclosureClass.FULLY_MATURED_VALID)
        throw new MatError(
          'an excluded case cannot be counted as successful',
          { candidateId: item.candidateId, disclosureClass: item.disclosureClass },
          ErrorCode.MAT_DENOMINATOR_CLASS_UNDISCLOSED,
        );
      successCount += 1;
    }
  }
  const eligibleCount = cases.length;
  const fullyMaturedValidCount = counts.FULLY_MATURED_VALID;
  const disclosedCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const complete = disclosedCount === eligibleCount;
  const finalSuccessRate =
    complete && fullyMaturedValidCount > 0 ? successCount / fullyMaturedValidCount : null;
  return Object.freeze({
    eligibleCount,
    counts: Object.freeze(counts),
    fullyMaturedValidCount,
    excludedCount: eligibleCount - fullyMaturedValidCount,
    successCount,
    finalSuccessRate,
    eligiblePopulationSuccessRate: eligibleCount === 0 ? 0 : successCount / eligibleCount,
    complete,
    disclosureRef,
  });
}

/** Refuse FINAL metrics unless all nine composition classes are present and reconcile. */
export function assertCompleteDenominatorDisclosure(
  report: DenominatorDisclosureReport,
): asserts report is DenominatorDisclosureReport & { readonly complete: true } {
  const classes = Object.values(DenominatorDisclosureClass);
  const hasAllClasses = classes.every(
    (value) =>
      Object.hasOwn(report.counts, value) &&
      Number.isInteger(report.counts[value]) &&
      report.counts[value] >= 0,
  );
  const total = classes.reduce((sum, value) => sum + (report.counts[value] ?? 0), 0);
  if (!report.complete || !hasAllClasses || total !== report.eligibleCount)
    throw new MatError(
      'final metric denominator composition is incomplete',
      { eligibleCount: report.eligibleCount, disclosedCount: total },
      ErrorCode.MAT_DENOMINATOR_CLASS_UNDISCLOSED,
    );
}

export function finalMetricRate(report: DenominatorDisclosureReport): number {
  assertCompleteDenominatorDisclosure(report);
  if (report.finalSuccessRate === null)
    throw new MatError(
      'final metric has no fully matured valid denominator',
      { eligibleCount: report.eligibleCount },
      ErrorCode.MAT_DENOMINATOR_CLASS_UNDISCLOSED,
    );
  return report.finalSuccessRate;
}

/**
 * A collection-reducing policy must preserve the eligible population and
 * successful observations. Removed observations become explicit exclusions;
 * the eligible-population rate therefore cannot increase.
 */
export function reducedCollectionCannotImprovePerformance(
  before: DenominatorDisclosureReport,
  after: DenominatorDisclosureReport,
): boolean {
  assertCompleteDenominatorDisclosure(before);
  assertCompleteDenominatorDisclosure(after);
  return (
    after.eligibleCount === before.eligibleCount &&
    after.excludedCount >= before.excludedCount &&
    after.successCount <= before.successCount &&
    after.eligiblePopulationSuccessRate <= before.eligiblePopulationSuccessRate
  );
}

export const collectionReductionCannotImprove = reducedCollectionCannotImprovePerformance;
