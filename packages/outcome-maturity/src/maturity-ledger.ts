/** Append-only outcome maturity resolution and ledger seam (FR-MAT-001/002). */
import {
  ErrorCode,
  MatError,
  MaturityState,
  assertMaturityTransition,
  type CensorReason,
  type Horizon,
  type InvalidReason,
  type MaturityState as MaturityStateValue,
} from '@foresift/domain';
import type {
  ExecutionSimulation,
  MaturityTransition,
  OutcomeMaturityState,
  OutcomeObservationPlan,
} from '@foresift/shared-schemas';

export interface RequiredOutcomeObservation {
  readonly field: string;
  readonly observedAt: string;
  readonly availableAt: string;
  readonly evidenceRef: string;
  readonly valid: boolean;
}

export interface MaturityDimension {
  readonly candidateId: string;
  readonly outcomeProfileId: string;
  readonly outcomeProfileVersion: string;
  readonly horizon: Horizon;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
}

export interface ResolveMaturityInput extends MaturityDimension {
  readonly simulation: ExecutionSimulation;
  readonly observationPlan: OutcomeObservationPlan;
  /** Profile-defined end of the outcome horizon. */
  readonly horizonCompletedAt: string;
  /** Point-in-time boundary at which maturity is being resolved. */
  readonly asOf: string;
  readonly requiredFields: readonly string[];
  readonly observations: readonly RequiredOutcomeObservation[];
  readonly censorReason?: CensorReason | null;
  readonly invalidReason?: InvalidReason | null;
}

export interface MaturityResolution {
  readonly maturityState: MaturityStateValue;
  readonly maturedAt: string | null;
  readonly censorReason: CensorReason | null;
  readonly invalidReason: InvalidReason | null;
  readonly evidenceRefs: readonly string[];
  readonly missingFields: readonly string[];
  readonly provisional: boolean;
}

function instant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new MatError(
      'invalid maturity timestamp',
      { field, value },
      ErrorCode.MAT_TRANSITION_ILLEGAL,
    );
  return parsed;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function validateSimulationIdentity(input: ResolveMaturityInput): void {
  const simulation = input.simulation;
  if (
    simulation.candidateId !== input.candidateId ||
    simulation.scenarioId !== input.scenarioId ||
    simulation.scenarioVersion !== input.scenarioVersion ||
    simulation.outcomeProfileVersion !== input.outcomeProfileVersion ||
    input.observationPlan.candidateId !== input.candidateId
  ) {
    throw new MatError(
      'execution evidence does not match the maturity dimension',
      { candidateId: input.candidateId, simulationId: simulation.simulationId },
      ErrorCode.MAT_TRANSITION_ILLEGAL,
    );
  }
}

/** Resolve one candidate × profile/horizon/scenario at a frozen boundary. */
export function resolveMaturity(input: ResolveMaturityInput): MaturityResolution {
  validateSimulationIdentity(input);
  const asOf = instant(input.asOf, 'asOf');
  const horizonCompletedAt = instant(input.horizonCompletedAt, 'horizonCompletedAt');
  const simulationAvailableAt = instant(input.simulation.availableAt, 'simulation.availableAt');

  if (input.censorReason && input.invalidReason)
    throw new MatError(
      'an outcome cannot be both censored and invalid',
      { candidateId: input.candidateId },
      ErrorCode.MAT_TRANSITION_ILLEGAL,
    );

  const observations = input.observations.filter(
    (observation) =>
      observation.valid && instant(observation.availableAt, 'observation.availableAt') <= asOf,
  );
  const observedFields = new Set(observations.map((observation) => observation.field));
  const plannedFields = new Set(input.observationPlan.observedFields);
  const missingFields = uniqueSorted(
    input.requiredFields.filter((field) => !plannedFields.has(field) || !observedFields.has(field)),
  );
  const evidenceRefs = uniqueSorted([
    input.simulation.simulationId,
    input.simulation.stateSnapshotId,
    ...observations.map((observation) => observation.evidenceRef),
  ]);

  if (input.invalidReason)
    return {
      maturityState: MaturityState.INVALID_DATA,
      maturedAt: input.asOf,
      censorReason: null,
      invalidReason: input.invalidReason,
      evidenceRefs,
      missingFields,
      provisional: false,
    };
  if (input.censorReason)
    return {
      maturityState: MaturityState.CENSORED,
      maturedAt: input.asOf,
      censorReason: input.censorReason,
      invalidReason: null,
      evidenceRefs,
      missingFields,
      provisional: false,
    };

  const horizonComplete = asOf >= horizonCompletedAt;
  const simulationVisible = simulationAvailableAt <= asOf;
  const fullyObserved = missingFields.length === 0 && simulationVisible;
  const fullyMatured = horizonComplete && fullyObserved;
  const partiallyMatured = observations.length > 0 || horizonComplete || simulationVisible;
  return {
    maturityState: fullyMatured
      ? MaturityState.FULLY_MATURED
      : partiallyMatured
        ? MaturityState.PARTIALLY_MATURED
        : MaturityState.PENDING,
    maturedAt: fullyMatured ? input.asOf : null,
    censorReason: null,
    invalidReason: null,
    evidenceRefs,
    missingFields,
    provisional: !fullyMatured,
  };
}

export function maturityNaturalKey(dimension: MaturityDimension): string {
  return [
    dimension.candidateId,
    dimension.outcomeProfileId,
    dimension.outcomeProfileVersion,
    dimension.horizon,
    dimension.scenarioId,
    dimension.scenarioVersion,
  ]
    .map(encodeURIComponent)
    .join('|');
}

export interface MaturityLedgerStore {
  getInitial(naturalKey: string): OutcomeMaturityState | undefined;
  insertInitial(naturalKey: string, record: OutcomeMaturityState): OutcomeMaturityState;
  listTransitions(maturityStateId: string): readonly MaturityTransition[];
  appendTransition(record: MaturityTransition): MaturityTransition;
}

/** Deterministic in-memory seam useful to adapters and tests; writes are append-only. */
export class InMemoryMaturityLedgerStore implements MaturityLedgerStore {
  readonly #initial = new Map<string, OutcomeMaturityState>();
  readonly #transitions = new Map<string, MaturityTransition[]>();
  readonly #transitionIds = new Map<string, MaturityTransition>();

  getInitial(naturalKey: string): OutcomeMaturityState | undefined {
    return this.#initial.get(naturalKey);
  }

  insertInitial(naturalKey: string, record: OutcomeMaturityState): OutcomeMaturityState {
    const existing = this.#initial.get(naturalKey);
    if (existing) return existing;
    this.#initial.set(
      naturalKey,
      Object.freeze({ ...record, evidenceRefs: [...record.evidenceRefs] }),
    );
    return record;
  }

  listTransitions(maturityStateId: string): readonly MaturityTransition[] {
    return [...(this.#transitions.get(maturityStateId) ?? [])];
  }

  appendTransition(record: MaturityTransition): MaturityTransition {
    const existing = this.#transitionIds.get(record.transitionId);
    if (existing) return existing;
    const records = this.#transitions.get(record.maturityStateId) ?? [];
    const frozen = Object.freeze({ ...record, evidenceRefs: [...record.evidenceRefs] });
    records.push(frozen);
    this.#transitions.set(record.maturityStateId, records);
    this.#transitionIds.set(record.transitionId, frozen);
    return frozen;
  }
}

export interface ApplyMaturityResult {
  readonly initial: OutcomeMaturityState;
  readonly currentState: MaturityStateValue;
  readonly transition: MaturityTransition | null;
  readonly idempotent: boolean;
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}:${parts.map(encodeURIComponent).join(':')}`;
}

/** Natural-key initial upsert plus append-only monotone transition application. */
export class MaturityLedger {
  constructor(private readonly store: MaturityLedgerStore = new InMemoryMaturityLedgerStore()) {}

  apply(input: ResolveMaturityInput): ApplyMaturityResult {
    const resolution = resolveMaturity(input);
    const naturalKey = maturityNaturalKey(input);
    let initial = this.store.getInitial(naturalKey);
    if (!initial) {
      initial = this.store.insertInitial(naturalKey, {
        maturityStateId: stableId('mat', [naturalKey]),
        candidateId: input.candidateId,
        outcomeProfileId: input.outcomeProfileId,
        outcomeProfileVersion: input.outcomeProfileVersion,
        horizon: input.horizon,
        scenarioId: input.scenarioId,
        scenarioVersion: input.scenarioVersion,
        maturityState: resolution.maturityState,
        censorReason: resolution.censorReason,
        invalidReason: resolution.invalidReason,
        maturedAt: resolution.maturedAt,
        observedAt: input.simulation.observedAt,
        availableAt: input.asOf,
        evidenceRefs: [...resolution.evidenceRefs],
        createdAt: input.asOf,
      });
      return { initial, currentState: initial.maturityState, transition: null, idempotent: false };
    }

    const transitions = this.store.listTransitions(initial.maturityStateId);
    const currentState = transitions.at(-1)?.toState ?? initial.maturityState;
    if (currentState === resolution.maturityState)
      return { initial, currentState, transition: null, idempotent: true };

    assertMaturityTransition(currentState, resolution.maturityState);
    const transition = this.store.appendTransition({
      transitionId: stableId('mat-transition', [
        initial.maturityStateId,
        currentState,
        resolution.maturityState,
        input.asOf,
      ]),
      maturityStateId: initial.maturityStateId,
      fromState: currentState,
      toState: resolution.maturityState,
      reason: 'OUTCOME_OBSERVATION_RESOLVED',
      evidenceRefs: [...resolution.evidenceRefs],
      transitionedAt: input.asOf,
      recordedAt: input.asOf,
    });
    return { initial, currentState: transition.toState, transition, idempotent: false };
  }
}

/** §68.2 final denominator predicate: fully matured and valid only. */
export function isFinalDenominatorEligible(input: {
  readonly maturityState: MaturityStateValue;
  readonly censorReason?: CensorReason | null;
  readonly invalidReason?: InvalidReason | null;
}): boolean {
  return (
    input.maturityState === MaturityState.FULLY_MATURED &&
    !input.censorReason &&
    !input.invalidReason
  );
}

export type MaturityReportScope = 'FINAL' | 'PROVISIONAL';

export function maturityReportScope(state: MaturityStateValue): MaturityReportScope {
  return state === MaturityState.FULLY_MATURED ? 'FINAL' : 'PROVISIONAL';
}
