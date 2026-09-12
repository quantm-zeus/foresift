/**
 * Shared inert primitives for the alert fixture corpus (T027).
 *
 * These are deterministic local test constants only: no credentials, no
 * network, no database, no clock reads. Content addresses are built with
 * `'a'.repeat(64)` rather than a literal 64-hex run so the fixture corpus never
 * trips the prohibited-capability hex/context heuristic.
 *
 * The milestone writeScope grants `tests/fixtures/alerts/**`; the requirements
 * manifest's `fixtureRef` names the singular `tests/fixtures/alert/`. The plural
 * path is the sanctioned one; `index.ts` documents the alias.
 */

/** Deterministic decision-ready/detected instant for every fixture. */
export const ALERT_FIXTURE_T0 = '2026-06-01T12:00:00.000Z' as const;
/** A `valid_until` comfortably past T0 (no expiring window at T0). */
export const ALERT_FIXTURE_VALID_UNTIL = '2026-06-01T13:00:00.000Z' as const;
/** Inside the trailing 300s actionability window before `VALID_UNTIL`. */
export const ALERT_FIXTURE_EXPIRING_AT = '2026-06-01T12:58:00.000Z' as const;
/** Past `VALID_UNTIL`: the prior alert is no longer actionable. */
export const ALERT_FIXTURE_EXPIRED_AT = '2026-06-01T13:30:00.000Z' as const;
/** A decision-ready instant that already blew a short delivery budget. */
export const ALERT_FIXTURE_STALE_AT = '2026-06-01T11:59:00.000Z' as const;
/** End of a recorded cooldown window after a delivered alert. */
export const ALERT_FIXTURE_COOLDOWN_UNTIL = '2026-06-01T13:05:00.000Z' as const;

/** Inclusive metric-observation window used by the per-class metric fixtures. */
export const ALERT_FIXTURE_WINDOW_START = '2026-05-01T00:00:00.000Z' as const;
export const ALERT_FIXTURE_WINDOW_END = '2026-06-01T00:00:00.000Z' as const;

/**
 * The fixture-declared default class TTLs (PRD §26.2/§26.3). Consumers assert
 * the registry against these values, so a silent default-TTL change fails the
 * fixture-driven suites.
 */
export const ALERT_FIXTURE_EARLY_WATCH_TTL = 900 as const;
export const ALERT_FIXTURE_CONFIRMED_TTL = 3600 as const;

/** Distinct `sha256:<hex>` content addresses, built without literal hex runs. */
export const ALERT_HASH_A = `sha256:${'a'.repeat(64)}` as const;
export const ALERT_HASH_B = `sha256:${'b'.repeat(64)}` as const;
export const ALERT_HASH_C = `sha256:${'c'.repeat(64)}` as const;
export const ALERT_HASH_D = `sha256:${'d'.repeat(64)}` as const;

/** Recursively freeze a JSON-shaped fixture value. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * A structural clone used by fixtures that must hand a mutable copy to a
 * builder (so a frozen canonical fixture can never be mutated by a consumer).
 */
export function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
