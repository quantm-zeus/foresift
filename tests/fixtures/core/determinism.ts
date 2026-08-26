/**
 * Determinism + race fixtures (T801; FR-CORE-006): a fixed stepped clock and
 * small race helpers shared by engine/AC suites. Everything is inert — no
 * timers leak, no real concurrency beyond the explicit helpers.
 */

/**
 * Explicitly advanced clock: `now()` returns the current instant and every
 * `advanceSeconds` call moves it — expiry windows stay deterministic.
 */
export class FixedClock {
  private currentMs: number;
  constructor(iso: string) {
    this.currentMs = Date.parse(iso);
  }
  now(): string {
    return new Date(this.currentMs).toISOString().replace('.000Z', 'Z');
  }
  nowMs(): number {
    return this.currentMs;
  }
  advanceSeconds(seconds: number): void {
    this.currentMs += seconds * 1000;
  }
  advanceMs(ms: number): void {
    this.currentMs += ms;
  }
}

export interface RaceOutcome<T> {
  readonly winner: T | undefined;
  readonly losers: number;
  readonly errors: unknown[];
}

/**
 * Fire N async contenders at one resource simultaneously and collect who
 * won. Suites assert exactly-one-winner semantics for leases/reservations.
 */
export async function raceContenders<T>(
  contenderCount: number,
  contender: (index: number) => Promise<T>,
): Promise<RaceOutcome<T>> {
  const outcomes = await Promise.allSettled(
    Array.from({ length: contenderCount }, (_, index) => contender(index)),
  );
  let winner: T | undefined;
  let losers = 0;
  const errors: unknown[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') {
      if (winner === undefined) winner = outcome.value;
      else losers += 1;
    } else {
      losers += 1;
      errors.push(outcome.reason);
    }
  }
  return { winner, losers, errors };
}

/** Barrier: resolves once all promises have their result (success or not). */
export async function settleAll<T>(promises: readonly Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(promises);
}
