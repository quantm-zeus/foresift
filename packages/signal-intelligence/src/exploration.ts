import { ReserveClass, type ReserveClass as Reserve } from '@foresift/domain';

export const MINIMUM_EXPLORATION_FRACTION = 0.05;

export interface ExplorationCandidate {
  readonly candidateId: string;
  readonly stratum: string;
  readonly otherwiseEligible: boolean;
  readonly lowRanked: boolean;
  readonly passedSafetyGates: boolean;
}

export interface ExplorationPolicy {
  readonly policyVersion: string;
  readonly minimumFraction: number;
  readonly seed: string;
  /** Stable provenance identifier; never raw secret entropy. */
  readonly seedProvenance: string;
  readonly eligibleUniverseId: string;
  readonly inclusionTimestamp: string;
}

export interface ExplorationAssignment {
  readonly candidateId: string;
  readonly eligibilityUniverse: string;
  readonly stratum: string;
  readonly policyVersion: string;
  readonly assignmentProbability: number;
  readonly seedProvenance: string;
  readonly inclusionTimestamp: string;
  readonly selected: boolean;
  readonly outcomeObservationOnly: true;
  readonly autoAlerted: false;
  readonly integrityHash: string;
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function assignmentHash(assignment: Omit<ExplorationAssignment, 'integrityHash'>): string {
  const ordered = [
    assignment.candidateId,
    assignment.eligibilityUniverse,
    assignment.stratum,
    assignment.policyVersion,
    assignment.assignmentProbability.toString(),
    assignment.seedProvenance,
    assignment.inclusionTimestamp,
    assignment.selected.toString(),
    assignment.outcomeObservationOnly.toString(),
    assignment.autoAlerted.toString(),
  ].join('\u001f');
  return `fnv1a32:${hash32(ordered).toString(16).padStart(8, '0')}`;
}

function validatePolicy(policy: ExplorationPolicy): void {
  if (
    policy.policyVersion.trim() === '' ||
    policy.seed.trim() === '' ||
    policy.seedProvenance.trim() === '' ||
    policy.eligibleUniverseId.trim() === ''
  ) {
    throw new Error('EXPLORATION_POLICY_INCOMPLETE');
  }
  if (
    !Number.isFinite(policy.minimumFraction) ||
    policy.minimumFraction < MINIMUM_EXPLORATION_FRACTION ||
    policy.minimumFraction > 1
  ) {
    throw new RangeError('exploration fraction must be in [0.05,1]');
  }
  if (
    !Number.isFinite(Date.parse(policy.inclusionTimestamp)) ||
    !policy.inclusionTimestamp.endsWith('Z')
  ) {
    throw new RangeError('inclusionTimestamp must be an ISO-8601 Z timestamp');
  }
}

/**
 * Stratified, seeded, order-independent selection. Assignments are returned for
 * every eligible low-ranked candidate and must be persisted before outcomes.
 */
export function assignExplorationSample(
  candidates: readonly ExplorationCandidate[],
  policy: ExplorationPolicy,
): readonly ExplorationAssignment[] {
  validatePolicy(policy);
  const eligible = candidates.filter(
    (candidate) =>
      candidate.otherwiseEligible && candidate.lowRanked && candidate.passedSafetyGates,
  );
  if (new Set(eligible.map((candidate) => candidate.candidateId)).size !== eligible.length) {
    throw new Error('EXPLORATION_CANDIDATE_DUPLICATE');
  }
  const strata = new Map<string, ExplorationCandidate[]>();
  for (const candidate of eligible) {
    if (candidate.stratum.trim() === '') throw new Error('EXPLORATION_STRATUM_REQUIRED');
    const members = strata.get(candidate.stratum) ?? [];
    members.push(candidate);
    strata.set(candidate.stratum, members);
  }

  const selected = new Set<string>();
  for (const [stratum, members] of [...strata].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...members].sort(
      (a, b) =>
        hash32(`${policy.seed}\u001f${stratum}\u001f${a.candidateId}`) -
          hash32(`${policy.seed}\u001f${stratum}\u001f${b.candidateId}`) ||
        a.candidateId.localeCompare(b.candidateId),
    );
    const count = Math.ceil(ordered.length * policy.minimumFraction);
    for (const candidate of ordered.slice(0, count)) selected.add(candidate.candidateId);
  }
  return [...eligible]
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
    .map((candidate) => {
      const stratumSize = strata.get(candidate.stratum)?.length ?? 0;
      const probability = Math.ceil(stratumSize * policy.minimumFraction) / stratumSize;
      const base: Omit<ExplorationAssignment, 'integrityHash'> = {
        candidateId: candidate.candidateId,
        eligibilityUniverse: policy.eligibleUniverseId,
        stratum: candidate.stratum,
        policyVersion: policy.policyVersion,
        assignmentProbability: probability,
        seedProvenance: policy.seedProvenance,
        inclusionTimestamp: policy.inclusionTimestamp,
        selected: selected.has(candidate.candidateId),
        outcomeObservationOnly: true,
        autoAlerted: false,
      };
      return { ...base, integrityHash: assignmentHash(base) };
    });
}

/** Corrupted assignments are excluded from all inverse-probability weighted claims. */
export function validForWeightedClaim(assignment: ExplorationAssignment): boolean {
  if (
    assignment.assignmentProbability <= 0 ||
    assignment.assignmentProbability > 1 ||
    assignment.stratum.trim() === '' ||
    assignment.eligibilityUniverse.trim() === '' ||
    assignment.policyVersion.trim() === '' ||
    assignment.seedProvenance.trim() === '' ||
    !Number.isFinite(Date.parse(assignment.inclusionTimestamp)) ||
    !assignment.inclusionTimestamp.endsWith('Z') ||
    !assignment.outcomeObservationOnly ||
    assignment.autoAlerted
  ) {
    return false;
  }
  const { integrityHash, ...base } = assignment;
  return integrityHash === assignmentHash(base);
}

export interface BudgetPartitionRequest {
  readonly totalUnits: number;
  readonly protectedReserves: readonly { readonly reserveClass: Reserve; readonly units: number }[];
  readonly minimumExplorationUnits: number;
  readonly minimumPopulationCoverageUnits: number;
  readonly minimumSourceDiversityUnits: number;
  readonly minimumNoveltyUnits: number;
  readonly requestedUncertaintyUnits: number;
  readonly requestedEvidenceProbeUnits: number;
  readonly requestedExploitationUnits: number;
}

export interface BudgetPartition {
  readonly protectedUnits: number;
  readonly explorationUnits: number;
  readonly populationCoverageUnits: number;
  readonly sourceDiversityUnits: number;
  readonly noveltyUnits: number;
  readonly uncertaintyUnits: number;
  readonly evidenceProbeUnits: number;
  readonly exploitationUnits: number;
  readonly unallocatedUnits: number;
}

/** Protected workloads and mandated floors are allocated before exploitation. */
export function partitionSelectionBudget(request: BudgetPartitionRequest): BudgetPartition {
  const integers = [
    request.totalUnits,
    request.minimumExplorationUnits,
    request.minimumPopulationCoverageUnits,
    request.minimumSourceDiversityUnits,
    request.minimumNoveltyUnits,
    request.requestedUncertaintyUnits,
    request.requestedEvidenceProbeUnits,
    request.requestedExploitationUnits,
    ...request.protectedReserves.map((reserve) => reserve.units),
  ];
  if (integers.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new RangeError('budget units must be non-negative integers');
  }
  const allowedProtected: readonly Reserve[] = [
    ReserveClass.RISK_MONITORING,
    ReserveClass.ALERT_VERIFICATION,
    ReserveClass.OUTCOME_COLLECTION,
    ReserveClass.INTERACTIVE_MCP,
  ];
  if (
    request.protectedReserves.some((reserve) => !allowedProtected.includes(reserve.reserveClass))
  ) {
    throw new Error('UNPROTECTED_RESERVE_CLASS');
  }
  const protectedUnits = request.protectedReserves.reduce((sum, reserve) => sum + reserve.units, 0);
  const mandatory =
    protectedUnits +
    request.minimumExplorationUnits +
    request.minimumPopulationCoverageUnits +
    request.minimumSourceDiversityUnits +
    request.minimumNoveltyUnits;
  if (mandatory > request.totalUnits) throw new Error('PROTECTED_AND_MINIMUM_BUDGET_UNAVAILABLE');
  let remaining = request.totalUnits - mandatory;
  const take = (requested: number): number => {
    const allocated = Math.min(requested, remaining);
    remaining -= allocated;
    return allocated;
  };
  const uncertaintyUnits = take(request.requestedUncertaintyUnits);
  const evidenceProbeUnits = take(request.requestedEvidenceProbeUnits);
  const exploitationUnits = take(request.requestedExploitationUnits);
  return {
    protectedUnits,
    explorationUnits: request.minimumExplorationUnits,
    populationCoverageUnits: request.minimumPopulationCoverageUnits,
    sourceDiversityUnits: request.minimumSourceDiversityUnits,
    noveltyUnits: request.minimumNoveltyUnits,
    uncertaintyUnits,
    evidenceProbeUnits,
    exploitationUnits,
    unallocatedUnits: remaining,
  };
}

export interface EmergencyExplorationDraw {
  readonly policyVersion: string;
  readonly emergencyPolicyId: string;
  readonly eligibilityUniverse: string;
  readonly previousExplorationUnits: number;
  readonly drawnUnits: number;
  readonly resultingExplorationUnits: number;
  readonly reason: string;
  readonly authorizedBy: string;
  readonly drawnAt: string;
}

/** Any draw below the normal floor is possible only through this auditable record. */
export function auditEmergencyExplorationDraw(
  input: EmergencyExplorationDraw,
): EmergencyExplorationDraw {
  if (
    input.policyVersion.trim() === '' ||
    input.emergencyPolicyId.trim() === '' ||
    input.eligibilityUniverse.trim() === '' ||
    input.reason.trim() === '' ||
    input.authorizedBy.trim() === '' ||
    !Number.isFinite(Date.parse(input.drawnAt)) ||
    !input.drawnAt.endsWith('Z') ||
    !Number.isInteger(input.drawnUnits) ||
    input.drawnUnits <= 0 ||
    input.resultingExplorationUnits !== input.previousExplorationUnits - input.drawnUnits ||
    input.resultingExplorationUnits < 0
  ) {
    throw new Error('INVALID_EMERGENCY_EXPLORATION_DRAW');
  }
  return { ...input };
}
