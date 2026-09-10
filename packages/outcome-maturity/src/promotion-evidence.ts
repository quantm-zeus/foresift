/** Exact-configuration production-promotion evidence gate (FR-MAT-008…012). */
import {
  ErrorCode,
  EvidenceResolution,
  ExpirySideEffect,
  MatError,
  MatPrimaryOrdering,
  MaturityState,
  PromotionOutcomeLabel,
  adverseOrderingPrimacy,
  postExpiryGainsExcluded,
} from '@foresift/domain';
import type {
  ConcurrentShadowAggregate,
  ExecutionScenario,
  ExecutionSimulation,
  PromotionEvidenceRecord,
} from '@foresift/shared-schemas';

export type ModuleMaturity =
  | 'NOT_IMPLEMENTED'
  | 'IMPLEMENTED'
  | 'AVAILABLE'
  | 'SHADOW'
  | 'PROVEN';

export interface LifecycleSideEffect {
  readonly kind: typeof ExpirySideEffect[keyof typeof ExpirySideEffect];
  readonly occurredAt: string;
}

export interface ConcurrentCapacityEvidence {
  readonly aggregate: ConcurrentShadowAggregate;
  readonly maximumExecutableNotional: string;
  readonly totalDeployablePortfolioCapacity: string;
  readonly evidenceRef: string;
}

export interface PromotionEvidenceInput {
  readonly promotionEvidenceId: string;
  readonly outcomeProfileId: string;
  readonly outcomeProfileVersion: string;
  readonly scenario: ExecutionScenario;
  readonly simulation: ExecutionSimulation;
  readonly required: {
    readonly notional: string;
    readonly delayPolicyId: string;
    readonly adapterVersion: string;
    readonly routeId: string;
    readonly exitPolicyId: string;
  };
  readonly actual: {
    readonly delayPolicyId: string;
    readonly adapterVersion: string;
    readonly routeId: string;
  };
  readonly evidenceResolution: typeof EvidenceResolution[keyof typeof EvidenceResolution];
  readonly moduleMaturity: ModuleMaturity;
  readonly profileRequiresProvenModule: boolean;
  readonly targetFeasible: boolean;
  readonly adverseFeasible: boolean;
  readonly orderingKnown: boolean;
  readonly optimisticSensitivity?: Readonly<Record<string, unknown>> | null;
  readonly alertValidUntil: string;
  readonly alertExpiredAt?: string | null;
  readonly lifecycleSideEffects: readonly LifecycleSideEffect[];
  readonly gainObservedAt?: string | null;
  readonly capacityLimited: boolean;
  readonly capacityEvidence?: ConcurrentCapacityEvidence | null;
  readonly largerNotionalSimulationRef?: string | null;
  readonly evidenceRefs?: readonly string[];
  readonly recordedAt: string;
}

export interface PromotionEvidenceEvaluation {
  readonly record: PromotionEvidenceRecord;
  readonly promotionEligible: boolean;
  readonly shadowOnly: boolean;
  readonly refusalReasons: readonly string[];
}

function sameDecimal(left: string, right: string): boolean {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(left) || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(right))
    return false;
  const normalize = (value: string): string => {
    const [whole = '0', fraction = ''] = value.split('.');
    const trimmed = fraction.replace(/0+$/, '');
    return trimmed ? `${whole}.${trimmed}` : whole;
  };
  return normalize(left) === normalize(right);
}

function moduleSupportsClaims(maturity: ModuleMaturity, provenRequired: boolean): boolean {
  if (provenRequired) return maturity === 'PROVEN';
  return maturity === 'AVAILABLE' || maturity === 'PROVEN';
}

function earliestSideEffect(input: PromotionEvidenceInput): LifecycleSideEffect | null {
  const effects: LifecycleSideEffect[] = [...input.lifecycleSideEffects];
  effects.push({ kind: ExpirySideEffect.ALERT_EXPIRED, occurredAt: input.alertValidUntil });
  if (input.alertExpiredAt)
    effects.push({ kind: ExpirySideEffect.ALERT_EXPIRED, occurredAt: input.alertExpiredAt });
  return effects
    .filter((effect) => Number.isFinite(Date.parse(effect.occurredAt)))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))[0] ?? null;
}

/** Evaluate and materialize a complete immutable promotion-evidence record. */
export function evaluatePromotionEvidence(input: PromotionEvidenceInput): PromotionEvidenceEvaluation {
  const simulation = input.simulation;
  const exactConfigurationMatch =
    simulation.scenarioId === input.scenario.scenarioId &&
    simulation.scenarioVersion === input.scenario.version &&
    sameDecimal(input.required.notional, input.scenario.notionalUsd) &&
    input.required.delayPolicyId === input.actual.delayPolicyId &&
    input.required.adapterVersion === input.actual.adapterVersion &&
    input.required.routeId === input.actual.routeId &&
    input.required.exitPolicyId === input.scenario.exitPolicyVersionId &&
    input.required.exitPolicyId === simulation.exit?.exitPolicyVersionId;
  const highResolution = input.evidenceResolution === EvidenceResolution.HIGH_RESOLUTION_EXECUTION ||
    input.evidenceResolution === EvidenceResolution.EXACT_CONFIGURATION_EXECUTION;
  const moduleEligible = moduleSupportsClaims(input.moduleMaturity, input.profileRequiresProvenModule);
  const ordering = adverseOrderingPrimacy({
    targetFeasible: input.targetFeasible,
    adverseFeasible: input.adverseFeasible,
    orderingKnown: input.orderingKnown,
    optimisticSensitivity: input.optimisticSensitivity,
  });
  const effect = earliestSideEffect(input);
  const gainAt = input.gainObservedAt ?? null;
  const postExpiryExcluded = postExpiryGainsExcluded(gainAt, effect?.occurredAt ?? null);
  const capacityComplete = !input.capacityLimited || (
    input.capacityEvidence !== null && input.capacityEvidence !== undefined &&
    input.capacityEvidence.maximumExecutableNotional.length > 0 &&
    input.capacityEvidence.totalDeployablePortfolioCapacity.length > 0
  );
  const largerThanProven = input.capacityLimited && input.capacityEvidence
    ? Number(input.required.notional) > Number(input.capacityEvidence.maximumExecutableNotional)
    : false;
  const capacityEligible = capacityComplete && (!largerThanProven || Boolean(input.largerNotionalSimulationRef));
  const exactMatureTradable = simulation.tradableLabel === PromotionOutcomeLabel.TRADABLE_SUCCESS &&
    simulation.outcomeMaturity === MaturityState.FULLY_MATURED && highResolution && exactConfigurationMatch;
  const promotionEligible = exactMatureTradable && moduleEligible && !postExpiryExcluded && capacityEligible;

  const refusalReasons: string[] = [];
  if (!exactMatureTradable) refusalReasons.push('EXACT_MATURE_EXECUTION_EVIDENCE_REQUIRED');
  if (!moduleEligible) refusalReasons.push('MODULE_NOT_AVAILABLE_FOR_CLAIMS');
  if (postExpiryExcluded) refusalReasons.push('POST_EXPIRY_GAIN_EXCLUDED');
  if (!capacityEligible) refusalReasons.push('CAPACITY_DISCLOSURE_OR_LARGER_SIMULATION_REQUIRED');

  const record: PromotionEvidenceRecord = {
    promotionEvidenceId: input.promotionEvidenceId,
    candidateId: simulation.candidateId,
    outcomeProfileId: input.outcomeProfileId,
    outcomeProfileVersion: input.outcomeProfileVersion,
    scenarioId: simulation.scenarioId,
    scenarioVersion: simulation.scenarioVersion,
    outcomeLabel: (simulation.tradableLabel ?? PromotionOutcomeLabel.PENDING) as PromotionEvidenceRecord['outcomeLabel'],
    outcomeMaturity: simulation.outcomeMaturity,
    evidenceResolution: input.evidenceResolution,
    requiredNotional: input.required.notional,
    requiredDelayPolicyId: input.required.delayPolicyId,
    requiredAdapterVersion: input.required.adapterVersion,
    requiredRouteId: input.required.routeId,
    requiredExitPolicyId: input.required.exitPolicyId,
    exactConfigurationMatch,
    productionPromotionEligible: promotionEligible,
    primaryOrdering: ordering.primaryOrdering,
    pathAmbiguous: ordering.pathAmbiguous,
    optimisticSensitivity: ordering.pathAmbiguous
      ? (input.optimisticSensitivity ?? null)
      : null,
    expirySideEffect: effect?.kind ?? null,
    expirySideEffectAt: effect?.occurredAt ?? null,
    gainObservedAt: gainAt,
    postExpiryGainExcluded: postExpiryExcluded,
    capacityLimited: input.capacityLimited,
    maximumExecutableNotional: input.capacityEvidence?.maximumExecutableNotional ?? null,
    totalDeployablePortfolioCapacity: input.capacityEvidence?.totalDeployablePortfolioCapacity ?? null,
    largerCapitalSimulationRef: input.largerNotionalSimulationRef ?? null,
    evidenceRefs: [...new Set([
      simulation.simulationId,
      simulation.stateSnapshotId,
      ...(input.capacityEvidence ? [input.capacityEvidence.evidenceRef] : []),
      ...(input.evidenceRefs ?? []),
    ])].sort(),
    recordedAt: input.recordedAt,
    createdAt: input.recordedAt,
  };
  return Object.freeze({
    record: Object.freeze(record),
    promotionEligible,
    shadowOnly: !moduleEligible,
    refusalReasons: Object.freeze(refusalReasons),
  });
}

export function requirePromotionEvidence(input: PromotionEvidenceInput): PromotionEvidenceRecord {
  const evaluation = evaluatePromotionEvidence(input);
  if (!evaluation.promotionEligible) {
    const capacityFailure = evaluation.refusalReasons.includes('CAPACITY_DISCLOSURE_OR_LARGER_SIMULATION_REQUIRED');
    throw new MatError(
      'production promotion evidence is insufficient',
      { reasons: evaluation.refusalReasons.join(',') },
      capacityFailure
        ? ErrorCode.MAT_CAPACITY_DISCLOSURE_MISSING
        : ErrorCode.MAT_PROMOTION_EVIDENCE_INSUFFICIENT,
    );
  }
  return evaluation.record;
}

export { MatPrimaryOrdering };
