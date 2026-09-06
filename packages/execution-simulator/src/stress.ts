/**
 * §64.10 / FR-EXEC-012 / FR-EXEC-017 stress-scenario matrix (AC-127, AC-235).
 *
 * Every production scenario computes at minimum BASE_CASE and
 * CONSERVATIVE_STRESS_CASE, and the profile declares which kinds must pass.
 * The conservative policy applies versioned conservative assumptions —
 * quote latency, adverse selection/MEV buffer, fee volatility, liquidity
 * deterioration — and CONFIRMED_OPPORTUNITY defaults to requiring the
 * conservative pass. An optimistic-only candidate (base passes, conservative
 * unrecorded or failed) is refused, never promoted.
 *
 * Every evaluated kind is recorded — including failures — so the pass
 * matrix is auditable and nothing silently narrows the evaluated set.
 *
 * Traces: FR-EXEC-012, FR-EXEC-017, AC-127, AC-235.
 */
import {
  ExecErrorCode,
  ExecVocabularyError,
  StressScenarioKind,
  robustDelayGate,
} from '@foresift/domain';
import type { StressScenarioKind as StressScenarioKindValue } from '@foresift/domain';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { ScenarioPassMatrix, StressScenarioResult } from '@foresift/shared-schemas';

export type { ScenarioPassMatrix, StressScenarioResult };

/** Versioned conservative stress assumptions (§64.10). */
export interface ConservativeStressAssumptions {
  readonly policyId: string;
  readonly policyVersion: string;
  /** Extra quote latency under stress (seconds). */
  readonly addedQuoteLatencySeconds: number;
  /** Adverse-selection / MEV buffer applied (fraction [0,1]). */
  readonly adverseSelectionMevBufferFraction: number;
  /** Fee volatility multiplier applied to modeled fees (≥ 1). */
  readonly feeVolatilityMultiplier: number;
  /** Liquidity deterioration fraction removed from depth ([0,1]). */
  readonly liquidityDeteriorationFraction: number;
}

/** One scenario evaluation handed to the matrix builder. */
export interface StressEvaluation {
  readonly stressKind: StressScenarioKindValue;
  readonly status: StressScenarioResult['status'];
  readonly netReturnUsd: string;
  readonly fillFraction: number;
  /** The scenario passed this kind's threshold. */
  readonly passed: boolean;
}

const ALL_KINDS: readonly StressScenarioKindValue[] = Object.values(StressScenarioKind);

function requireKind(value: string): StressScenarioKindValue {
  const kind = (ALL_KINDS as string[]).includes(value)
    ? (value as StressScenarioKindValue)
    : undefined;
  if (kind === undefined) {
    throw new ExecVocabularyError(ExecErrorCode.STRESS_SCENARIO_KIND_UNKNOWN, value);
  }
  return kind;
}

function validateAssumptions(assumptions: ConservativeStressAssumptions): void {
  if (assumptions === null || typeof assumptions !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, assumptions);
  }
  if (
    typeof assumptions.policyId !== 'string' ||
    assumptions.policyId.length === 0 ||
    typeof assumptions.policyVersion !== 'string' ||
    assumptions.policyVersion.length === 0
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'STRESS_POLICY_IDENTITY_INVALID',
    });
  }
  if (
    !Number.isInteger(assumptions.addedQuoteLatencySeconds) ||
    assumptions.addedQuoteLatencySeconds < 0
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'STRESS_ASSUMPTION_INVALID',
      field: 'addedQuoteLatencySeconds',
    });
  }
  for (const [field, value] of [
    ['adverseSelectionMevBufferFraction', assumptions.adverseSelectionMevBufferFraction],
    ['liquidityDeteriorationFraction', assumptions.liquidityDeteriorationFraction],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'STRESS_ASSUMPTION_INVALID',
        field,
      });
    }
  }
  if (
    typeof assumptions.feeVolatilityMultiplier !== 'number' ||
    !Number.isFinite(assumptions.feeVolatilityMultiplier) ||
    assumptions.feeVolatilityMultiplier < 1
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'STRESS_ASSUMPTION_INVALID',
      field: 'feeVolatilityMultiplier',
    });
  }
}

/** sha256 over the canonical conservative assumptions (recorded per result). */
export function stressAssumptionsHash(assumptions: ConservativeStressAssumptions): string {
  validateAssumptions(assumptions);
  return sha256Text(canonicalJson(assumptions as unknown as Record<string, unknown>));
}

export interface BuildMatrixInput {
  readonly matrixId: string;
  readonly candidateId: string;
  readonly outcomeProfileVersion: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly conservativeStressPolicyId: string;
  /** Profile-declared required kinds (≥ 1). */
  readonly requiredKinds: readonly string[];
  /** Evaluated kinds with their results — failures included. */
  readonly evaluations: readonly StressEvaluation[];
  /** Conservative assumptions hash shared by every result record. */
  readonly assumptionsHash: string;
  readonly evaluatedAt: string;
  /** CONFIRMED_OPPORTUNITY default: conservative pass required (AC-235). */
  readonly confirmedOpportunityCandidate: boolean;
}

export interface BuildMatrixResult {
  readonly matrix: ScenarioPassMatrix;
  /** Kinds the profile required but that were never evaluated (fail-closed). */
  readonly missingKinds: readonly StressScenarioKindValue[];
  /** True when the candidate satisfies the required pass matrix. */
  readonly satisfiesMatrix: boolean;
  /** Refusal when an optimistic-only promotion was attempted. */
  readonly refusal: string | null;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const SIGNED_DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * Build the §64.10 pass matrix over the evaluated scenario results. Fails
 * closed on: missing required evaluations (a missing result is a failure —
 * but the build itself refuses to emit a matrix claiming success when the
 * required set was not fully recorded), malformed kinds, and
 * optimistic-only candidates for CONFIRMED_OPPORTUNITY.
 */
export function buildScenarioPassMatrix(input: BuildMatrixInput): BuildMatrixResult {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  if (
    typeof input.matrixId !== 'string' ||
    input.matrixId.length === 0 ||
    typeof input.candidateId !== 'string' ||
    input.candidateId.length === 0 ||
    typeof input.outcomeProfileVersion !== 'string' ||
    input.outcomeProfileVersion.length === 0 ||
    typeof input.scenarioId !== 'string' ||
    input.scenarioId.length === 0 ||
    typeof input.scenarioVersion !== 'string' ||
    input.scenarioVersion.length === 0 ||
    typeof input.conservativeStressPolicyId !== 'string' ||
    input.conservativeStressPolicyId.length === 0
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MATRIX_IDENTITY_INVALID',
    });
  }
  if (!ISO_Z.test(input.evaluatedAt)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MATRIX_TIMESTAMP_INVALID',
    });
  }
  if (!Array.isArray(input.requiredKinds) || input.requiredKinds.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MATRIX_REQUIRED_KINDS_INVALID',
    });
  }
  const requiredKinds = input.requiredKinds.map(requireKind);
  if (!Array.isArray(input.evaluations)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'MATRIX_EVALUATIONS_INVALID',
    });
  }

  const results: StressScenarioResult[] = [];
  const seenKinds = new Set<StressScenarioKindValue>();
  for (const evaluation of input.evaluations) {
    if (evaluation === null || typeof evaluation !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'MATRIX_EVALUATION_INVALID',
      });
    }
    const kind = requireKind(evaluation.stressKind);
    if (
      typeof evaluation.passed !== 'boolean' ||
      typeof evaluation.netReturnUsd !== 'string' ||
      !SIGNED_DECIMAL.test(evaluation.netReturnUsd) ||
      typeof evaluation.fillFraction !== 'number' ||
      !Number.isFinite(evaluation.fillFraction) ||
      evaluation.fillFraction < 0 ||
      evaluation.fillFraction > 1
    ) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'MATRIX_EVALUATION_MALFORMED',
        stressKind: kind,
      });
    }
    if (seenKinds.has(kind)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'MATRIX_DUPLICATE_KIND',
        stressKind: kind,
      });
    }
    seenKinds.add(kind);
    results.push({
      scenarioId: input.scenarioId,
      scenarioVersion: input.scenarioVersion,
      stressKind: kind,
      status: evaluation.status,
      netReturn: {
        grossReturnUsd: evaluation.netReturnUsd,
        poolFeesUsd: '0',
        aggregatorFeesUsd: '0',
        tokenTransferFeesUsd: '0',
        priorityNetworkFeesUsd: '0',
        executionImpactUsd: '0',
        failedAttemptsUsd: '0',
        partialFillPenaltyUsd: '0',
        residualInventoryUsd: '0',
        adverseSelectionMevBufferUsd: '0',
        quoteConversionDepegUsd: '0',
        accountCreationRentUsd: '0',
        netReturnUsd: evaluation.netReturnUsd,
        qualityCodes: ['VALID'],
      },
      fillFraction: evaluation.fillFraction,
      passed: evaluation.passed,
      assumptionsHash: input.assumptionsHash,
    });
  }

  // FR-EXEC-017 evaluation floor: production tradability EVALUATES all eight
  // scenario kinds — the profile only declares which must pass. A candidate
  // whose recorded set omits any kind (including unrequired ones) never
  // satisfies the matrix; optimistic-only promotion cannot hide behind a
  // narrow required set that was never fully evaluated.
  const missingKinds = ALL_KINDS.filter((kind) => !seenKinds.has(kind));
  const failedKinds = requiredKinds.filter((kind) => {
    const result = results.find((r) => r.stressKind === kind);
    return result === undefined || !result.passed;
  });

  let refusal: string | null = null;
  if (missingKinds.length > 0) {
    // FR-EXEC-012: every required kind must be recorded — an incomplete
    // matrix never reads as a pass.
    refusal = 'REQUIRED_STRESS_KINDS_NOT_RECORDED';
  }
  if (
    input.confirmedOpportunityCandidate &&
    requiredKinds.includes(StressScenarioKind.CONSERVATIVE_LATENCY_ADVERSE_SELECTION) &&
    failedKinds.includes(StressScenarioKind.CONSERVATIVE_LATENCY_ADVERSE_SELECTION)
  ) {
    // AC-235: an optimistic-only candidate is refused for confirmation —
    // the conservative pass is the default requirement.
    refusal = 'FAILS_CONSERVATIVE_STRESS_SCENARIOS';
  }

  const matrix: ScenarioPassMatrix = {
    matrixId: input.matrixId,
    candidateId: input.candidateId,
    outcomeProfileVersion: input.outcomeProfileVersion,
    requiredKinds,
    results,
    conservativeStressPolicyId: input.conservativeStressPolicyId,
    evaluatedAt: input.evaluatedAt,
  };

  return {
    matrix,
    missingKinds,
    satisfiesMatrix: missingKinds.length === 0 && failedKinds.length === 0,
    refusal,
  };
}

/**
 * §64.8 delay-robustness wrapper over the built matrix: the profile's
 * declared delay kinds (p50/p90/conservative) must all pass. Missing results
 * fail — never pass.
 */
export function delayRobustnessOf(
  matrix: ScenarioPassMatrix,
  requiredDelayKinds: readonly string[],
): { robust: boolean; failures: readonly StressScenarioKindValue[] } {
  const kinds = requiredDelayKinds.map(requireKind);
  if (kinds.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_DELAY_GATE_INPUT_INVALID, {
      refused: 'DELAY_KINDS_REQUIRED',
    });
  }
  const results: Partial<Record<StressScenarioKindValue, boolean>> = {};
  for (const kind of kinds) {
    const recorded = matrix.results.find((r) => r.stressKind === kind);
    results[kind] = recorded !== undefined && recorded.passed;
  }
  return robustDelayGate({ profileRequires: kinds, results });
}
