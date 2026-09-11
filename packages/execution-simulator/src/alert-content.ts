/**
 * FR-EXEC-008 alert execution content (§64.15 rendering set, AC-120/AC-230).
 *
 * An execution alert exposes exactly the configured, modeled inputs — the
 * configured notional, the action delay, the modeled entry/exit impact, the
 * assumption references with their hash, and an expiry after which the
 * content is stale — and nothing that could be mistaken for an execution
 * instruction. Rendered content carries no order, no route transaction, no
 * signature request, and no wallet surface.
 *
 * Traces: FR-EXEC-008, FR-EXEC-015, AC-120, AC-230.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';
import type { AlertExecutionContent } from '@foresift/shared-schemas';

export type { AlertExecutionContent };

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SHA256_REF = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export interface RenderAlertContentInput {
  readonly alertId: string;
  readonly candidateId: string;
  readonly configuredNotionalUsd: string;
  readonly actionDelaySeconds: number;
  readonly modeledEntryImpact: number;
  readonly modeledExitImpact: number;
  /** Assumption references (policy/scenario/manifest ids), at least one. */
  readonly assumptions: readonly string[];
  /** sha256 over the canonical assumption set. */
  readonly assumptionsHash: string;
  readonly renderedAt: string;
  readonly validUntil: string;
}

/**
 * Render the §64.15 alert execution content. Fail-closed: expiry must
 * follow the render time, impacts are finite non-negative numbers, and the
 * assumption set is non-empty with a well-formed hash.
 */
export function renderAlertExecutionContent(input: RenderAlertContentInput): AlertExecutionContent {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  for (const [field, value] of [
    ['alertId', input.alertId],
    ['candidateId', input.candidateId],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'ALERT_FIELD_INVALID',
        field,
      });
    }
  }
  if (
    typeof input.configuredNotionalUsd !== 'string' ||
    !DECIMAL.test(input.configuredNotionalUsd)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ALERT_FIELD_INVALID',
      field: 'configuredNotionalUsd',
    });
  }
  if (!Number.isInteger(input.actionDelaySeconds) || input.actionDelaySeconds < 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ALERT_FIELD_INVALID',
      field: 'actionDelaySeconds',
    });
  }
  for (const [field, value] of [
    ['modeledEntryImpact', input.modeledEntryImpact],
    ['modeledExitImpact', input.modeledExitImpact],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'ALERT_FIELD_INVALID',
        field,
      });
    }
  }
  if (
    !Array.isArray(input.assumptions) ||
    input.assumptions.length === 0 ||
    input.assumptions.some((a) => typeof a !== 'string' || a.length === 0)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ALERT_ASSUMPTIONS_REQUIRED',
    });
  }
  if (typeof input.assumptionsHash !== 'string' || !SHA256_REF.test(input.assumptionsHash)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ALERT_ASSUMPTIONS_HASH_INVALID',
    });
  }
  if (!ISO_Z.test(input.renderedAt) || !ISO_Z.test(input.validUntil)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ALERT_TIMESTAMP_INVALID',
    });
  }
  if (Date.parse(input.validUntil) <= Date.parse(input.renderedAt)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'ALERT_EXPIRY_MUST_FOLLOW_RENDER',
    });
  }

  return {
    alertId: input.alertId,
    candidateId: input.candidateId,
    configuredNotionalUsd: input.configuredNotionalUsd,
    actionDelaySeconds: input.actionDelaySeconds,
    modeledEntryImpact: input.modeledEntryImpact,
    modeledExitImpact: input.modeledExitImpact,
    assumptions: [...input.assumptions],
    assumptionsHash: input.assumptionsHash,
    validUntil: input.validUntil,
    renderedAt: input.renderedAt,
  };
}
