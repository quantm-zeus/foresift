/**
 * FR-EXEC-009 exit-policy experiment registry (AC-128) and
 * §64.14 / FR-EXEC-011 finite observation plans.
 *
 * Experiments: multiple exit policies are evaluated only as pre-registered
 * separate experiments. Exactly one experiment per scenario is the primary;
 * the registry refuses a second primary, refuses unregistered policies at
 * evaluation time, and structurally cannot express a retrospective
 * best-pick — the primary is fixed at registration, before any outcome is
 * observed.
 *
 * Observation plans: finite selective outcome-observation plans with an
 * explicit cadence, field set, sources, duration, quota ceiling, degradation
 * policy, and resolution floor. A sampled plan stores its inclusion
 * probability with stratum and population limits (FR-MAT-007). Insufficient
 * temporal/liquidity resolution cannot prove tradable success — plans below
 * the resolution floor are signal-only.
 *
 * Traces: FR-EXEC-009, FR-EXEC-011, AC-128.
 */
import { ExecErrorCode, ExecVocabularyError } from '@foresift/domain';
import type { ExitPolicyExperiment, OutcomeObservationPlan } from '@foresift/shared-schemas';

export type { ExitPolicyExperiment, OutcomeObservationPlan };

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'EXPERIMENT_FIELD_INVALID',
      field: label,
    });
  }
  return value;
}

export interface RegisterExperimentInput {
  readonly experimentId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  /** §64.7 exit-policy kind — fail-closed validated by the schema layer. */
  readonly exitPolicyKind: string;
  readonly exitPolicyVersionId: string;
  /** Exactly one experiment per scenario may declare isPrimary. */
  readonly isPrimary: boolean;
  readonly registeredAt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/**
 * Append-only experiment registry. `register` refuses a second primary for
 * the same scenario (FR-EXEC-009: the primary is pre-registered before
 * outcomes exist) and refuses duplicate experiment ids.
 */
export class ExitPolicyExperimentRegistry {
  private readonly experiments: ExitPolicyExperiment[] = [];
  private readonly primaryByScenario = new Map<string, string>();

  register(input: RegisterExperimentInput): ExitPolicyExperiment {
    if (input === null || typeof input !== 'object') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
    }
    requireNonEmpty(input.experimentId, 'experimentId');
    requireNonEmpty(input.scenarioId, 'scenarioId');
    requireNonEmpty(input.scenarioVersion, 'scenarioVersion');
    requireNonEmpty(input.exitPolicyKind, 'exitPolicyKind');
    requireNonEmpty(input.exitPolicyVersionId, 'exitPolicyVersionId');
    requireNonEmpty(input.registeredAt, 'registeredAt');
    if (!ISO_Z.test(input.registeredAt)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'EXPERIMENT_FIELD_INVALID',
        field: 'registeredAt',
      });
    }
    if (typeof input.parameters !== 'object' || input.parameters === null) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'EXPERIMENT_FIELD_INVALID',
        field: 'parameters',
      });
    }
    if (typeof input.isPrimary !== 'boolean') {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'EXPERIMENT_FIELD_INVALID',
        field: 'isPrimary',
      });
    }

    if (this.experiments.some((e) => e.experimentId === input.experimentId)) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'EXPERIMENT_ID_ALREADY_REGISTERED',
        experimentId: input.experimentId,
      });
    }
    if (input.isPrimary && this.primaryByScenario.has(input.scenarioId)) {
      // FR-EXEC-009: a retrospective best-pick requires promoting a second
      // primary after outcomes are observed; the registry structurally
      // refuses it.
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'MULTIPLE_PRIMARY_EXPERIMENTS_REFUSED',
        scenarioId: input.scenarioId,
      });
    }

    const experiment: ExitPolicyExperiment = {
      experimentId: input.experimentId,
      scenarioId: input.scenarioId,
      scenarioVersion: input.scenarioVersion,
      exitPolicyKind: input.exitPolicyKind as ExitPolicyExperiment['exitPolicyKind'],
      exitPolicyVersionId: input.exitPolicyVersionId,
      isPrimary: input.isPrimary,
      registeredAt: input.registeredAt,
      parameters: { ...input.parameters },
    };
    this.experiments.push(experiment);
    if (input.isPrimary) this.primaryByScenario.set(input.scenarioId, input.experimentId);
    return experiment;
  }

  /** The pre-registered primary for a scenario (or null). */
  primaryOf(scenarioId: string): ExitPolicyExperiment | null {
    const id = this.primaryByScenario.get(scenarioId);
    return id === undefined ? null : (this.experiments.find((e) => e.experimentId === id) ?? null);
  }

  /** Secondary experiments are advisory; their results never replace the primary. */
  secondariesOf(scenarioId: string): readonly ExitPolicyExperiment[] {
    return this.experiments.filter((e) => e.scenarioId === scenarioId && !e.isPrimary);
  }

  get all(): readonly ExitPolicyExperiment[] {
    return [...this.experiments];
  }
}

// ---------------------------------------------------------------------------
// §64.14 / FR-EXEC-011 observation plans
// ---------------------------------------------------------------------------

export interface IssueObservationPlanInput {
  readonly planId: string;
  readonly planVersion: string;
  readonly candidateId: string;
  readonly triggerClass: string;
  /** Observation cadence in seconds (≥ 1). */
  readonly cadenceSeconds: number;
  readonly observedFields: readonly string[];
  readonly providerSourceIds: readonly string[];
  /** Total plan duration in seconds (finiteness law: the plan ends). */
  readonly durationSeconds: number;
  /** Quota ceiling (record of named budgets). */
  readonly quotaCeiling: Readonly<Record<string, unknown>>;
  readonly degradationPolicyId: string;
  readonly resolutionFloor: {
    readonly temporalSeconds: number;
    readonly poolStateComplete: boolean;
    readonly liquidityDepthMinUsd: string;
  };
  /** Sampled plans carry inclusion probability + stratum + population limit. */
  readonly inclusionProbability: number | null;
  readonly stratum: string | null;
  readonly populationLimit: string | null;
  readonly registeredAt: string;
}

/**
 * Issue a finite observation plan. Fails closed on: infinite/open-ended
 * duration, empty field/source sets, missing quota ceiling or degradation
 * policy, sampled plans missing stratum/population limits, and probability
 * outside [0,1].
 */
export function issueObservationPlan(input: IssueObservationPlanInput): OutcomeObservationPlan {
  if (input === null || typeof input !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, input);
  }
  requireNonEmpty(input.planId, 'planId');
  requireNonEmpty(input.planVersion, 'planVersion');
  requireNonEmpty(input.candidateId, 'candidateId');
  requireNonEmpty(input.triggerClass, 'triggerClass');
  requireNonEmpty(input.degradationPolicyId, 'degradationPolicyId');
  requireNonEmpty(input.registeredAt, 'registeredAt');
  if (!ISO_Z.test(input.registeredAt)) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'PLAN_FIELD_INVALID',
      field: 'registeredAt',
    });
  }
  if (!Number.isInteger(input.cadenceSeconds) || input.cadenceSeconds < 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'PLAN_FIELD_INVALID',
      field: 'cadenceSeconds',
    });
  }
  // FR-EXEC-011 finiteness: an open-ended plan is refused — observation is
  // bounded in duration and quota.
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'PLAN_DURATION_NOT_FINITE',
      durationSeconds: input.durationSeconds,
    });
  }
  if (
    !Array.isArray(input.observedFields) ||
    input.observedFields.length === 0 ||
    input.observedFields.some((f) => typeof f !== 'string' || f.length === 0)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'PLAN_FIELD_INVALID',
      field: 'observedFields',
    });
  }
  if (
    !Array.isArray(input.providerSourceIds) ||
    input.providerSourceIds.length === 0 ||
    input.providerSourceIds.some((s) => typeof s !== 'string' || s.length === 0)
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'PLAN_FIELD_INVALID',
      field: 'providerSourceIds',
    });
  }
  if (typeof input.quotaCeiling !== 'object' || input.quotaCeiling === null) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'PLAN_QUOTA_CEILING_REQUIRED',
    });
  }
  if (
    typeof input.resolutionFloor !== 'object' ||
    input.resolutionFloor === null ||
    !Number.isInteger(input.resolutionFloor.temporalSeconds) ||
    input.resolutionFloor.temporalSeconds < 1 ||
    typeof input.resolutionFloor.poolStateComplete !== 'boolean'
  ) {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
      refused: 'PLAN_RESOLUTION_FLOOR_INVALID',
    });
  }

  const sampled =
    input.inclusionProbability !== null &&
    input.inclusionProbability !== undefined;
  if (sampled) {
    const p = input.inclusionProbability as number;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'INCLUSION_PROBABILITY_OUT_OF_BOUNDS',
        value: p,
      });
    }
    if (input.stratum === null || input.populationLimit === null) {
      // FR-MAT-007: a sampled plan stores inclusion probability together
      // with stratum and population limits.
      throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, {
        refused: 'MISSING_OR_INVALID_POPULATION_LIMITS',
      });
    }
  }

  const plan: OutcomeObservationPlan = {
    planId: input.planId,
    planVersion: input.planVersion,
    candidateId: input.candidateId,
    triggerClass: input.triggerClass as OutcomeObservationPlan['triggerClass'],
    cadenceSeconds: input.cadenceSeconds,
    observedFields: [...input.observedFields],
    providerSourceIds: [...input.providerSourceIds],
    durationSeconds: input.durationSeconds,
    quotaCeiling: { ...input.quotaCeiling },
    degradationPolicyId: input.degradationPolicyId,
    resolutionFloor: {
      temporalSeconds: input.resolutionFloor.temporalSeconds,
      poolStateComplete: input.resolutionFloor.poolStateComplete,
      liquidityDepthMinUsd: input.resolutionFloor.liquidityDepthMinUsd,
    },
    inclusionProbability: input.inclusionProbability ?? null,
    stratum: input.stratum ?? null,
    populationLimit: input.populationLimit ?? null,
    registeredAt: input.registeredAt,
  };
  return plan;
}

/**
 * AC-126/AC-128 resolution-floor gate: an observation whose cadence is
 * coarser than the plan's temporal floor, or whose observed liquidity depth
 * is below the plan's minimum, cannot prove tradable success — it supports
 * signal labels only. Returns the rendering ceiling for the observation.
 */
export function resolutionCeilingFor(
  plan: OutcomeObservationPlan,
  observation: {
    readonly effectiveTemporalSeconds: number;
    readonly observedLiquidityDepthUsd: string;
    readonly poolStateComplete: boolean;
  },
): 'TRADABLE_SUCCESS_PROVABLE' | 'SIGNAL_ONLY' {
  if (plan === null || typeof plan !== 'object') {
    throw new ExecVocabularyError(ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID, plan);
  }
  const floor = plan.resolutionFloor;
  if (observation.effectiveTemporalSeconds > floor.temporalSeconds) return 'SIGNAL_ONLY';
  if (!observation.poolStateComplete && floor.poolStateComplete) return 'SIGNAL_ONLY';
  const depth = observation.observedLiquidityDepthUsd;
  const minimum = floor.liquidityDepthMinUsd;
  const [di, df = ''] = depth.split('.');
  const [mi, mf = ''] = minimum.split('.');
  const scale = Math.max(df.length, mf.length);
  if (
    BigInt(di + df.padEnd(scale, '0')) < BigInt(mi + mf.padEnd(scale, '0'))
  ) {
    return 'SIGNAL_ONLY';
  }
  return 'TRADABLE_SUCCESS_PROVABLE';
}
