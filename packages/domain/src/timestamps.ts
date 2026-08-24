/**
 * §13.1 required timestamps, UTC policy, and precision retention (FR-DATA-003).
 *
 * All timestamps are UTC internally; timezone is presentation metadata only
 * (§11.5). Source precision is retained by keeping the original ISO-8601 UTC
 * string; ordering uses parsed epoch milliseconds with deterministic tie-breaking.
 */
import { ErrorCode, ForesiftError } from './errors.ts';

declare const brand: unique symbol;

/** A validated ISO-8601 UTC timestamp string (ends in `Z`). Branded. */
export type UtcTimestamp = string & { readonly [brand]: 'UtcTimestamp' };

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
// prettier-ignore
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Strict validation: real calendar date, real time-of-day, UTC `Z` suffix.
 * One shape-level exception: `second === 60` is admitted as a leap-second
 * assertion — see `toEpochMs`, which refuses it at ordering time because
 * ECMAScript cannot parse it.
 */
export function isValidUtcTimestamp(value: string): boolean {
  const match = ISO_UTC_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  let maxDay = DAYS_IN_MONTH[month - 1];
  if (maxDay === undefined) return false;
  if (month === 2 && isLeapYear(year)) maxDay = 29;
  if (day > maxDay) return false;
  if (hour > 23 || minute > 59 || second > 60) return false; // 60 allows a leap second assertion
  return true;
}

/** Parse a UTC timestamp or throw `TIMESTAMP_INVALID`. Never accepts non-UTC forms. */
export function utcTimestamp(value: string): UtcTimestamp {
  if (!isValidUtcTimestamp(value)) {
    throw new ForesiftError(
      ErrorCode.TIMESTAMP_INVALID,
      `expected an ISO-8601 UTC timestamp ending in Z, got ${JSON.stringify(value)}`,
      { value },
    );
  }
  return value as UtcTimestamp;
}

/** Type guard form for external input that may be absent. */
export function isUtcTimestamp(value: unknown): value is UtcTimestamp {
  return typeof value === 'string' && isValidUtcTimestamp(value);
}

/**
 * Epoch milliseconds. Sub-millisecond source precision stays in the original
 * string; ordering below never depends on it.
 *
 * Known exception, accepted deliberately: validation admits `second === 60`
 * (a leap-second assertion), but ECMAScript engines have no representation
 * for it — `Date.parse('…:60Z')` yields NaN. Such strings therefore pass
 * `isValidUtcTimestamp` yet throw TIMESTAMP_INVALID here when first ordered.
 * Producers asserting leap seconds must normalize them (e.g. to `:60.5`-free
 * `:59.999…Z`-style instants) before handing them to ordering code paths.
 */
export function toEpochMs(t: UtcTimestamp): number {
  const ms = Date.parse(t);
  // NaN here means a leap-second assertion (see above) or an engine bug —
  // never silently coerce; fail closed with the typed refusal.
  if (Number.isNaN(ms)) {
    throw new ForesiftError(
      ErrorCode.TIMESTAMP_INVALID,
      'unparseable despite valid shape (leap-second assertions are not orderable)',
      {
        value: t,
      },
    );
  }
  return ms;
}

/** Total order on instants: epoch first, then longer fraction strings (more precision) last. */
export function compareTimestamps(a: UtcTimestamp, b: UtcTimestamp): number {
  const d = toEpochMs(a) - toEpochMs(b);
  if (d !== 0) return d < 0 ? -1 : 1;
  // Same millisecond: order by fractional digits so precision is stable/deterministic.
  const fa = fractionDigits(a);
  const fb = fractionDigits(b);
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function fractionDigits(t: UtcTimestamp): number {
  const dot = t.indexOf('.');
  return dot === -1 ? 0 : t.length - dot - 1 - 1; // minus the trailing Z
}

export interface TimestampComparisonResult {
  readonly before: boolean;
  readonly atOrBefore: boolean;
  readonly after: boolean;
  readonly atOrAfter: boolean;
}

/** Compare one instant against another with named outcomes. */
export function compareTo(t: UtcTimestamp, than: UtcTimestamp): TimestampComparisonResult {
  const c = compareTimestamps(t, than);
  return {
    before: c < 0,
    atOrBefore: c <= 0,
    after: c > 0,
    atOrAfter: c >= 0,
  };
}

/**
 * §13.1 required timestamp set for an external observation. Every field is the
 * earliest proven time of its kind; absent fields are genuinely inapplicable
 * (`undefined` under exactOptionalPropertyTypes — never null standing in for
 * "we did not look").
 */
export interface ObservationTimestamps {
  /** When the chain/market/social event occurred. */
  readonly eventAt: UtcTimestamp;
  /** Timestamp asserted by the source. */
  readonly sourceObservedAt?: UtcTimestamp;
  /** Earliest proven publication time at the source. */
  readonly sourcePublishedAt?: UtcTimestamp;
  /** Earliest proven time this running system could have obtained the value. */
  readonly availableAt: UtcTimestamp;
  /** Time entitlement/access permitted retrieval, when relevant. */
  readonly authorizedAt?: UtcTimestamp;
  /** Time the acquisition policy requested the data. */
  readonly requestedAt?: UtcTimestamp;
  /** Time the provider/collector request completed. */
  readonly fetchedAt?: UtcTimestamp;
  /** Time the record committed to durable storage. */
  readonly ingestedAt?: UtcTimestamp;
  /** Time the chain event reached configured finality. */
  readonly finalizedAt?: UtcTimestamp;
  /** Time a source correction became available. */
  readonly revisedAt?: UtcTimestamp;
}

/**
 * §13.7 decision/action timestamp record. Stored for every evaluated candidate
 * including alerted, watched, ignored, rejected, challenger, control, and
 * missed-opportunity cases. `alertDeliveredAt` is nullable because non-delivery
 * is a fact; `counterfactualDeliveryAt` is required so non-delivered arms enter
 * comparisons symmetrically (AC-240).
 */
export interface DecisionActionTimestamps {
  readonly discoveredAt: UtcTimestamp;
  readonly evidenceMinimumReadyAt: UtcTimestamp;
  readonly decisionReadyAt: UtcTimestamp;
  readonly workflowCompletedAt: UtcTimestamp;
  readonly policyDecidedAt: UtcTimestamp;
  readonly outboxCommittedAt: UtcTimestamp;
  readonly alertDeliveredAt: UtcTimestamp | null;
  readonly counterfactualDeliveryAt: UtcTimestamp;
  readonly validUntil: UtcTimestamp;
  readonly expiredAt: UtcTimestamp | null;
}

/**
 * Symmetric action-time check substrate (AC-240): a non-delivered arm must not
 * receive an earlier entry than its counterfactual delivery time. This is the
 * storage-layer half of the universal decision/action-time function; the
 * function itself belongs to evaluation packages.
 */
export function entryIsNotEarlierThanCounterfactual(
  candidateEntryAt: UtcTimestamp,
  counterfactualDeliveryAt: UtcTimestamp,
): boolean {
  return compareTimestamps(candidateEntryAt, counterfactualDeliveryAt) >= 0;
}
