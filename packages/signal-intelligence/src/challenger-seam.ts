import type { CandidateSelectionInput, ProtectedAllocation } from './selection.ts';

export const CHALLENGER_SCOPES = ['TIE_BREAK', 'RESEARCH_ALLOCATION'] as const;
export type ChallengerScope = (typeof CHALLENGER_SCOPES)[number];
export type ChallengerDisabledReason =
  | 'CALIBRATION_NOT_PROVEN'
  | 'CALIBRATION_DRIFT'
  | 'REGIME_DRIFT'
  | 'PROFILE_MISMATCH'
  | 'EXECUTION_SCENARIO_MISMATCH'
  | 'MANUALLY_DISABLED';

export interface ChallengerProof {
  readonly proofId: string;
  readonly challengerVersion: string;
  readonly profileVersion: string;
  readonly regimeId: string;
  readonly executionScenarioVersion: string;
  readonly calibrationProven: true;
  readonly provenAt: string;
  readonly allowedScopes: readonly ChallengerScope[];
}

export type ChallengerRegistryRow =
  | {
      readonly state: 'DISABLED';
      readonly challengerId: string;
      readonly challengerVersion: string;
      readonly disabledReason: ChallengerDisabledReason;
      readonly proof: null;
    }
  | {
      readonly state: 'ENABLED';
      readonly challengerId: string;
      readonly challengerVersion: string;
      readonly disabledReason: null;
      readonly proof: ChallengerProof;
    };

export interface ChallengerHealth {
  readonly calibrationDrift: boolean;
  readonly regimeDrift: boolean;
  readonly activeProfileVersion: string;
  readonly activeRegimeId: string;
  readonly activeExecutionScenarioVersion: string;
}

/** Learned values exist only on the proven branch of this discriminated union. */
export type ChallengerOrderingInput =
  | {
      readonly kind: 'DETERMINISTIC_ONLY';
      readonly registry: Extract<ChallengerRegistryRow, { state: 'DISABLED' }>;
    }
  | {
      readonly kind: 'PROVEN_CHALLENGER';
      readonly registry: Extract<ChallengerRegistryRow, { state: 'ENABLED' }>;
      readonly lowerBoundExpectedUtility: Readonly<Record<string, number>>;
    };

export interface ChallengerOverrideRequest {
  readonly scope: ChallengerScope;
  readonly changesStep1Through8: boolean;
  readonly changesHardGate: boolean;
  readonly changesProtectedAllocations: boolean;
  readonly reducesExplorationFloor: boolean;
  readonly candidatesAreDeterministicallyTied: boolean;
}

export interface ChallengerDecision {
  readonly allowed: boolean;
  readonly reason:
    | 'ALLOWED_TIE_BREAK'
    | 'ALLOWED_RESEARCH_ALLOCATION'
    | 'CHALLENGER_DISABLED'
    | 'SCOPE_NOT_PROVEN'
    | 'NON_OVERRIDABLE_CONSTRAINT'
    | 'NOT_A_DETERMINISTIC_TIE';
}

export function disabledChallenger(
  challengerId: string,
  challengerVersion: string,
  disabledReason: ChallengerDisabledReason = 'CALIBRATION_NOT_PROVEN',
): Extract<ChallengerRegistryRow, { state: 'DISABLED' }> {
  if (challengerId.trim() === '' || challengerVersion.trim() === '') {
    throw new RangeError('challenger identity and version are required');
  }
  return { state: 'DISABLED', challengerId, challengerVersion, disabledReason, proof: null };
}

/** Fail closed: callers cannot enable a challenger without a complete proof row. */
export function registerProvenChallenger(
  challengerId: string,
  proof: ChallengerProof,
): Extract<ChallengerRegistryRow, { state: 'ENABLED' }> {
  if (
    challengerId.trim() === '' ||
    proof.proofId.trim() === '' ||
    proof.challengerVersion.trim() === '' ||
    proof.profileVersion.trim() === '' ||
    proof.regimeId.trim() === '' ||
    proof.executionScenarioVersion.trim() === '' ||
    proof.allowedScopes.length === 0
  ) {
    throw new Error('CHALLENGER_PROOF_INCOMPLETE');
  }
  if (new Set(proof.allowedScopes).size !== proof.allowedScopes.length) {
    throw new Error('CHALLENGER_SCOPE_DUPLICATE');
  }
  return {
    state: 'ENABLED',
    challengerId,
    challengerVersion: proof.challengerVersion,
    disabledReason: null,
    proof,
  };
}

/** §20.4 automatic degradation; a failed gate creates a disabled registry row. */
export function evaluateChallengerHealth(
  registry: ChallengerRegistryRow,
  health: ChallengerHealth,
): ChallengerRegistryRow {
  if (registry.state === 'DISABLED') return registry;
  const disable = (reason: ChallengerDisabledReason): ChallengerRegistryRow =>
    disabledChallenger(registry.challengerId, registry.challengerVersion, reason);
  if (health.calibrationDrift) return disable('CALIBRATION_DRIFT');
  if (health.regimeDrift || health.activeRegimeId !== registry.proof.regimeId) {
    return disable('REGIME_DRIFT');
  }
  if (health.activeProfileVersion !== registry.proof.profileVersion) {
    return disable('PROFILE_MISMATCH');
  }
  if (health.activeExecutionScenarioVersion !== registry.proof.executionScenarioVersion) {
    return disable('EXECUTION_SCENARIO_MISMATCH');
  }
  return registry;
}

/** Closing-law truth table: steps 1–8, hard gates, reserves and floor are immutable. */
export function authorizeChallengerInfluence(
  registry: ChallengerRegistryRow,
  request: ChallengerOverrideRequest,
): ChallengerDecision {
  if (registry.state === 'DISABLED') return { allowed: false, reason: 'CHALLENGER_DISABLED' };
  if (!registry.proof.allowedScopes.includes(request.scope)) {
    return { allowed: false, reason: 'SCOPE_NOT_PROVEN' };
  }
  if (
    request.changesStep1Through8 ||
    request.changesHardGate ||
    request.changesProtectedAllocations ||
    request.reducesExplorationFloor
  ) {
    return { allowed: false, reason: 'NON_OVERRIDABLE_CONSTRAINT' };
  }
  if (request.scope === 'TIE_BREAK' && !request.candidatesAreDeterministicallyTied) {
    return { allowed: false, reason: 'NOT_A_DETERMINISTIC_TIE' };
  }
  return {
    allowed: true,
    reason: request.scope === 'TIE_BREAK' ? 'ALLOWED_TIE_BREAK' : 'ALLOWED_RESEARCH_ALLOCATION',
  };
}

/**
 * Applies only a proven tie break. It cannot alter the deterministic comparison
 * groups; the caller supplies one already-equal group at a time.
 */
export function breakDeterministicTie(
  candidates: readonly CandidateSelectionInput[],
  input: ChallengerOrderingInput,
): readonly CandidateSelectionInput[] {
  if (input.kind === 'DETERMINISTIC_ONLY') {
    throw new Error('LEARNED_ORDERING_INPUT_REFUSED_BEFORE_PROOF');
  }
  const authorization = authorizeChallengerInfluence(input.registry, {
    scope: 'TIE_BREAK',
    changesStep1Through8: false,
    changesHardGate: false,
    changesProtectedAllocations: false,
    reducesExplorationFloor: false,
    candidatesAreDeterministicallyTied: true,
  });
  if (!authorization.allowed) throw new Error(authorization.reason);
  for (const candidate of candidates) {
    const value = input.lowerBoundExpectedUtility[candidate.candidateId];
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error('CHALLENGER_TIE_VALUE_MISSING');
    }
  }
  return [...candidates].sort(
    (a, b) =>
      (input.lowerBoundExpectedUtility[b.candidateId] as number) -
        (input.lowerBoundExpectedUtility[a.candidateId] as number) ||
      a.candidateId.localeCompare(b.candidateId),
  );
}

/** Explicitly asserts that protected allocations emerge unchanged. */
export function preserveProtectedAllocations<T extends readonly ProtectedAllocation[]>(
  allocations: T,
  _registry: ChallengerRegistryRow,
): T {
  return allocations;
}
