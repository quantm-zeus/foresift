/**
 * §64.13 / FR-EXEC-004 executable-target law (AC-122, AC-126).
 *
 * A modeled exit touching its target counts toward tradable success only
 * when the touch is executable: it executes within the scenario's impact,
 * fill, duration, and state-completeness limits, and the profile's evidence
 * requirements (multiple slot touches, configured target duration,
 * sufficient economic volume) are met. An isolated wick — a single touch
 * with no executable volume or duration support — is never sufficient.
 *
 * Low-resolution snapshots (AC-126) support signal labels only: when the
 * observed resolution is below the profile's resolution floor, the result
 * cannot prove tradable success and must carry an observation plan.
 *
 * Traces: FR-EXEC-004, FR-EXEC-007, AC-122, AC-126, AC-235.
 */
import { ExecErrorCode, ExecVocabularyError, executableTargetSatisfied } from '@foresift/domain';
import type { ExecutableTargetInput } from '@foresift/domain';

export type { ExecutableTargetInput };

/** Resolution floor a profile may declare for executable-target evidence. */
export interface ResolutionFloor {
  /** Minimum number of distinct slot touches required (1 = single touch ok). */
  readonly minimumSlotTouches: number;
  /** Minimum configured target-duration support in seconds (0 = none). */
  readonly minimumTargetDurationSeconds: number;
  /** Minimum economic volume around the target in USD decimal string. */
  readonly minimumExecutableVolumeUsd: string;
}

export interface TargetTouchInput {
  /** The price path touched the target at least once. */
  readonly touched: boolean;
  /** Distinct slots with a touch (deduplicated by the caller). */
  readonly touchSlots: readonly number[];
  /** Executable volume observed around the target (USD decimal string). */
  readonly executableVolumeUsd: string;
  /** Configured target-duration support observed, in seconds. */
  readonly targetDurationSeconds: number;
  /** The profile's resolution floor for this target. */
  readonly resolutionFloor: ResolutionFloor;
  /** State completeness of the snapshots the touches were read from. */
  readonly stateComplete: boolean;
}

export interface TargetTouchResult {
  /** §64.13: the touch evidence satisfies the executable-target law. */
  readonly satisfied: boolean;
  /** AC-122: the only touch evidence is an isolated wick. */
  readonly isolatedWick: boolean;
  /** AC-126: resolution below the floor — signal-only evidence. */
  readonly resolutionBelowFloor: boolean;
  /** True when the evidence may support a tradable (not signal-only) label. */
  readonly supportsTradableLabel: boolean;
  /** Machine-readable refusal when unsatisfied. */
  readonly refusal: string | null;
}

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

function requireDecimal(value: string, label: string): string {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_TARGET_INPUT_INVALID, {
      refused: 'TARGET_FIELD_INVALID',
      field: label,
      value,
    });
  }
  return value;
}

function decimalCompare(a: string, b: string): number {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const scale = Math.max(af.length, bf.length);
  const av = BigInt(ai + af.padEnd(scale, '0'));
  const bv = BigInt(bi + bf.padEnd(scale, '0'));
  return av === bv ? 0 : av > bv ? 1 : -1;
}

/**
 * Evaluate a target touch against the §64.13 executable-target law and the
 * profile's resolution floor. Fail-closed: malformed evidence refuses.
 */
export function evaluateTargetTouch(input: TargetTouchInput): TargetTouchResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_TARGET_INPUT_INVALID, input);
  }
  const floor = input.resolutionFloor;
  if (floor === null || typeof floor !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_TARGET_INPUT_INVALID, {
      refused: 'TARGET_FIELD_INVALID',
      field: 'resolutionFloor',
    });
  }
  requireDecimal(input.executableVolumeUsd, 'executableVolumeUsd');
  requireDecimal(floor.minimumExecutableVolumeUsd, 'minimumExecutableVolumeUsd');
  if (
    !Number.isInteger(floor.minimumSlotTouches) ||
    floor.minimumSlotTouches < 1 ||
    !Number.isInteger(floor.minimumTargetDurationSeconds) ||
    floor.minimumTargetDurationSeconds < 0 ||
    !Number.isInteger(input.targetDurationSeconds) ||
    input.targetDurationSeconds < 0
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_TARGET_INPUT_INVALID, {
      refused: 'TARGET_FIELD_INVALID',
      field: 'resolutionFloor|targetDurationSeconds',
    });
  }
  if (typeof input.touched !== 'boolean' || typeof input.stateComplete !== 'boolean') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_TARGET_INPUT_INVALID, {
      refused: 'TARGET_FIELD_INVALID',
      field: 'touched|stateComplete',
    });
  }
  if (!Array.isArray(input.touchSlots) || input.touchSlots.some((s) => !Number.isInteger(s))) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_TARGET_INPUT_INVALID, {
      refused: 'TARGET_FIELD_INVALID',
      field: 'touchSlots',
    });
  }

  const distinctSlots = new Set(input.touchSlots);
  const volumeSufficient =
    decimalCompare(input.executableVolumeUsd, floor.minimumExecutableVolumeUsd) >= 0;
  const durationSufficient = input.targetDurationSeconds >= floor.minimumTargetDurationSeconds;

  const isolatedWick =
    input.touched && distinctSlots.size === 1 && !volumeSufficient && !durationSufficient;

  const domainInput: ExecutableTargetInput = {
    touched: input.touched,
    executableVolumeObserved: volumeSufficient,
    targetDurationSupported: durationSufficient,
    isolatedWick,
  };
  const satisfied = executableTargetSatisfied(domainInput) && input.stateComplete;

  // AC-126: below the resolution floor the evidence supports signal labels
  // only — never a tradable confirmation.
  const resolutionBelowFloor =
    distinctSlots.size < floor.minimumSlotTouches || !volumeSufficient || !durationSufficient;

  let refusal: string | null = null;
  if (!input.touched) refusal = 'TARGET_NEVER_TOUCHED';
  else if (isolatedWick) refusal = 'ISOLATED_WICK_INSUFFICIENT_VOLUME_OR_DURATION';
  else if (!input.stateComplete) refusal = 'CONFIRMED_TRADABILITY_BLOCKED';
  else if (!satisfied) refusal = 'INSUFFICIENT_EXECUTABLE_VOLUME_OR_DURATION';

  return {
    satisfied,
    isolatedWick,
    resolutionBelowFloor,
    supportsTradableLabel: satisfied && !resolutionBelowFloor,
    refusal,
  };
}

/**
 * AC-126 helper: a low-resolution snapshot may render a signal label but can
 * never prove tradable success. Returns the rendering policy for this touch
 * result: signal-only requires an observation plan before any tradable claim.
 */
export function renderingPolicyFor(
  result: TargetTouchResult,
): 'SIGNAL_ONLY_LOW_RESOLUTION' | 'TRADABLE_EVIDENCE' | 'NO_EVIDENCE' {
  if (!result.satisfied) return 'NO_EVIDENCE';
  return result.resolutionBelowFloor ? 'SIGNAL_ONLY_LOW_RESOLUTION' : 'TRADABLE_EVIDENCE';
}
