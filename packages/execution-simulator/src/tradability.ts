/**
 * FR-EXEC-007 / FR-EXEC-012 / FR-EXEC-017 tradability gate (AC-127, AC-235).
 *
 * The gate consumes every recorded scenario result (base + stress) for a
 * candidate and produces the tradability verdict:
 *
 *  - every required stress kind must have a recorded result — a missing
 *    result is a failure, never a pass;
 *  - the profile-declared pass matrix is enforced exactly (a kind not in
 *    the required set cannot stand in for one that is);
 *  - CONFIRMED_OPPORTUNITY defaults to requiring the conservative stress
 *    pass — an optimistic-only candidate is refused;
 *  - blocking preserves the diagnostic signal label verbatim
 *    (FR-EXEC-007, never rewritten);
 *  - uncertainty (FR-EXEC-020) blocks through the same verdict surface.
 *
 * Traces: FR-EXEC-007, FR-EXEC-012, FR-EXEC-017, FR-EXEC-020, AC-122,
 * AC-126, AC-127, AC-235.
 */
import {
  ExecErrorCode,
  ExecVocabularyError,
  StressScenarioKind,
  TradabilityVerdict,
  robustDelayGate,
  tradabilityBlocksConfirmedOpportunity,
} from '@foresift/domain';
import type { OutcomeClass, StressScenarioKind as StressScenarioKindValue } from '@foresift/domain';

/** One recorded scenario result handed to the gate. */
export interface GateScenarioResult {
  readonly stressKind: StressScenarioKindValue;
  readonly passed: boolean;
  readonly netReturnUsd: string;
  readonly fillFraction: number;
}

export interface TradabilityGateInput {
  /** Candidate the verdict is rendered for. */
  readonly candidateId: string;
  /** Profile-declared required stress kinds (the pass matrix). */
  readonly requiredKinds: readonly StressScenarioKindValue[];
  /** Profile-declared conservative-stress policy id (must be non-empty). */
  readonly conservativeStressPolicyId: string;
  /** Every recorded scenario result (required + any extra pre-registered). */
  readonly results: readonly GateScenarioResult[];
  /** §64.13 executable-target evidence satisfied for the exit leg. */
  readonly targetExecutable: boolean;
  /** FR-EXEC-020 uncertainty blocked (already rendered). */
  readonly uncertaintyBlocked: boolean;
  /** §64.4 state completeness of the evaluated snapshot. */
  readonly stateComplete: boolean;
  /** Diagnostic signal label to preserve verbatim (or null). */
  readonly signalLabel: OutcomeClass | null;
  /** Profile requires p50/p90 delay robustness (§64.8). */
  readonly requiresDelayKinds?: readonly StressScenarioKindValue[];
}

export interface TradabilityGateResult {
  readonly candidateId: string;
  readonly verdict: TradabilityVerdict;
  /** When blocked, the blocking verdict (never rewritten). */
  readonly blockReason: TradabilityVerdict | null;
  /** The preserved diagnostic signal label (verbatim, or null). */
  readonly preservedSignalLabel: OutcomeClass | null;
  /** Per-required-kind pass/fail (missing = fail). */
  readonly kindResults: Readonly<Record<string, boolean>>;
  /** Confirmed-opportunity may be published (FR-EXEC-007). */
  readonly confirmedOpportunity: boolean;
  /** Failures in the required pass matrix. */
  readonly failedKinds: readonly StressScenarioKindValue[];
  /** Machine-readable refusal when the optimistic-only pattern appears. */
  readonly refusal: string | null;
}

function requireKind(value: unknown): StressScenarioKindValue {
  const kind = (Object.values(StressScenarioKind) as string[]).includes(value as string)
    ? (value as StressScenarioKindValue)
    : undefined;
  if (kind === undefined) {
    throw new ExecVocabularyError(ExecErrorCode.STRESS_SCENARIO_KIND_UNKNOWN, value);
  }
  return kind;
}

/**
 * Evaluate the tradability gate over the recorded scenario matrix. The
 * verdict is the machine-readable block reason — never a rewritten label.
 */
export function evaluateTradabilityGate(input: TradabilityGateInput): TradabilityGateResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, input);
  }
  if (typeof input.candidateId !== 'string' || input.candidateId.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, {
      refused: 'GATE_CANDIDATE_ID_INVALID',
    });
  }
  if (
    !Array.isArray(input.requiredKinds) ||
    input.requiredKinds.length === 0 ||
    input.requiredKinds.some((k) => typeof k !== 'string')
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, {
      refused: 'GATE_REQUIRED_KINDS_INVALID',
    });
  }
  if (
    typeof input.conservativeStressPolicyId !== 'string' ||
    input.conservativeStressPolicyId.length === 0
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, {
      refused: 'GATE_CONSERVATIVE_POLICY_ID_REQUIRED',
    });
  }
  if (!Array.isArray(input.results)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, {
      refused: 'GATE_RESULTS_INVALID',
    });
  }
  for (const result of input.results) {
    if (result === null || typeof result !== 'object' || typeof result.passed !== 'boolean') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, {
        refused: 'GATE_RESULT_MALFORMED',
      });
    }
    requireKind(result.stressKind);
  }
  if (
    input.signalLabel !== null &&
    input.signalLabel !== undefined &&
    typeof input.signalLabel !== 'string'
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_CONFIRMATION_INPUT_INVALID, {
      refused: 'GATE_SIGNAL_LABEL_INVALID',
    });
  }

  const resultsByKind = new Map<StressScenarioKindValue, GateScenarioResult>();
  for (const result of input.results) {
    const kind = requireKind(result.stressKind);
    // Deterministic matrix: the first recorded result for a kind stands.
    if (!resultsByKind.has(kind)) resultsByKind.set(kind, result);
  }

  const kindResults: Record<string, boolean> = {};
  const failedKinds: StressScenarioKindValue[] = [];
  for (const required of input.requiredKinds) {
    const kind = requireKind(required);
    const recorded = resultsByKind.get(kind);
    // FR-EXEC-012: a required scenario without a recorded result is a
    // failure, never a pass (fail-closed on the pass matrix).
    const passed = recorded !== undefined && recorded.passed;
    kindResults[kind] = passed;
    if (!passed) failedKinds.push(kind);
  }

  const conservativeRequired = input.requiredKinds.includes(
    StressScenarioKind.CONSERVATIVE_LATENCY_ADVERSE_SELECTION,
  );
  const conservativeResult = resultsByKind.get(
    StressScenarioKind.CONSERVATIVE_LATENCY_ADVERSE_SELECTION,
  );
  const conservativePass = conservativeResult !== undefined && conservativeResult.passed;

  let verdict: TradabilityVerdict;
  let refusal: string | null = null;

  if (!input.stateComplete) {
    verdict = TradabilityVerdict.STATE_INCOMPLETE;
  } else if (input.uncertaintyBlocked) {
    verdict = TradabilityVerdict.UNCERTAINTY_BLOCKED;
  } else if (!input.targetExecutable) {
    verdict = TradabilityVerdict.TARGET_NOT_EXECUTABLE;
  } else if (failedKinds.length > 0) {
    // AC-235: an optimistic-only candidate (base passes, conservative fails)
    // is recorded as INSUFFICIENT_DATA with the explicit refusal — the
    // pass-matrix failure is never papered over by the optimistic result.
    verdict = TradabilityVerdict.INSUFFICIENT_DATA;
    refusal =
      failedKinds.includes(StressScenarioKind.CONSERVATIVE_LATENCY_ADVERSE_SELECTION) &&
      !conservativePass
        ? 'FAILS_CONSERVATIVE_STRESS_SCENARIOS'
        : 'FAILS_REQUIRED_STRESS_PASS_MATRIX';
  } else {
    verdict = TradabilityVerdict.TRADABLE;
  }
  if (
    verdict !== TradabilityVerdict.TRADABLE &&
    conservativeRequired &&
    conservativeResult !== undefined &&
    !conservativePass &&
    refusal === null
  ) {
    refusal = 'FAILS_CONSERVATIVE_STRESS_SCENARIOS';
  }

  // FR-EXEC-007: blocking preserves the diagnostic signal label verbatim.
  const confirmation = tradabilityBlocksConfirmedOpportunity({
    signalLabel: input.signalLabel ?? null,
    verdict,
  });

  // §64.8: when the profile declares delay-robustness kinds, the gate also
  // applies the robust-delay law over the recorded results.
  if (input.requiresDelayKinds !== undefined) {
    const delayResults: Partial<Record<StressScenarioKindValue, boolean>> = {};
    for (const kind of input.requiresDelayKinds) {
      const recorded = resultsByKind.get(requireKind(kind));
      delayRecords(delayResults, kind, recorded !== undefined && recorded.passed);
    }
    const delayGate = robustDelayGate({
      profileRequires: input.requiresDelayKinds,
      results: delayResults,
    });
    if (!delayGate.robust && verdict === TradabilityVerdict.TRADABLE) {
      verdict = TradabilityVerdict.INSUFFICIENT_DATA;
      refusal = 'FAILS_REQUIRED_STRESS_PASS_MATRIX';
    }
  }

  return {
    candidateId: input.candidateId,
    verdict,
    blockReason: confirmation.blockReason,
    preservedSignalLabel: confirmation.preservedSignalLabel,
    kindResults,
    confirmedOpportunity: confirmation.confirmedOpportunity,
    failedKinds,
    refusal,
  };
}

function delayRecords(
  target: Partial<Record<StressScenarioKindValue, boolean>>,
  kind: StressScenarioKindValue,
  passed: boolean,
): void {
  target[kind] = passed;
}
