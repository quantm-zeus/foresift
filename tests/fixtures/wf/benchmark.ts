/**
 * AC-060 benchmark constants and percentile helper (T030/T037).
 *
 * The budgets are quoted from the authoritative PRD §33.1 latency table:
 * - "Schedule trigger acknowledgement | < 2 seconds"; and
 * - the internal-overhead class ("provider-backed atomic tool p95 |
 *   provider latency + < 250 ms internal overhead"), which bounds the
 *   inbox → run → checkpoint hot path this package owns.
 *
 * `percentile` is the nearest-rank p95 over the measured samples. Both suites
 * assert against REAL samples from a measured loop, never a recomputed
 * constant.
 */

/** PRD §33.1: schedule trigger acknowledgement < 2 s. */
export const WF_TRIGGER_ACK_P95_BUDGET_MS = 2000;

/** PRD §33.1 internal-overhead class: < 250 ms internal overhead. */
export const WF_HOT_PATH_P95_BUDGET_MS = 250;

/** Iterations per measured region; matches the shared AC-060 benchmark size. */
export const WF_BENCHMARK_ITERATIONS = 20;

/**
 * Nearest-rank percentile over a non-empty sample list (0 < p <= 1). The input
 * is not mutated. Throws on an empty list so an empty loop can never look like
 * a passing measurement.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('percentile requires at least one sample');
  if (!(p > 0 && p <= 1)) throw new Error(`percentile p must be in (0, 1], got ${p}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const value = sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
  if (value === undefined) throw new Error('percentile rank resolved no sample');
  return value;
}
