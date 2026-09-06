/**
 * §64.2 scenario identity resolution with pre-registration enforcement.
 *
 * Scenarios are pre-registered. Evaluation MUST NOT select the historically
 * best scenario, delay, notional, route, or exit policy after observing
 * outcomes — this module enforces that the identity used for evaluation is
 * byte-identical to the registered one (hash equality) and refuses any
 * resolution that would retroactively rewrite a field.
 *
 * Traces: FR-EXEC-001, FR-EXEC-002, FR-EXEC-017, AC-235.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { ActionDelayProfile } from './delays.ts';
import { resolveActionDelayProfile, type ResolveDelayProfileInput } from './delays.ts';

export { resolveActionDelayProfile };
export type { ActionDelayProfile, ResolveDelayProfileInput };

/** §64.2 ExecutionScenario — declared in-product here, mirrored by
 * `ExecutionScenarioSchema` in shared-schemas (payload boundary). */
export interface ExecutionScenario {
  readonly scenarioId: string;
  readonly version: string;
  readonly notionalUsd: string;
  readonly deterministicActionDelaySeconds: number;
  readonly empiricalActionDelayPolicyId?: string;
  readonly entryPolicyVersionId: string;
  readonly exitPolicyVersionId: string;
  readonly maximumEntryImpact: number;
  readonly maximumExitImpact: number;
  readonly allowPartialFill: boolean;
  readonly minimumFillFraction: number;
  readonly maximumFillDurationSeconds: number;
  readonly feePolicyVersionId: string;
  readonly conservativeStressPolicyId: string;
  readonly requiredPoolAdapterCoverage: 'COMPLETE' | 'BOUNDED_APPROXIMATION';
}

export interface RegisteredScenario {
  readonly scenario: ExecutionScenario;
  /** sha256 of the canonical JSON of the scenario at registration. */
  readonly registeredHash: string;
  readonly registeredAt: string;
}

export interface ScenarioRegistry {
  readonly registryVersion: string;
  readonly registered: readonly RegisteredScenario[];
}

export interface ResolveScenarioInput {
  readonly registry: ScenarioRegistry;
  readonly scenarioId: string;
  readonly version: string;
  /** The scenario payload being evaluated; must hash-match the registration. */
  readonly candidate: ExecutionScenario;
}

/** Decimal-string notional law: non-negative finite decimal, no exponent. */
function requireDecimalString(value: string, label: string): void {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_FIELD_INVALID',
      field: label,
      value,
    });
  }
}

export function validateScenarioShape(scenario: ExecutionScenario): void {
  if (typeof scenario.scenarioId !== 'string' || scenario.scenarioId.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_FIELD_INVALID',
      field: 'scenarioId',
    });
  }
  if (typeof scenario.version !== 'string' || scenario.version.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_FIELD_INVALID',
      field: 'version',
    });
  }
  requireDecimalString(scenario.notionalUsd, 'notionalUsd');
  for (const field of [
    'maximumEntryImpact',
    'maximumExitImpact',
    'minimumFillFraction',
    'maximumFillDurationSeconds',
    'deterministicActionDelaySeconds',
  ] as const) {
    const value = scenario[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'SCENARIO_FIELD_INVALID',
        field,
        value,
      });
    }
  }
  if (scenario.minimumFillFraction > 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_FIELD_INVALID',
      field: 'minimumFillFraction',
      value: scenario.minimumFillFraction,
    });
  }
  for (const field of [
    'entryPolicyVersionId',
    'exitPolicyVersionId',
    'feePolicyVersionId',
    'conservativeStressPolicyId',
  ] as const) {
    const value = scenario[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'SCENARIO_FIELD_INVALID',
        field,
      });
    }
  }
  if (
    scenario.requiredPoolAdapterCoverage !== 'COMPLETE' &&
    scenario.requiredPoolAdapterCoverage !== 'BOUNDED_APPROXIMATION'
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_FIELD_INVALID',
      field: 'requiredPoolAdapterCoverage',
      value: scenario.requiredPoolAdapterCoverage,
    });
  }
}

export function scenarioHash(scenario: ExecutionScenario): string {
  return sha256Text(canonicalJson(scenario as unknown as Record<string, unknown>));
}

/**
 * Resolve a scenario for evaluation. Refuses when:
 * - the (scenarioId, version) pair was never registered (no retroactive
 *   scenario invention);
 * - the candidate payload does not hash-match the registration (field
 *   rewriting after observing outcomes).
 */
export function resolveScenario(input: ResolveScenarioInput): RegisteredScenario {
  validateScenarioShape(input.candidate);
  const registered = input.registry.registered.find(
    (entry) =>
      entry.scenario.scenarioId === input.scenarioId && entry.scenario.version === input.version,
  );
  if (registered === undefined) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_NOT_PRE_REGISTERED',
      scenarioId: input.scenarioId,
      version: input.version,
    });
  }
  const candidateHash = scenarioHash(input.candidate);
  if (candidateHash !== registered.registeredHash) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_REGISTRATION_MISMATCH',
      scenarioId: input.scenarioId,
      version: input.version,
      expected: registered.registeredHash,
      actual: candidateHash,
    });
  }
  return registered;
}

/** Register a scenario (pre-registration moment — call before evaluation). */
export function registerScenario(input: {
  readonly registry: ScenarioRegistry;
  readonly scenario: ExecutionScenario;
  readonly registeredAt: string;
}): ScenarioRegistry {
  validateScenarioShape(input.scenario);
  const duplicate = input.registry.registered.find(
    (entry) =>
      entry.scenario.scenarioId === input.scenario.scenarioId &&
      entry.scenario.version === input.scenario.version,
  );
  if (duplicate !== undefined) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'SCENARIO_ALREADY_REGISTERED',
      scenarioId: input.scenario.scenarioId,
      version: input.scenario.version,
    });
  }
  return {
    registryVersion: input.registry.registryVersion,
    registered: [
      ...input.registry.registered,
      {
        scenario: input.scenario,
        registeredHash: scenarioHash(input.scenario),
        registeredAt: input.registeredAt,
      },
    ],
  };
}

/**
 * Delay in seconds from the signal instant to the single universal
 * actionable instant (§64.6): every simulation acts at the pre-registered
 * deterministic action delay, never at a per-candidate chosen time.
 */
export function actionableAt(scenario: ExecutionScenario): number {
  return scenario.deterministicActionDelaySeconds;
}
