/** Drift/calibration controls with automatic utility degradation (FR-EVAL-008). */
import { DriftControlKind, type DriftControlKind as DriftKind } from '@foresift/domain';

export interface DriftAssessment {
  readonly kind: DriftKind;
  readonly statistic: number;
  readonly registeredThreshold: number;
  readonly expectedNetUtility: number;
  readonly degradationFraction: number;
}

export interface DriftResult extends DriftAssessment {
  readonly detected: boolean;
  readonly adjustedExpectedNetUtility: number;
  readonly response: 'NONE' | 'DEGRADE_CONFIDENCE' | 'REQUIRE_RECALIBRATION';
}

export function evaluateDrift(input: DriftAssessment): DriftResult {
  const detected = Number.isFinite(input.statistic) && Number.isFinite(input.registeredThreshold) &&
    Math.abs(input.statistic) >= input.registeredThreshold;
  const utilitySensitive = input.kind === DriftControlKind.CALIBRATION_DRIFT ||
    input.kind === DriftControlKind.REGIME_DRIFT;
  const fraction = detected && utilitySensitive
    ? Math.min(1, Math.max(0, input.degradationFraction))
    : 0;
  return Object.freeze({
    ...input,
    detected,
    adjustedExpectedNetUtility: input.expectedNetUtility * (1 - fraction),
    response: detected
      ? utilitySensitive ? 'REQUIRE_RECALIBRATION' : 'DEGRADE_CONFIDENCE'
      : 'NONE',
  });
}
