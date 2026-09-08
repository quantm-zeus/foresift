import { ReserveClass, type QualityCode, type ReserveClass as Reserve } from '@foresift/domain';

import type { CandidateVectorSet } from './vectors.ts';

/** Appendix I steps 1–13. The values are deliberately stable audit identifiers. */
export const DETERMINISTIC_SELECTION_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export const SELECTION_ARMS = [
  'EXPLOITATION',
  'UNCERTAINTY',
  'RANDOM_EXPLORATION',
  'EVIDENCE_PROBE',
  'OUTCOME_OBSERVATION_ONLY',
  'NOT_SELECTED',
] as const;
export type SelectionArm = (typeof SELECTION_ARMS)[number];
export type ParetoStatus = 'EFFICIENT' | 'DOMINATED' | 'UNKNOWN_DIMENSION_BLOCKED';

export interface ResolvedPointInTimeState {
  readonly identityId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly adapterId: string | null;
  readonly adapterVersion: string | null;
  readonly sourceIds: readonly string[];
  readonly availableAt: string;
  readonly resolvedAt: string;
}

export interface SelectionGate {
  readonly code: string;
  readonly passed: boolean;
  readonly hard: boolean;
  readonly reason: string | null;
}

export interface RobustCohortValue {
  readonly name: string;
  readonly value: number | null;
  readonly fallbackLevel: string;
  readonly sampleSize: number;
  readonly effectiveSampleSize: number;
  readonly qualityCodes: readonly QualityCode[];
}

export interface RequiredExecutionScenario {
  readonly scenarioId: string;
  readonly required: boolean;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly proven: boolean;
  readonly passed: boolean;
  readonly maximumExecutableNotional: number | null;
  readonly netUtility: number | null;
  readonly actionabilityRemaining: number | null;
  readonly stateComplete: boolean;
  readonly uncertainty: number | null;
}

export interface FeasibilityEnvelope {
  readonly requiredScenariosPassed: boolean;
  readonly maximumExecutableNotional: number | null;
  readonly worstRequiredNetUtility: number | null;
  readonly actionabilityRemaining: number | null;
  readonly stateComplete: boolean;
  readonly maximumUncertainty: number | null;
}

export interface LexicographicKeys {
  /** a: lower is better. */
  readonly riskClass: number;
  /** b: true sorts before false. */
  readonly executionFeasible: boolean;
  /** c: higher is better. */
  readonly dataQuality: number | null;
  readonly effectiveSourceIndependence: number | null;
  /** d: higher is better. */
  readonly emergencePersistencePercentile: number | null;
  /** e: higher is better. */
  readonly remainingActionability: number | null;
  /** f: lower is better. */
  readonly priceExtension: number | null;
  readonly crowding: number | null;
  /** g: higher is better. */
  readonly novelty: number | null;
  readonly diversityContribution: number | null;
}

export interface ExposureFacts {
  readonly narrative: string | null;
  readonly deployer: string | null;
  readonly funder: string | null;
  readonly launchpad: string | null;
  readonly pool: string | null;
  readonly sharedLiquidity: string | null;
}

export interface CandidateSelectionInput {
  readonly candidateId: string;
  readonly pointInTime: ResolvedPointInTimeState;
  readonly gates: readonly SelectionGate[];
  readonly vectors: CandidateVectorSet;
  readonly cohorts: readonly RobustCohortValue[];
  readonly sourceDependence: unknown;
  readonly executionScenarios: readonly RequiredExecutionScenario[];
  readonly sortKeys: LexicographicKeys;
  readonly exposures: ExposureFacts;
  readonly capacityAdmitted: boolean;
}

export interface FrozenEligibleUniverse {
  readonly universeId: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly rankingVersion: string;
  readonly algorithmVersion: string;
  readonly tDecisionReady: string;
  readonly candidateIds: readonly string[];
  readonly fingerprint: string;
}

export interface ExposureLimits {
  readonly narrative: number;
  readonly deployer: number;
  readonly funder: number;
  readonly launchpad: number;
  readonly pool: number;
  readonly sharedLiquidity: number;
}

export interface ProtectedAllocation {
  readonly reserveClass: Reserve;
  readonly units: number;
}

export interface SelectionPolicy {
  readonly exposureLimits: ExposureLimits;
  readonly protectedAllocations: readonly ProtectedAllocation[];
  readonly armBudgets: Readonly<Record<Exclude<SelectionArm, 'NOT_SELECTED'>, number>>;
}

export interface RankingAuditRecord {
  readonly eligibleUniverse: FrozenEligibleUniverse;
  readonly candidateId: string;
  readonly rankAtTime: number;
  readonly rankingVersion: string;
  readonly profileVersion: string;
  readonly componentValues: CandidateVectorSet;
  readonly hardGateResults: readonly SelectionGate[];
  readonly robustCohortValues: readonly RobustCohortValue[];
  readonly sourceDependence: unknown;
  readonly adapterScenarioResults: readonly RequiredExecutionScenario[];
  readonly feasibilityEnvelope: FeasibilityEnvelope;
  readonly paretoStatus: ParetoStatus;
  readonly exposureConstraintResults: readonly ExposureConstraintResult[];
  readonly protectedAllocations: readonly ProtectedAllocation[];
  readonly selectionArm: SelectionArm;
  readonly selectionProbability: number | null;
  readonly cutoffReason: string;
  readonly capacityAdmission: boolean;
  readonly algorithmVersion: string;
  readonly tDecisionReady: string;
}

export interface ExposureConstraintResult {
  readonly dimension: keyof ExposureFacts;
  readonly value: string | null;
  readonly limit: number;
  readonly admitted: boolean;
  readonly reason: 'WITHIN_LIMIT' | 'LIMIT_REACHED' | 'DIMENSION_UNAVAILABLE';
}

export interface SelectionResult {
  readonly universe: FrozenEligibleUniverse;
  readonly audits: readonly RankingAuditRecord[];
  readonly canonicalAuditJson: string;
}

function assertIsoZ(value: string, field: string): void {
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new RangeError(`${field} must be an ISO-8601 Z timestamp`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalSelectionJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Freeze before any ranking. Candidate order is normalized so iteration order is irrelevant. */
export function freezeEligibleUniverse(
  input: Omit<FrozenEligibleUniverse, 'candidateIds' | 'fingerprint'> & {
    readonly candidateIds: readonly string[];
  },
): FrozenEligibleUniverse {
  assertIsoZ(input.tDecisionReady, 'tDecisionReady');
  const candidateIds = [...input.candidateIds].sort((a, b) => a.localeCompare(b));
  if (candidateIds.length !== new Set(candidateIds).size)
    throw new RangeError('eligible universe contains duplicate candidates');
  if (
    [
      input.universeId,
      input.profileId,
      input.profileVersion,
      input.rankingVersion,
      input.algorithmVersion,
      ...candidateIds,
    ].some((v) => v.trim() === '')
  ) {
    throw new RangeError('frozen universe identifiers and versions are required');
  }
  const frozen = { ...input, candidateIds };
  return Object.freeze({ ...frozen, fingerprint: fnv1a(canonicalSelectionJson(frozen)) });
}

export function assertFrozenUniverse(
  universe: FrozenEligibleUniverse,
  candidates: readonly CandidateSelectionInput[],
): void {
  const expected = freezeEligibleUniverse({ ...universe, candidateIds: universe.candidateIds });
  const actualIds = [...candidates.map((candidate) => candidate.candidateId)].sort((a, b) =>
    a.localeCompare(b),
  );
  if (
    expected.fingerprint !== universe.fingerprint ||
    canonicalSelectionJson(actualIds) !== canonicalSelectionJson(universe.candidateIds)
  ) {
    throw new Error('FROZEN_UNIVERSE_DRIFT');
  }
}

/** Step 1: validate that every resolved fact existed no later than T_decision_ready. */
export function resolvePointInTime(
  candidate: CandidateSelectionInput,
  tDecisionReady: string,
): ResolvedPointInTimeState {
  assertIsoZ(tDecisionReady, 'tDecisionReady');
  assertIsoZ(candidate.pointInTime.availableAt, 'availableAt');
  assertIsoZ(candidate.pointInTime.resolvedAt, 'resolvedAt');
  if (
    candidate.pointInTime.sourceIds.length === 0 ||
    candidate.pointInTime.identityId.trim() === '' ||
    candidate.pointInTime.programVersion.trim() === ''
  ) {
    throw new Error('POINT_IN_TIME_RESOLUTION_INCOMPLETE');
  }
  if (
    Date.parse(candidate.pointInTime.availableAt) > Date.parse(tDecisionReady) ||
    Date.parse(candidate.pointInTime.resolvedAt) > Date.parse(tDecisionReady)
  ) {
    throw new Error('POINT_IN_TIME_FUTURE_INPUT');
  }
  return candidate.pointInTime;
}

/** Step 2. Capacity admission is itself a hard gate. */
export function passesHardGates(candidate: CandidateSelectionInput): boolean {
  return (
    candidate.capacityAdmitted &&
    candidate.gates.length > 0 &&
    candidate.gates.every((gate) => !gate.hard || gate.passed)
  );
}

/** Step 3: require the complete seven-vector shape. */
export function validateSevenVectors(vectors: CandidateVectorSet): CandidateVectorSet {
  const actual = [
    vectors.opportunity.kind,
    vectors.risk.kind,
    vectors.dataQuality.kind,
    vectors.urgency.kind,
    vectors.novelty.kind,
    vectors.tradability.kind,
    vectors.sourceIndependence.kind,
  ];
  const expected = [
    'OPPORTUNITY',
    'RISK',
    'DATA_QUALITY',
    'URGENCY',
    'NOVELTY',
    'TRADABILITY',
    'SOURCE_INDEPENDENCE',
  ];
  if (actual.some((kind, index) => kind !== expected[index]))
    throw new Error('SEVEN_VECTOR_SET_INCOMPLETE');
  return vectors;
}

/** Step 4: cohort metadata may be low sample but is never silently absent. */
export function validateRobustCohorts(
  values: readonly RobustCohortValue[],
): readonly RobustCohortValue[] {
  for (const value of values) {
    if (
      value.name.trim() === '' ||
      value.fallbackLevel.trim() === '' ||
      value.qualityCodes.length === 0 ||
      !Number.isInteger(value.sampleSize) ||
      value.sampleSize < 0 ||
      !Number.isFinite(value.effectiveSampleSize) ||
      value.effectiveSampleSize < 0
    ) {
      throw new Error('ROBUST_COHORT_METADATA_INCOMPLETE');
    }
  }
  return values;
}

/** Step 5: required scenarios must use the exact resolved proven adapter/version. */
export function validateExecutionScenarios(
  candidate: CandidateSelectionInput,
): readonly RequiredExecutionScenario[] {
  const required = candidate.executionScenarios.filter((scenario) => scenario.required);
  if (required.length === 0) throw new Error('REQUIRED_EXECUTION_SCENARIO_MISSING');
  for (const scenario of required) {
    if (
      !scenario.proven ||
      scenario.adapterId !== candidate.pointInTime.adapterId ||
      scenario.adapterVersion !== candidate.pointInTime.adapterVersion
    ) {
      throw new Error('UNPROVEN_OR_MISMATCHED_EXECUTION_ADAPTER');
    }
  }
  return candidate.executionScenarios;
}

/** Step 6: null is retained when no required scenario supplies a measurement. */
export function conservativeFeasibilityEnvelope(
  scenarios: readonly RequiredExecutionScenario[],
): FeasibilityEnvelope {
  const required = scenarios.filter((scenario) => scenario.required);
  const finite = (values: readonly (number | null)[], mode: 'min' | 'max'): number | null => {
    const known = values.filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
    return known.length === 0 ? null : mode === 'min' ? Math.min(...known) : Math.max(...known);
  };
  return {
    requiredScenariosPassed:
      required.length > 0 && required.every((scenario) => scenario.proven && scenario.passed),
    maximumExecutableNotional: finite(
      required.map((scenario) => scenario.maximumExecutableNotional),
      'min',
    ),
    worstRequiredNetUtility: finite(
      required.map((scenario) => scenario.netUtility),
      'min',
    ),
    actionabilityRemaining: finite(
      required.map((scenario) => scenario.actionabilityRemaining),
      'min',
    ),
    stateComplete: required.length > 0 && required.every((scenario) => scenario.stateComplete),
    maximumUncertainty: finite(
      required.map((scenario) => scenario.uncertainty),
      'max',
    ),
  };
}

/** Step 7. */
export function passesRobustExecution(
  candidate: CandidateSelectionInput,
  envelope: FeasibilityEnvelope,
): boolean {
  return (
    passesHardGates(candidate) &&
    envelope.requiredScenariosPassed &&
    envelope.stateComplete &&
    candidate.vectors.tradability.feasible
  );
}

const PARETO_DIRECTIONS = ['max', 'min', 'max', 'max', 'max'] as const;
function paretoValues(candidate: CandidateSelectionInput): readonly (number | null)[] {
  return [
    candidate.sortKeys.emergencePersistencePercentile,
    candidate.sortKeys.riskClass,
    candidate.sortKeys.dataQuality,
    candidate.sortKeys.novelty,
    candidate.sortKeys.remainingActionability,
  ];
}

/** Step 8: an unknown comparison dimension prevents either candidate dominating. */
export function paretoStatus(
  candidate: CandidateSelectionInput,
  universe: readonly CandidateSelectionInput[],
): ParetoStatus {
  const own = paretoValues(candidate);
  let unknownBlocked = own.some((value) => value === null);
  for (const other of universe) {
    if (other.candidateId === candidate.candidateId) continue;
    const theirs = paretoValues(other);
    if ([...own, ...theirs].some((value) => value === null)) {
      unknownBlocked = true;
      continue;
    }
    let noWorse = true;
    let strictlyBetter = false;
    for (let index = 0; index < own.length; index += 1) {
      const otherValue = theirs[index] as number;
      const ownValue = own[index] as number;
      const delta =
        PARETO_DIRECTIONS[index] === 'max' ? otherValue - ownValue : ownValue - otherValue;
      if (delta < 0) noWorse = false;
      if (delta > 0) strictlyBetter = true;
    }
    if (noWorse && strictlyBetter) return 'DOMINATED';
  }
  return unknownBlocked ? 'UNKNOWN_DIMENSION_BLOCKED' : 'EFFICIENT';
}

function descendingNullable(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}
function ascendingNullable(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}

/** Step 9: exact Appendix-I keys a–g, followed only by stable candidate identity. */
export function compareExploitationCandidates(
  a: CandidateSelectionInput,
  b: CandidateSelectionInput,
): number {
  const ak = a.sortKeys;
  const bk = b.sortKeys;
  return (
    ak.riskClass - bk.riskClass ||
    Number(bk.executionFeasible) - Number(ak.executionFeasible) ||
    descendingNullable(ak.dataQuality, bk.dataQuality) ||
    descendingNullable(ak.effectiveSourceIndependence, bk.effectiveSourceIndependence) ||
    descendingNullable(ak.emergencePersistencePercentile, bk.emergencePersistencePercentile) ||
    descendingNullable(ak.remainingActionability, bk.remainingActionability) ||
    ascendingNullable(ak.priceExtension, bk.priceExtension) ||
    ascendingNullable(ak.crowding, bk.crowding) ||
    descendingNullable(ak.novelty, bk.novelty) ||
    descendingNullable(ak.diversityContribution, bk.diversityContribution) ||
    a.candidateId.localeCompare(b.candidateId)
  );
}

/** Step 10. Missing dimensions are explicit but do not invent a cluster. */
export function applyExposureConstraints(
  candidates: readonly CandidateSelectionInput[],
  limits: ExposureLimits,
): ReadonlyMap<string, readonly ExposureConstraintResult[]> {
  const dimensions = Object.keys(limits) as (keyof ExposureFacts)[];
  const counts = new Map<string, number>();
  const result = new Map<string, readonly ExposureConstraintResult[]>();
  for (const candidate of candidates) {
    let candidateAdmitted = true;
    const records = dimensions.map((dimension): ExposureConstraintResult => {
      const value = candidate.exposures[dimension];
      const limit = limits[dimension];
      if (!Number.isInteger(limit) || limit < 0)
        throw new RangeError(`invalid exposure limit: ${dimension}`);
      if (value === null)
        return { dimension, value, limit, admitted: true, reason: 'DIMENSION_UNAVAILABLE' };
      const key = `${dimension}:${value}`;
      const admitted = candidateAdmitted && (counts.get(key) ?? 0) < limit;
      if (!admitted) candidateAdmitted = false;
      return {
        dimension,
        value,
        limit,
        admitted,
        reason: admitted ? 'WITHIN_LIMIT' : 'LIMIT_REACHED',
      };
    });
    if (candidateAdmitted) {
      for (const record of records)
        if (record.value !== null)
          counts.set(
            `${record.dimension}:${record.value}`,
            (counts.get(`${record.dimension}:${record.value}`) ?? 0) + 1,
          );
    }
    result.set(candidate.candidateId, records);
  }
  return result;
}

/** Step 11: only the proven protected vocabulary is accepted. */
export function validateProtectedAllocations(
  allocations: readonly ProtectedAllocation[],
): readonly ProtectedAllocation[] {
  const protectedClasses: readonly Reserve[] = [
    ReserveClass.RISK_MONITORING,
    ReserveClass.ALERT_VERIFICATION,
    ReserveClass.OUTCOME_COLLECTION,
    ReserveClass.INTERACTIVE_MCP,
  ];
  for (const allocation of allocations) {
    if (
      !protectedClasses.includes(allocation.reserveClass) ||
      !Number.isInteger(allocation.units) ||
      allocation.units < 0
    )
      throw new Error('INVALID_PROTECTED_ALLOCATION');
  }
  return allocations;
}

function armForIndex(index: number, budgets: SelectionPolicy['armBudgets']): SelectionArm {
  const ordered: readonly Exclude<SelectionArm, 'NOT_SELECTED'>[] = [
    'EXPLOITATION',
    'UNCERTAINTY',
    'RANDOM_EXPLORATION',
    'EVIDENCE_PROBE',
    'OUTCOME_OBSERVATION_ONLY',
  ];
  let cursor = index;
  for (const arm of ordered) {
    const amount = budgets[arm];
    if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`invalid arm budget: ${arm}`);
    if (cursor < amount) return arm;
    cursor -= amount;
  }
  return 'NOT_SELECTED';
}

/** Steps 1–13 orchestration. Randomized arms are assigned later by the seeded exploration seam. */
export function runDeterministicSelection(
  universe: FrozenEligibleUniverse,
  candidates: readonly CandidateSelectionInput[],
  policy: SelectionPolicy,
): SelectionResult {
  assertFrozenUniverse(universe, candidates);
  validateProtectedAllocations(policy.protectedAllocations);
  const prepared = candidates.map((candidate) => {
    resolvePointInTime(candidate, universe.tDecisionReady);
    validateSevenVectors(candidate.vectors);
    validateRobustCohorts(candidate.cohorts);
    validateExecutionScenarios(candidate);
    return { candidate, envelope: conservativeFeasibilityEnvelope(candidate.executionScenarios) };
  });
  const survivors = prepared
    .filter(({ candidate, envelope }) => passesRobustExecution(candidate, envelope))
    .map(({ candidate }) => candidate);
  const statuses = new Map(
    candidates.map(
      (candidate) =>
        [
          candidate.candidateId,
          passesHardGates(candidate) ? paretoStatus(candidate, survivors) : 'DOMINATED',
        ] as const,
    ),
  );
  const ranked = survivors
    .filter((candidate) => statuses.get(candidate.candidateId) !== 'DOMINATED')
    .sort(compareExploitationCandidates);
  const constraints = applyExposureConstraints(ranked, policy.exposureLimits);
  const admitted = ranked.filter((candidate) =>
    constraints.get(candidate.candidateId)?.every((record) => record.admitted),
  );
  const rankById = new Map(ranked.map((candidate, index) => [candidate.candidateId, index + 1]));
  const admittedIndex = new Map(admitted.map((candidate, index) => [candidate.candidateId, index]));
  const audits = [...candidates]
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId))
    .map((candidate): RankingAuditRecord => {
      const preparedCandidate = prepared.find(
        (entry) => entry.candidate.candidateId === candidate.candidateId,
      ) as (typeof prepared)[number];
      const status = statuses.get(candidate.candidateId) as ParetoStatus;
      const index = admittedIndex.get(candidate.candidateId);
      const arm = index === undefined ? 'NOT_SELECTED' : armForIndex(index, policy.armBudgets);
      const hardPassed = passesHardGates(candidate);
      const robustPassed = passesRobustExecution(candidate, preparedCandidate.envelope);
      const exposure = constraints.get(candidate.candidateId) ?? [];
      const cutoffReason =
        !hardPassed || !robustPassed
          ? 'HARD_GATE_FAILED'
          : status === 'DOMINATED'
            ? 'PARETO_DOMINATED'
            : exposure.some((record) => !record.admitted)
              ? 'DIVERSITY_CONSTRAINT'
              : arm === 'NOT_SELECTED'
                ? 'BELOW_BUDGET_CUTOFF'
                : arm === 'RANDOM_EXPLORATION' || arm === 'EVIDENCE_PROBE'
                  ? 'EXPLORATION_ARM'
                  : 'NOT_SELECTED_WITH_REASON';
      return {
        eligibleUniverse: universe,
        candidateId: candidate.candidateId,
        rankAtTime: rankById.get(candidate.candidateId) ?? ranked.length + 1,
        rankingVersion: universe.rankingVersion,
        profileVersion: universe.profileVersion,
        componentValues: candidate.vectors,
        hardGateResults: [...candidate.gates],
        robustCohortValues: [...candidate.cohorts],
        sourceDependence: candidate.sourceDependence,
        adapterScenarioResults: [...candidate.executionScenarios],
        feasibilityEnvelope: preparedCandidate.envelope,
        paretoStatus: status,
        exposureConstraintResults: exposure,
        protectedAllocations: [...policy.protectedAllocations],
        selectionArm: arm,
        selectionProbability: null,
        cutoffReason,
        capacityAdmission: candidate.capacityAdmitted,
        algorithmVersion: universe.algorithmVersion,
        tDecisionReady: universe.tDecisionReady,
      };
    });
  return { universe, audits, canonicalAuditJson: canonicalSelectionJson(audits) };
}
