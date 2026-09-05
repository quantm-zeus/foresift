/**
 * §64.8 action-delay distributions and the robust-delay gate.
 *
 * Every delay profile is versioned and explicit: a deterministic reference,
 * p50, p90, and the maximum supported delay, each with a measurement source
 * and sample size. Where no empirical sample exists, conservative configured
 * values are used and LABELED as such — never presented as measured. A
 * candidate valid only at an unrealistically short delay cannot pass a
 * profile requiring p90 robustness.
 *
 * Traces: FR-EXEC-001, FR-EXEC-002, FR-EXEC-017, AC-235.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';

/** How a delay point was established. */
export type DelayMeasurementSource =
  /** Observed from empirical user-action samples. */
  | 'EMPIRICAL_SAMPLE'
  /** Conservative configured value, labeled (no empirical sample exists). */
  | 'CONSERVATIVE_CONFIGURED'
  /** Fixed system constant (e.g. one-slot reference). */
  | 'SYSTEM_CONSTANT';

export interface DelayPoint {
  readonly slots: number;
  readonly measurementSource: DelayMeasurementSource;
  /** Sample size behind an EMPIRICAL_SAMPLE point (null otherwise). */
  readonly sampleSize: number | null;
}

export interface ActionDelayProfile {
  readonly profileVersion: string;
  /** Deterministic reference delay used for reproducible replay. */
  readonly deterministicReference: DelayPoint;
  readonly p50: DelayPoint;
  readonly p90: DelayPoint;
  /** Largest delay the profile still supports for robustness gating. */
  readonly maximumSupportedDelay: DelayPoint;
}

export interface ResolveDelayProfileInput {
  readonly profileVersion: string;
  readonly deterministicReferenceSlots: number;
  readonly p50Slots: number;
  readonly p90Slots: number;
  readonly maximumSupportedDelaySlots: number;
  readonly measurementSource: DelayMeasurementSource;
  /** Required for EMPIRICAL_SAMPLE; must be a positive integer. */
  readonly sampleSize?: number;
}

function requireSlotCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'DELAY_SLOTS_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

function buildPoint(
  slots: number,
  label: string,
  measurementSource: DelayMeasurementSource,
  sampleSize?: number,
): DelayPoint {
  requireSlotCount(slots, label);
  if (measurementSource === 'EMPIRICAL_SAMPLE') {
    if (!Number.isInteger(sampleSize) || (sampleSize ?? 0) <= 0) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
        refused: 'DELAY_SAMPLE_SIZE_MISSING',
        field: label,
      });
    }
    return { slots, measurementSource, sampleSize: sampleSize ?? null };
  }
  return { slots, measurementSource, sampleSize: null };
}

/**
 * Resolve a fully-labeled versioned delay profile. Ordering law: p50 ≤ p90 ≤
 * maximumSupportedDelay; the deterministic reference may sit anywhere at or
 * below p50 (it is the reproducibility anchor, not a robustness claim).
 */
export function resolveActionDelayProfile(
  input: ResolveDelayProfileInput,
): ActionDelayProfile {
  if (typeof input.profileVersion !== 'string' || input.profileVersion.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'DELAY_PROFILE_VERSION_INVALID',
    });
  }
  const p50 = buildPoint(input.p50Slots, 'p50', input.measurementSource, input.sampleSize);
  const p90 = buildPoint(input.p90Slots, 'p90', input.measurementSource, input.sampleSize);
  const max = buildPoint(
    input.maximumSupportedDelaySlots,
    'maximumSupportedDelay',
    input.measurementSource,
    input.sampleSize,
  );
  const reference = buildPoint(
    input.deterministicReferenceSlots,
    'deterministicReference',
    'SYSTEM_CONSTANT',
  );
  if (p90.slots < p50.slots || max.slots < p90.slots) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'DELAY_ORDERING_INVALID',
      p50: p50.slots,
      p90: p90.slots,
      maximumSupportedDelay: max.slots,
    });
  }
  return {
    profileVersion: input.profileVersion,
    deterministicReference: reference,
    p50,
    p90,
    maximumSupportedDelay: max,
  };
}

/** A candidate's survival across the required delay points. */
export interface DelayGateResult {
  readonly passed: boolean;
  /** The gate operates at the profile's required quantile. */
  readonly evaluatedAt: 'P50' | 'P90';
  readonly delaySlots: number;
  readonly labeledSource: DelayMeasurementSource;
}

export interface RobustDelayGateInput {
  readonly profile: ActionDelayProfile;
  /** Quantile the profile requires the candidate to survive at. */
  readonly requires: 'P50' | 'P90';
  /** Candidate survives at this delay (slots)? */
  readonly survivesAtSlots: (slots: number) => boolean;
}

/**
 * Robust-delay gate (§64.8): a candidate valid only at an unrealistically
 * short delay cannot pass a profile requiring p90 robustness. A missing
 * survival result is a FAILURE — absence of evidence is not robustness.
 */
export function robustDelayGate(input: RobustDelayGateInput): DelayGateResult {
  const point = input.requires === 'P90' ? input.profile.p90 : input.profile.p50;
  let survives: boolean;
  try {
    survives = input.survivesAtSlots(point.slots) === true;
  } catch {
    survives = false;
  }
  return {
    passed: survives,
    evaluatedAt: input.requires,
    delaySlots: point.slots,
    labeledSource: point.measurementSource,
  };
}
