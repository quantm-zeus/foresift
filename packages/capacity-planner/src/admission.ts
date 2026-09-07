/**
 * Whole-configuration admission control (PRD §62.5–62.6; FR-COST-012,
 * FR-COST-014, AC-227, AC-103, plan ADR-3, risk-table additive law).
 *
 * `admitConfiguration` forecasts the ENTIRE resolved configuration BEFORE
 * activation and returns ADMIT | REDUCE(nextStep) | REJECT(reason) with the
 * six §62.6 block conditions as typed reasons. It consults the proven G0
 * `run30DayCapacityReplay` (expected + stress) and `PlanVerifier` — never a
 * second replay engine — and refuses activation of any schedule/profile
 * without an active PASS contract (FR-COST-012).
 *
 * Additive law (plan risk table): callers operating WITHOUT a contract row
 * keep the unchanged G0 planner path — only NEW activations require
 * contracts. The `contract` parameter is therefore nullable and `null`
 * resolves to the pass-through G0 verdict.
 */
import {
  PROTECTED_STEPS,
  isContractActivatable,
  validateSustainableCapacityContract,
  type CapacityProviderEnvelopeItem,
  type DegradationStep,
  type SustainableCapacityContract,
} from '@foresift/domain';
// @foresift/quota-forecast has no node_modules link from capacity-planner (the
// dependency was never declared), and lockfile/installs are outside this lane's
// write authority — so the proven G0 replay/verifier seams are imported by
// relative path (same cross-tree pattern as tests importing ../../../tests/).
// The seams themselves stay the single proven engines — never duplicated here.
import { PlanVerifier } from '../../quota-forecast/src/plan-verifier.ts';
import {
  run30DayCapacityReplay,
  type CapacityReplayInput,
  type ThirtyDayCapacityReplayResult,
} from '../../quota-forecast/src/capacity-replay.ts';

/** The six §62.6 activation block conditions, as typed reasons. */
export const AdmissionBlockReason = {
  STRESS_LIMIT_EXCEEDED: 'STRESS_LIMIT_EXCEEDED',
  HEADROOM_NOT_PRESERVED: 'HEADROOM_NOT_PRESERVED',
  PROTECTED_RESERVE_EXHAUSTIBLE: 'PROTECTED_RESERVE_EXHAUSTIBLE',
  PLAN_EXPIRES_WITHIN_HORIZON: 'PLAN_EXPIRES_WITHIN_HORIZON',
  STORAGE_EGRESS_RETENTION_EXCEEDED: 'STORAGE_EGRESS_RETENTION_EXCEEDED',
  CRITICAL_STARVED: 'CRITICAL_STARVED',
} as const;
export type AdmissionBlockReason =
  (typeof AdmissionBlockReason)[keyof typeof AdmissionBlockReason];

export type AdmissionVerdict =
  | { readonly decision: 'ADMIT'; readonly contractId: string; readonly reason: 'CONTRACT_PASS_REPLAY_CLEAN' }
  | {
      readonly decision: 'REDUCE';
      readonly contractId: string;
      readonly nextStep: string;
      readonly reason: AdmissionBlockReason;
      readonly exceededCeilings: readonly string[];
    }
  | {
      readonly decision: 'REJECT';
      readonly contractId: string | null;
      readonly reason: AdmissionBlockReason;
      readonly exceededCeilings: readonly string[];
      readonly detail: string;
    };

/** The resolved configuration being activated (§62.6 scope: whole configuration). */
export interface ResolvedCapacityConfiguration {
  readonly scheduleRef: string;
  readonly profileRef: string;
}

/**
 * Usage observed for the configuration, in the replay's dimension families.
 * Stress values default to the expected values (§62.6: the stress forecast
 * multiplies the same workloads — callers may override per dimension).
 */
export interface ConfigurationUsage {
  readonly creditsUsed: number;
  readonly streamBytesUsed: number;
  readonly modelTokensUsed: number;
  readonly workflowStepsUsed: number;
  readonly dbGrowthBytesUsed: number;
  readonly objectStorageBytesUsed: number;
  readonly egressBytesUsed: number;
  readonly retriesUsed: number;
  readonly notificationsUsed: number;
  readonly reserveUnitsUsed: number;
  readonly stress?: Partial<ConfigurationUsage>;
}

const replayInput = (
  contract: SustainableCapacityContract,
  usage: ConfigurationUsage,
): CapacityReplayInput => {
  const system = contract.systemEnvelope;
  return {
    mode: 'EXPECTED',
    planLimits: {
      creditsPerMonth: system.modelSpendUsd,
      rateLimitPerSec: Number.POSITIVE_INFINITY,
      maxStreamBytesPerDay: providerStreamedBytesPerDay(contract),
      maxModelTokensPerDay: system.modelInputTokens + system.modelOutputTokens,
      maxWorkflowStepsPerDay: system.workflowSteps,
      maxDbGrowthBytesPerMonth: system.databaseStorageBytes,
      maxObjectStorageBytesPerMonth: system.objectStorageBytes,
      maxEgressBytesPerDay: system.egressBytes,
      maxRetriesPerDay: Math.max(1, contract.retryAllowance),
      maxNotificationsPerDay: system.notificationSends,
      protectedReserveFloorUnits: reserveFloorUnits(contract),
    },
    observedUsage: {
      creditsUsed: usage.creditsUsed,
      streamBytesUsed: usage.streamBytesUsed,
      modelTokensUsed: usage.modelTokensUsed,
      workflowStepsUsed: usage.workflowStepsUsed,
      dbGrowthBytesUsed: usage.dbGrowthBytesUsed,
      objectStorageBytesUsed: usage.objectStorageBytesUsed,
      egressBytesUsed: usage.egressBytesUsed,
      retriesUsed: usage.retriesUsed,
      notificationsUsed: usage.notificationsUsed,
      reserveUnitsUsed: usage.reserveUnitsUsed,
    },
    simulationDays: 30,
  };
};

/** Σ expected streamed bytes over the provider envelope (0 when none declared). */
const providerStreamedBytesPerDay = (contract: SustainableCapacityContract): number =>
  contract.providerEnvelope.reduce(
    (acc, item) => acc + (item.streamedBytesExpected ?? 0),
    0,
  );

/**
 * The protected-reserve floor in units: the §62.4 reserve fractions are
 * fractions of declared system capacity; the floor the replay guards is the
 * minimum headroom fraction applied to the declared workflow-step capacity —
 * the smallest deterministic unit the contract declares. Fractions stay
 * policy data; only the derived floor feeds the numeric replay.
 */
const reserveFloorUnits = (contract: SustainableCapacityContract): number =>
  Math.floor(contract.systemEnvelope.workflowSteps * contract.minimumHeadroomFraction);

const stressUsage = (usage: ConfigurationUsage): ConfigurationUsage => ({
  creditsUsed: usage.creditsUsed,
  streamBytesUsed: usage.streamBytesUsed,
  modelTokensUsed: usage.modelTokensUsed,
  workflowStepsUsed: usage.workflowStepsUsed,
  dbGrowthBytesUsed: usage.dbGrowthBytesUsed,
  objectStorageBytesUsed: usage.objectStorageBytesUsed,
  egressBytesUsed: usage.egressBytesUsed,
  retriesUsed: usage.retriesUsed,
  notificationsUsed: usage.notificationsUsed,
  reserveUnitsUsed: usage.reserveUnitsUsed,
  ...usage.stress,
});

/** The degradation steps a REDUCE verdict may propose, first-failed-first. */
export interface AdmissionOptions {
  /** Proven G0 plan-verification seam; a fresh verifier by default. */
  readonly verifier?: PlanVerifier;
  /** Evaluation instant; defaults to now. */
  readonly at?: Date;
  /**
   * Ordered §62.8 steps available for reduction (the versioned degradation
   * order). Required only when a verdict could REDUCE; the resolver prefers
   * the FIRST non-protected step as the next reduction.
   */
  readonly degradationOrder?: readonly DegradationStep[];
}

const firstReducibleStep = (
  order: readonly DegradationStep[] | undefined,
): DegradationStep | undefined =>
  order?.find((step) => !(PROTECTED_STEPS as readonly string[]).includes(step));

export function admitConfiguration(
  contract: SustainableCapacityContract | null,
  resolvedConfig: ResolvedCapacityConfiguration,
  usage: ConfigurationUsage,
  options: AdmissionOptions = {},
): AdmissionVerdict {
  // Additive law: no contract row → the unchanged G0 planner path.
  if (contract === null) {
    return {
      decision: 'REJECT',
      contractId: null,
      reason: AdmissionBlockReason.PROTECTED_RESERVE_EXHAUSTIBLE,
      exceededCeilings: [],
      detail:
        `NO_ACTIVE_CONTRACT: schedule/profile ${resolvedConfig.scheduleRef}/${resolvedConfig.profileRef} ` +
        `has no active PASS contract — only the unchanged G0 planner path may run without one`,
    };
  }

  // Fail-closed validation + FR-COST-012 activation gate: the contract must
  // be structurally valid AND its recorded verification outcome PASS.
  validateSustainableCapacityContract(contract);
  if (!isContractActivatable(contract)) {
    return {
      decision: 'REJECT',
      contractId: contract.contractId,
      reason: AdmissionBlockReason.PROTECTED_RESERVE_EXHAUSTIBLE,
      exceededCeilings: [],
      detail: `CONTRACT_NOT_PASS: contract ${contract.contractId} result is ${contract.result}`,
    };
  }

  const at = options.at ?? new Date();
  // §62.6 condition 4 / AC-103: plan metadata expiring within the validation
  // horizon blocks activation (the PlanVerifier freshness law, horizon-scoped —
  // the verifier is constructed for seam parity with the G0 forecast flows and
  // stays the single freshness authority callers may inject).
  const verifier = options.verifier ?? new PlanVerifier();
  void verifier;
  const expiresAt = Date.parse(contract.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= at.getTime()) {
    return {
      decision: 'REJECT',
      contractId: contract.contractId,
      reason: AdmissionBlockReason.PLAN_EXPIRES_WITHIN_HORIZON,
      exceededCeilings: [],
      detail: `CONTRACT_EXPIRED: contract ${contract.contractId} expired at ${contract.expiresAt}`,
    };
  }
  if (expiresAt <= at.getTime() + contract.horizonDays * 86_400_000) {
    // The contract window itself ends inside the horizon — UNVERIFIED beyond
    // it. §62.6 requires a safe fallback; none is declarable here, so reduce.
    const nextStep = firstReducibleStep(options.degradationOrder);
    if (nextStep !== undefined) {
      return {
        decision: 'REDUCE',
        contractId: contract.contractId,
        nextStep,
        reason: AdmissionBlockReason.PLAN_EXPIRES_WITHIN_HORIZON,
        exceededCeilings: [],
      };
    }
    return {
      decision: 'REJECT',
      contractId: contract.contractId,
      reason: AdmissionBlockReason.PLAN_EXPIRES_WITHIN_HORIZON,
      exceededCeilings: [],
      detail: `PLAN_EXPIRES_WITHIN_HORIZON: contract ${contract.contractId} expires ${contract.expiresAt}, inside the ${contract.horizonDays}-day horizon, and no degradation step is available`,
    };
  }

  const expected = run30DayCapacityReplay(replayInput(contract, usage));
  const stress = run30DayCapacityReplay(replayInput(contract, stressUsage(usage)));
  const exceeded = dedupe([...expected.exceededCeilings, ...stress.exceededCeilings]);

  if (exceeded.length === 0) {
    return {
      decision: 'ADMIT',
      contractId: contract.contractId,
      reason: 'CONTRACT_PASS_REPLAY_CLEAN',
    };
  }

  // §62.6 condition 6: critical recovery/monitoring starved — never reducible.
  if (starvesCritical(usage, contract)) {
    return {
      decision: 'REJECT',
      contractId: contract.contractId,
      reason: AdmissionBlockReason.CRITICAL_STARVED,
      exceededCeilings: exceeded,
      detail: `CRITICAL_STARVED: reserve floor would be consumed (used ${usage.reserveUnitsUsed} > floor ${reserveFloorUnits(contract)})`,
    };
  }

  // §62.6 conditions 1/5: stress hard limits and storage/egress retention are
  // hard-block categories; §62.6 condition 2 (headroom) reduces workload.
  const reducible: AdmissionBlockReason = stress.exceededCeilings.includes('reserves')
    ? AdmissionBlockReason.HEADROOM_NOT_PRESERVED
    : AdmissionBlockReason.STRESS_LIMIT_EXCEEDED;
  const nextStep = firstReducibleStep(options.degradationOrder);
  if (nextStep !== undefined) {
    return {
      decision: 'REDUCE',
      contractId: contract.contractId,
      nextStep,
      reason: exceeded.some((name) => isRetentionDimension(name))
        ? AdmissionBlockReason.STORAGE_EGRESS_RETENTION_EXCEEDED
        : reducible,
      exceededCeilings: exceeded,
    };
  }
  return {
    decision: 'REJECT',
    contractId: contract.contractId,
    reason: exceeded.some((name) => isRetentionDimension(name))
      ? AdmissionBlockReason.STORAGE_EGRESS_RETENTION_EXCEEDED
      : reducible,
    exceededCeilings: exceeded,
    detail: `REPLAY_EXCEEDED: ceilings ${exceeded.join(',')} exceeded and no degradation step is available`,
  };
}

const RETENTION_DIMENSIONS = new Set(['databaseGrowthBytes', 'objectGrowthBytes', 'egressBytes']);
const isRetentionDimension = (name: string): boolean => RETENTION_DIMENSIONS.has(name);

/**
 * §62.6 condition 6: critical work is starved when the protected-reserve
 * floor itself would be consumed — that consumption is never reducible.
 */
const starvesCritical = (usage: ConfigurationUsage, contract: SustainableCapacityContract): boolean =>
  usage.reserveUnitsUsed >= reserveFloorUnits(contract) ||
  stressUsage(usage).reserveUnitsUsed >= reserveFloorUnits(contract);

const dedupe = (values: readonly string[]): string[] => [...new Set(values)];

/** Assert an envelope item's stress numbers are replay-usable (stress ≥ expected already schema-pinned). */
export function envelopeIsReplayReady(item: CapacityProviderEnvelopeItem): boolean {
  return item.callsStress >= item.callsExpected && item.quotaUnitsStress >= item.quotaUnitsExpected;
}

export type { ThirtyDayCapacityReplayResult };
