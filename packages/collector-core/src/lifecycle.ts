/**
 * Partition reconnect-lifecycle primitives (FR-COL-004, FR-COL-009).
 *
 * Deterministic exponential backoff with a hard upper bound. The AGY-authored
 * lifecycle substrate imports `computeReconnectBackoff` from this module; the
 * seeded, jitter-capable policy path (`boundedReconnectDelay`) lives in
 * `connection-lifecycle.ts` and is the production connection manager's
 * source of truth. Restored from checkpoint lane core (wave 9cf2bf57).
 */

/** Hard ceiling for any computed reconnect delay (60s). */
export const RECONNECT_BACKOFF_MAX_MS = 30_000;

/** Base delay for the first reconnect attempt (1s). */
export const RECONNECT_BACKOFF_BASE_MS = 1_000;

/**
 * Deterministic, monotonically non-decreasing, bounded reconnect backoff:
 * `min(base * 2^attempt, MAX)`. Pure — same attempt, same delay, forever.
 */
export function computeReconnectBackoff(attempt: number): number {
  const a = Math.max(0, Math.floor(Number(attempt) || 0));
  return Math.min(RECONNECT_BACKOFF_MAX_MS, RECONNECT_BACKOFF_BASE_MS * 2 ** Math.min(a, 16));
}
