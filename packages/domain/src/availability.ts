/**
 * §13.2 availability provenance and the replay-boundary predicate (FR-DATA-003).
 *
 * `available_at` is never inferred from `event_at` — it is the earliest
 * auditable system availability, always carried with a provenance class.
 * The replay predicate below is THE single shared definition used by the
 * persistence replay repository AND the evidence resolver.
 */
import { ErrorCode, ForesiftError } from './errors.ts';
import { compareTimestamps, toEpochMs, type UtcTimestamp } from './timestamps.ts';

/** §13.2 provenance classes for every `available_at` value. */
export const AvailabilityProvenanceClass = {
  FIRST_PARTY_LIVE_OBSERVED: 'FIRST_PARTY_LIVE_OBSERVED',
  PROVIDER_LIVE_RESPONSE: 'PROVIDER_LIVE_RESPONSE',
  AUTHORIZED_PUSH_RECEIVED: 'AUTHORIZED_PUSH_RECEIVED',
  HISTORICAL_QUERY_FETCHED_LATER: 'HISTORICAL_QUERY_FETCHED_LATER',
  MANUAL_IMPORT_AVAILABLE: 'MANUAL_IMPORT_AVAILABLE',
  DERIVED_FROM_AVAILABLE_INPUTS: 'DERIVED_FROM_AVAILABLE_INPUTS',
  LEARNED_ARTIFACT_PUBLISHED: 'LEARNED_ARTIFACT_PUBLISHED',
} as const;

export type AvailabilityProvenanceClass =
  (typeof AvailabilityProvenanceClass)[keyof typeof AvailabilityProvenanceClass];

/** All classes in declaration order (§13.2). */
export const ALL_AVAILABILITY_PROVENANCE_CLASSES: readonly AvailabilityProvenanceClass[] =
  Object.values(AvailabilityProvenanceClass);

/** Fail-closed class resolution: an unknown string is a refusal, never a default. */
export function availabilityProvenanceClass(value: string): AvailabilityProvenanceClass {
  const cls = (ALL_AVAILABILITY_PROVENANCE_CLASSES as readonly string[]).includes(value)
    ? (value as AvailabilityProvenanceClass)
    : undefined;
  if (cls === undefined) {
    throw new ForesiftError(
      ErrorCode.AVAILABILITY_PROVENANCE_UNKNOWN,
      'unknown availability provenance class; refusing to default',
      { value },
    );
  }
  return cls;
}

/** True when the record entered the system through live observation/receipt paths. */
export function isLiveReceipt(cls: AvailabilityProvenanceClass): boolean {
  return (
    cls === AvailabilityProvenanceClass.FIRST_PARTY_LIVE_OBSERVED ||
    cls === AvailabilityProvenanceClass.PROVIDER_LIVE_RESPONSE ||
    cls === AvailabilityProvenanceClass.AUTHORIZED_PUSH_RECEIVED
  );
}

/** Classes eligible to backfill collector gaps without violating no-backdating. */
export function isHistoricalFetch(cls: AvailabilityProvenanceClass): boolean {
  return (
    cls === AvailabilityProvenanceClass.HISTORICAL_QUERY_FETCHED_LATER ||
    cls === AvailabilityProvenanceClass.MANUAL_IMPORT_AVAILABLE
  );
}

/** Minimal record shape the replay predicate consumes. */
export interface ReplayVisible {
  /** Earliest proven time this system could have obtained the value. */
  readonly availableAt: UtcTimestamp;
}

/**
 * The replay-boundary predicate: a record is visible at decision time `T`
 * iff `available_at <= T` (§13.1). One definition, many consumers.
 */
export function visibleAt(record: ReplayVisible, t: UtcTimestamp): boolean {
  return compareTimestamps(record.availableAt, t) <= 0;
}

/**
 * Epoch-millisecond form of the predicate, kept for future SQL-layer parity
 * checks and index construction (`WHERE available_at_ms <= :tMs`). Currently
 * unused by shipped SQL — the G0 schema has no `available_at_ms` column;
 * callers use `visibleAt` over ISO strings.
 */
export function visibleAtMs(availableAtEpochMs: number, t: UtcTimestamp): boolean {
  return availableAtEpochMs <= toEpochMs(t);
}

/**
 * Deterministic tie-break ordering for records sharing an instant: higher
 * revision first, then lexicographically greater stable key. "Availability
 * ties are resolved deterministically; they do not imply causal order" (§13.12).
 */
export interface ReplayOrderable extends ReplayVisible {
  readonly revisionNo?: number;
  readonly stableKey: string;
}

export function compareForReplayResolution(a: ReplayOrderable, b: ReplayOrderable): number {
  const byAvailability = compareTimestamps(b.availableAt, a.availableAt); // latest availability first
  if (byAvailability !== 0) return byAvailability;
  const ra = a.revisionNo ?? -1;
  const rb = b.revisionNo ?? -1;
  if (ra !== rb) return rb - ra; // highest valid revision wins
  if (a.stableKey !== b.stableKey) return a.stableKey < b.stableKey ? 1 : -1;
  return 0;
}
