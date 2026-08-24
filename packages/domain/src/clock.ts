/**
 * Clock port (Constitution XI/XIII — deterministic verification, replayable
 * recovery): time is injected, never read from the wall inside deterministic
 * paths. Production supplies a real clock; tests and drills supply scripted
 * timelines so replay/RPO measurements are exact.
 */
import { toEpochMs, type UtcTimestamp } from './timestamps.ts';

export interface ClockPort {
  /** Current instant as a validated UTC timestamp. */
  now(): UtcTimestamp;
  /** Current instant in epoch milliseconds. */
  nowEpochMs(): number;
}

/** Fixed clock for tests/drills: returns a constant instant. */
export function fixedClock(at: UtcTimestamp): ClockPort {
  // Routed through the validating parser so an unorderable timestamp
  // (e.g. a leap-second assertion) refuses here instead of yielding NaN.
  const epoch = toEpochMs(at);
  return {
    now: () => at,
    nowEpochMs: () => epoch,
  };
}

export interface ScriptedClock {
  readonly clock: ClockPort;
  /** Move to the next timeline entry (stays on the last entry when exhausted). */
  advance(): void;
  /**
   * Current position in the supplied timeline. RAW cursor semantics: after
   * exhaustion `advance()` keeps incrementing past the last entry (reads stay
   * clamped to it, but `index()` reports the unclamped position).
   */
  index(): number;
}

/**
 * Scripted clock stepping through a supplied timeline of instants; each
 * `advance()` moves to the next entry, repeating the final one at the end.
 * Enables deterministic multi-step RPO/RTO measurement.
 */
export function scriptedClock(timeline: readonly UtcTimestamp[]): ScriptedClock {
  if (timeline.length === 0) throw new RangeError('scriptedClock timeline must not be empty');
  let i = 0;
  const current = (): UtcTimestamp => {
    const at = timeline[Math.min(i, timeline.length - 1)];
    if (at === undefined) throw new RangeError('scriptedClock timeline entry missing');
    return at;
  };
  return {
    clock: {
      now: () => current(),
      nowEpochMs: () => toEpochMs(current()),
    },
    advance: () => {
      i += 1;
    },
    index: () => i,
  };
}
