/**
 * §64.15 / FR-EXEC-020 uncertainty rendering (AC-235).
 *
 * Quote and reference sources are evidence, not execution truth. Every
 * rendered simulation record exposes the uncertainty the model operated
 * under: state coverage, adapter versions, evaluated notional/delays,
 * base + stress outcomes, fill fraction and duration, fees + impact, the
 * relative uncertainty bound with its quality codes, unsupported
 * assumptions, and a valid_until expiry. A bound crossing the profile's
 * policy limit blocks confirmed tradability.
 *
 * Traces: FR-EXEC-020, AC-235.
 */
import {
  ExecErrorCode,
  ExecVocabularyError,
  isQualityCode,
  uncertaintyBlocksTradability,
} from '@foresift/domain';
import type { QualityCode, UncertaintyAssessment } from '@foresift/domain';
import type { UncertaintyBound } from '@foresift/shared-schemas';

export type { UncertaintyAssessment };

/** §64.15 rendering set for a simulation's uncertainty exposure. */
export interface UncertaintyRenderingInput {
  /** §64.4 snapshot completeness the simulation ran against. */
  readonly stateCompleteness: 'COMPLETE' | 'INCOMPLETE_BLOCKING';
  /** Relative uncertainty bound in [0,1]; null when none was established. */
  readonly relativeUncertainty: number | null;
  /** Profile-declared policy limit in [0,1]. */
  readonly policyLimit: number;
  /** §13.9 quality codes backing the bound (null alone is insufficient). */
  readonly qualityCodes: readonly QualityCode[];
  /** Adapter ids/versions that produced the modeled quotes. */
  readonly adapterVersions: readonly string[];
  /** Evaluated notional (USD decimal string). */
  readonly notionalUsd: string;
  /** Evaluated deterministic action delay (seconds). */
  readonly actionDelaySeconds: number;
  /** Base-case outcome label (net return USD decimal string). */
  readonly baseCaseNetReturnUsd: string;
  /** Conservative stress-case outcome label (net return USD decimal string). */
  readonly stressCaseNetReturnUsd: string;
  /** Fill fraction achieved under the conservative case. */
  readonly fillFraction: number;
  /** Fill duration in seconds. */
  readonly fillDurationSeconds: number;
  /** Modeled fee + impact summary (USD decimal strings). */
  readonly modeledFeesUsd: string;
  readonly modeledImpactUsd: string;
  /** Assumptions the model could not support with evidence. */
  readonly unsupportedAssumptions: readonly string[];
  /** Rendering instant (ISO-8601 Z). */
  readonly renderedAt: string;
  /** Expiry instant (ISO-8601 Z) — after this the record is stale evidence. */
  readonly validUntil: string;
}

export interface UncertaintyRendering {
  readonly bound: UncertaintyBound | null;
  readonly adapterVersions: readonly string[];
  readonly notionalUsd: string;
  readonly actionDelaySeconds: number;
  readonly baseCaseNetReturnUsd: string;
  readonly stressCaseNetReturnUsd: string;
  readonly fillFraction: number;
  readonly fillDurationSeconds: number;
  readonly modeledFeesUsd: string;
  readonly modeledImpactUsd: string;
  readonly unsupportedAssumptions: readonly string[];
  readonly renderedAt: string;
  readonly validUntil: string;
  /** FR-EXEC-020: the bound crosses the policy limit — tradability blocked. */
  readonly blocked: boolean;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * Render the §64.15 uncertainty record and evaluate the FR-EXEC-020
 * policy-limit gate. Fail-closed: an absent bound with COMPLETE state still
 * blocks (no established bound = unknown = blocked for confirmation).
 */
export function renderUncertainty(input: UncertaintyRenderingInput): UncertaintyRendering {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, input);
  }
  if (input.stateCompleteness !== 'COMPLETE' && input.stateCompleteness !== 'INCOMPLETE_BLOCKING') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_STATE_COMPLETENESS_INVALID',
      value: input.stateCompleteness,
    });
  }
  if (
    typeof input.policyLimit !== 'number' ||
    !Number.isFinite(input.policyLimit) ||
    input.policyLimit < 0 ||
    input.policyLimit > 1
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_POLICY_LIMIT_INVALID',
      value: input.policyLimit,
    });
  }
  if (input.qualityCodes.length === 0) {
    // §13.9: null alone is insufficient — a rendered bound carries codes.
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_QUALITY_CODES_REQUIRED',
    });
  }
  for (const code of input.qualityCodes) {
    if (!isQualityCode(code)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
        refused: 'UNCERTAINTY_QUALITY_CODE_UNKNOWN',
        code,
      });
    }
  }
  const incompleteState = input.stateCompleteness === 'INCOMPLETE_BLOCKING';
  const boundValue: number | null =
    incompleteState &&
    (typeof input.relativeUncertainty !== 'number' || !Number.isFinite(input.relativeUncertainty))
      ? // Incomplete state must state a bound — unknown uncertainty is
        // rendered as maximal (1.0) rather than left absent.
        1
      : input.relativeUncertainty;
  if (
    boundValue !== null &&
    (typeof boundValue !== 'number' ||
      !Number.isFinite(boundValue) ||
      boundValue < 0 ||
      boundValue > 1)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_BOUND_OUT_OF_BOUNDS',
      value: boundValue,
    });
  }
  if (!ISO_Z.test(input.renderedAt) || !ISO_Z.test(input.validUntil)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_TIMESTAMP_INVALID',
    });
  }
  if (Date.parse(input.validUntil) <= Date.parse(input.renderedAt)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_VALID_UNTIL_MUST_FOLLOW_RENDER',
    });
  }
  if (
    !DECIMAL.test(input.notionalUsd) ||
    !DECIMAL.test(input.baseCaseNetReturnUsd) ||
    !DECIMAL.test(input.stressCaseNetReturnUsd) ||
    !DECIMAL.test(input.modeledFeesUsd) ||
    !DECIMAL.test(input.modeledImpactUsd)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_DECIMAL_FIELD_INVALID',
    });
  }
  if (
    typeof input.fillFraction !== 'number' ||
    !Number.isFinite(input.fillFraction) ||
    input.fillFraction < 0 ||
    input.fillFraction > 1
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_FILL_FRACTION_INVALID',
      value: input.fillFraction,
    });
  }
  if (!Array.isArray(input.adapterVersions) || input.adapterVersions.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID, {
      refused: 'UNCERTAINTY_ADAPTER_VERSIONS_REQUIRED',
    });
  }

  const assessment: UncertaintyAssessment = {
    stateComplete: input.stateCompleteness === 'COMPLETE',
    parityVerified:
      input.stateCompleteness === 'COMPLETE' && input.unsupportedAssumptions.length === 0,
    uncertaintyBound: boundValue,
    policyLimit: input.policyLimit,
  };
  const blocked = uncertaintyBlocksTradability(assessment);

  const bound: UncertaintyBound | null =
    boundValue === null
      ? null
      : {
          stateCompleteness: input.stateCompleteness,
          relativeUncertainty: boundValue,
          policyLimit: input.policyLimit,
          qualityCodes: [...input.qualityCodes],
        };

  return {
    bound,
    adapterVersions: [...input.adapterVersions],
    notionalUsd: input.notionalUsd,
    actionDelaySeconds: input.actionDelaySeconds,
    baseCaseNetReturnUsd: input.baseCaseNetReturnUsd,
    stressCaseNetReturnUsd: input.stressCaseNetReturnUsd,
    fillFraction: input.fillFraction,
    fillDurationSeconds: input.fillDurationSeconds,
    modeledFeesUsd: input.modeledFeesUsd,
    modeledImpactUsd: input.modeledImpactUsd,
    unsupportedAssumptions: [...input.unsupportedAssumptions],
    renderedAt: input.renderedAt,
    validUntil: input.validUntil,
    blocked,
  };
}
