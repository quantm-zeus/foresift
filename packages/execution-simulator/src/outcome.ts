/**
 * §64.12 / §8.2 outcome classification (FR-EXEC-006, INV-011/012).
 *
 * A thin, fail-closed assembly over the domain precedence law: it takes the
 * evidence clauses a simulation produced plus the explicit censor/invalid
 * reasons, runs the single §8.2 precedence, and additionally derives the
 * `UNTRADABLE_SIGNAL_WIN` handling — a SIGNAL_SUCCESS on the signal axis
 * whose tradable axis did not confirm is an untradable signal win, never a
 * tradable success, and never renders profit.
 *
 * Denominator disclosure counts (INV-012) are tracked separately: the
 * classifier records how many candidates were classified, how many were
 * censored/invalid/pending, and how many reached terminal labels, so a
 * rendered denominator can always be reconciled with the raw population.
 *
 * Traces: FR-EXEC-003, FR-EXEC-006, FR-EXEC-018, AC-121, AC-124, AC-125.
 */
import {
  ExecErrorCode,
  ExecVocabularyError,
  OutcomeClass,
  OutcomeMaturity,
  isQualityCode,
  outcomeLabelPrecedence,
  signalCannotRenderProfit,
} from '@foresift/domain';
import type { OutcomeLabelClauses, OutcomeLabelResult } from '@foresift/domain';

export type { OutcomeLabelClauses, OutcomeLabelResult };

/**
 * Explicit reason a candidate's outcome is censored or invalid. §8.2 steps
 * 1–2 require documented reasons; a CENSORED or INVALID_DATA label without
 * one is refused — the label alone is not evidence.
 */
export const CensorInvalidReason = {
  HORIZON_NOT_ELAPSED: 'HORIZON_NOT_ELAPSED',
  EXOGENOUS_HORIZON_TRUNCATION: 'EXOGENOUS_HORIZON_TRUNCATION',
  NO_TERMINAL_EVENT_ESTABLISHED: 'NO_TERMINAL_EVENT_ESTABLISHED',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  CHRONOLOGY_INVALID: 'CHRONOLOGY_INVALID',
  REQUIRED_STATE_MISSING: 'REQUIRED_STATE_MISSING',
  ADAPTER_CORRECTNESS_UNVERIFIABLE: 'ADAPTER_CORRECTNESS_UNVERIFIABLE',
  EVIDENCE_INTEGRITY_FAILURE: 'EVIDENCE_INTEGRITY_FAILURE',
} as const;
export type CensorInvalidReason =
  (typeof CensorInvalidReason)[keyof typeof CensorInvalidReason];

const CENSOR_REASONS: readonly string[] = [
  CensorInvalidReason.HORIZON_NOT_ELAPSED,
  CensorInvalidReason.EXOGENOUS_HORIZON_TRUNCATION,
  CensorInvalidReason.NO_TERMINAL_EVENT_ESTABLISHED,
];
const INVALID_REASONS: readonly string[] = [
  CensorInvalidReason.IDENTITY_MISMATCH,
  CensorInvalidReason.CHRONOLOGY_INVALID,
  CensorInvalidReason.REQUIRED_STATE_MISSING,
  CensorInvalidReason.ADAPTER_CORRECTNESS_UNVERIFIABLE,
  CensorInvalidReason.EVIDENCE_INTEGRITY_FAILURE,
];

function requireReason(
  value: unknown,
  allowed: readonly string[],
  refused: string,
): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused,
      value,
    });
  }
  return value;
}

export interface ClassifyOutcomeInput {
  /** Raw §8.2 evidence clauses from the simulation. */
  readonly clauses: OutcomeLabelClauses;
  /** Required when censored — the documented exogenous reason. */
  readonly censorReason: string | null;
  /** Required when invalid — the documented integrity reason. */
  readonly invalidReason: string | null;
  /** §13.9 codes for the classification record. */
  readonly qualityCodes: readonly string[];
}

export interface ClassifyOutcomeResult {
  /** The §8.2 precedence resolution (tradable + signal labels). */
  readonly resolution: OutcomeLabelResult;
  /** True when the signal axis won but the tradable axis did not confirm —
   * an UNTRADABLE_SIGNAL_WIN; never rendered as profit. */
  readonly untradableSignalWin: boolean;
  /** True when a profit render on this outcome would violate FR-EXEC-006. */
  readonly profitRenderRefused: boolean;
  readonly censorReason: string | null;
  readonly invalidReason: string | null;
  readonly qualityCodes: readonly string[];
}

/** §8.2 outcome classification under the single precedence law. */
export function classifyOutcome(input: ClassifyOutcomeInput): ClassifyOutcomeResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  for (const code of input.qualityCodes) {
    if (typeof code !== 'string' || !isQualityCode(code)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'OUTCOME_QUALITY_CODE_UNKNOWN',
        code,
      });
    }
  }

  const resolution = outcomeLabelPrecedence(input.clauses);

  let censorReason: string | null = null;
  let invalidReason: string | null = null;
  if (
    resolution.tradableLabel === OutcomeClass.CENSORED ||
    resolution.maturity === OutcomeMaturity.CENSORED
  ) {
    censorReason = requireReason(
      input.censorReason,
      CENSOR_REASONS,
      'CENSORED_LABEL_REQUIRES_DOCUMENTED_REASON',
    );
  } else if (input.censorReason !== null) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'CENSOR_REASON_WITHOUT_CENSORED_LABEL_REFUSED',
      censorReason: input.censorReason,
    });
  }
  if (
    resolution.tradableLabel === OutcomeClass.INVALID_DATA ||
    resolution.maturity === OutcomeMaturity.INVALID_DATA
  ) {
    invalidReason = requireReason(
      input.invalidReason,
      INVALID_REASONS,
      'INVALID_DATA_LABEL_REQUIRES_DOCUMENTED_REASON',
    );
  } else if (input.invalidReason !== null) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'INVALID_REASON_WITHOUT_INVALID_LABEL_REFUSED',
      invalidReason: input.invalidReason,
    });
  }

  const signalLabel = resolution.signalLabel;
  const untradableSignalWin =
    signalLabel === OutcomeClass.SIGNAL_SUCCESS &&
    resolution.tradableLabel !== OutcomeClass.TRADABLE_SUCCESS;

  const profitRenderRefused = signalCannotRenderProfit({
    signalLabel:
      signalLabel === OutcomeClass.SIGNAL_SUCCESS ||
      signalLabel === OutcomeClass.SIGNAL_FAILURE
        ? signalLabel
        : OutcomeClass.SIGNAL_FAILURE,
    tradableLabel: resolution.tradableLabel,
    renderProfit: untradableSignalWin,
  });

  return {
    resolution,
    untradableSignalWin,
    profitRenderRefused,
    censorReason,
    invalidReason,
    qualityCodes: [...input.qualityCodes],
  };
}

// ---------------------------------------------------------------------------
// Denominator disclosure counts (INV-012)
// ---------------------------------------------------------------------------

export interface DenominatorCounts {
  readonly classified: number;
  readonly censored: number;
  readonly invalid: number;
  readonly pending: number;
  readonly terminal: number;
  /** censored + invalid + pending + terminal === classified. */
}

/**
 * INV-012 denominator disclosure: fold per-candidate labels into the
 * disclosed counts. Every classified candidate lands in exactly one bucket,
 * so a rendered success/failure denominator is always reconcilable with the
 * raw population.
 */
export function discloseDenominator(labels: readonly OutcomeClass[]): DenominatorCounts {
  let censored = 0;
  let invalid = 0;
  let pending = 0;
  let terminal = 0;
  for (const label of labels) {
    switch (label) {
      case OutcomeClass.CENSORED:
        censored += 1;
        break;
      case OutcomeClass.INVALID_DATA:
        invalid += 1;
        break;
      case OutcomeClass.PENDING:
        pending += 1;
        break;
      case OutcomeClass.SIGNAL_SUCCESS:
      case OutcomeClass.SIGNAL_FAILURE:
        throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
          refused: 'SIGNAL_LABEL_IN_DENOMINATOR_REFUSED',
          label,
        });
      default:
        terminal += 1;
        break;
    }
  }
  return {
    classified: labels.length,
    censored,
    invalid,
    pending,
    terminal,
  };
}
