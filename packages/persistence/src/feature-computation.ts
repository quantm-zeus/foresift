/**
 * THE shared deterministic feature computation module (FR-DATA-004, §14.3/
 * §14.4). Both the online writer and the offline batch recomputation
 * path call these functions — parity is guaranteed by construction, not by
 * discipline. Same inputs yield byte-identical outputs, always.
 *
 * Computation is replay-honest: only events whose availability is within the
 * resolved-at boundary contribute (THE shared domain predicate), and sums are
 * exact BigInt arithmetic over raw integer amounts.
 */
import {
  compareTimestamps,
  rawAmount,
  sumRaw,
  utcTimestamp,
  visibleAt,
  type QualityCode,
  type RawAmount,
  type UtcTimestamp,
} from '@foresift/domain';

/** Identity of this computation code — stored on every produced value. */
export const ROLLING_VOLUME_CODE_VERSION = 'rolling-volume/v1';

/** Definition coordinates of the G0 reference feature. */
export const ROLLING_VOLUME_DEFINITION = {
  name: 'rolling_volume_raw_units',
  version: 1,
  unitSemantics: 'exact sum of raw integer amounts over the event-time window, replay-resolved',
} as const;

export interface FeatureComputationEvent {
  readonly eventAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  /**
   * Decimal-digit integer amount. An event with an absent or non-canonical
   * `rawAmount` still counts toward the window but is tallied under
   * `unquantifiedEvents` and flagged PARTIAL — never silently dropped.
   */
  readonly rawAmount?: string | null;
}

export interface FeatureComputationRequest {
  readonly windowStartInclusive: UtcTimestamp;
  readonly windowEndInclusive: UtcTimestamp;
  /** Replay boundary T the computation is resolved at. */
  readonly resolvedAt: UtcTimestamp;
  readonly events: readonly FeatureComputationEvent[];
}

export interface ComputedFeatureValue {
  /** Exact integer sum as decimal digits, or null when nothing was observed. */
  readonly decimalString: string | null;
  readonly scale: 0;
  /** Codes explaining absence or partial quantification (null alone is insufficient). */
  readonly qualityCodes: readonly QualityCode[];
  readonly contributingEvents: number;
  readonly unquantifiedEvents: number;
}

/**
 * Rolling raw-unit volume over [windowStart, windowEnd] by EVENT time,
 * restricted to events visible at the resolved-at boundary.
 */
export function computeRollingVolume(request: FeatureComputationRequest): ComputedFeatureValue {
  const inWindow = request.events.filter(
    (e) =>
      // Instant comparison, not lexical — mixed sub-ms precision would shift
      // the window boundary.
      compareTimestamps(e.eventAt, request.windowStartInclusive) >= 0 &&
      compareTimestamps(e.eventAt, request.windowEndInclusive) <= 0 &&
      visibleAt({ availableAt: e.availableAt }, request.resolvedAt),
  );
  if (inWindow.length === 0) {
    return {
      decimalString: null,
      scale: 0,
      qualityCodes: ['LOW_SAMPLE'],
      contributingEvents: 0,
      unquantifiedEvents: 0,
    };
  }
  const quantified: RawAmount[] = [];
  let unquantified = 0;
  for (const e of inWindow) {
    if (e.rawAmount !== null && e.rawAmount !== undefined && /^[0-9]+$/.test(e.rawAmount)) {
      quantified.push(rawAmount(e.rawAmount));
    } else {
      unquantified += 1;
    }
  }
  // Exact base-10 summation; independent of input order.
  const total = sumRaw(quantified);
  return {
    decimalString: total.toString(),
    scale: 0,
    qualityCodes: unquantified > 0 ? ['PARTIAL'] : ['VALID'],
    contributingEvents: quantified.length,
    unquantifiedEvents: unquantified,
  };
}

/** Convenience for tests/fixtures: parse a UTC string. */
export const computeAt = utcTimestamp;
