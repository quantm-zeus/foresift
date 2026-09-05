/**
 * Colocated domain vocabulary and pure law truth-table tests for Execution Simulation.
 * Traces: FR-EXEC-001, FR-EXEC-004, FR-EXEC-006, FR-EXEC-007, FR-EXEC-013, FR-EXEC-015, FR-EXEC-017, FR-EXEC-020, AC-120, AC-122.
 */
import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as Record<string, unknown>;
const fn = (name: string): ((...args: unknown[]) => unknown) =>
  (Domain[name] as ((...args: unknown[]) => unknown) | undefined) ??
  (() => {
    throw new Error(`Domain function ${name} not implemented yet`);
  });

const ALL_OUTCOME_CLASSES = (Domain.ALL_OUTCOME_CLASSES as string[] | undefined) ?? [];
const OutcomeClass = (Domain.OutcomeClass as Record<string, string> | undefined) ?? {};
const parseOutcomeClass = fn('parseOutcomeClass');

const ALL_OUTCOME_MATURITIES = (Domain.ALL_OUTCOME_MATURITIES as string[] | undefined) ?? [];
const OutcomeMaturity = (Domain.OutcomeMaturity as Record<string, string> | undefined) ?? {};
const parseOutcomeMaturity = fn('parseOutcomeMaturity');

const ALL_ADAPTER_FAMILIES = (Domain.ALL_ADAPTER_FAMILIES as string[] | undefined) ?? [];
const AdapterFamily = (Domain.AdapterFamily as Record<string, string> | undefined) ?? {};
const parseAdapterFamily = fn('parseAdapterFamily');

const ALL_ADAPTER_SUPPORT_STATES = (Domain.ALL_ADAPTER_SUPPORT_STATES as string[] | undefined) ?? [];
const AdapterSupportState = (Domain.AdapterSupportState as Record<string, string> | undefined) ?? {};
const parseAdapterSupportState = fn('parseAdapterSupportState');

const ALL_EXECUTION_STATUSES = (Domain.ALL_EXECUTION_STATUSES as string[] | undefined) ?? [];
const ExecutionStatus = (Domain.ExecutionStatus as Record<string, string> | undefined) ?? {};
const parseExecutionStatus = fn('parseExecutionStatus');

const ALL_STRESS_SCENARIO_KINDS = (Domain.ALL_STRESS_SCENARIO_KINDS as string[] | undefined) ?? [];
const StressScenarioKind = (Domain.StressScenarioKind as Record<string, string> | undefined) ?? {};
const parseStressScenarioKind = fn('parseStressScenarioKind');

const ALL_EXIT_POLICY_KINDS = (Domain.ALL_EXIT_POLICY_KINDS as string[] | undefined) ?? [];
const ExitPolicyKind = (Domain.ExitPolicyKind as Record<string, string> | undefined) ?? {};
const parseExitPolicyKind = fn('parseExitPolicyKind');

const ALL_PRIMARY_ORDERINGS = (Domain.ALL_PRIMARY_ORDERINGS as string[] | undefined) ?? [];
const PrimaryOrdering = (Domain.PrimaryOrdering as Record<string, string> | undefined) ?? {};
const parsePrimaryOrdering = fn('parsePrimaryOrdering');

const ALL_TRADABILITY_VERDICTS = (Domain.ALL_TRADABILITY_VERDICTS as string[] | undefined) ?? [];
const TradabilityVerdict = (Domain.TradabilityVerdict as Record<string, string> | undefined) ?? {};
const parseTradabilityVerdict = fn('parseTradabilityVerdict');

const ALL_OBSERVATION_PLAN_TRIGGER_CLASSES =
  (Domain.ALL_OBSERVATION_PLAN_TRIGGER_CLASSES as string[] | undefined) ?? [];
const ObservationPlanTriggerClass =
  (Domain.ObservationPlanTriggerClass as Record<string, string> | undefined) ?? {};
const parseObservationPlanTriggerClass = fn('parseObservationPlanTriggerClass');

const outcomeLabelPrecedence = fn('outcomeLabelPrecedence');
const signalCannotRenderProfit = fn('signalCannotRenderProfit');
const tradabilityBlocksConfirmedOpportunity = fn('tradabilityBlocksConfirmedOpportunity');
const executableTargetSatisfied = fn('executableTargetSatisfied');
const uncertaintyBlocksTradability = fn('uncertaintyBlocksTradability');
const robustDelayGate = fn('robustDelayGate');
const adverseOrderingRequired = fn('adverseOrderingRequired');

describe('T001: Execution Simulation domain vocabularies and fail-closed parsing (§64, FR-EXEC-001…020)', () => {
  it('declares the §64.12 OutcomeClass vocabulary', () => {
    const expected = [
      'SIGNAL_SUCCESS',
      'SIGNAL_FAILURE',
      'TRADABLE_SUCCESS',
      'TRADABLE_FAILURE',
      'TRADABLE_NEUTRAL',
      'NEUTRAL',
      'PENDING',
      'CENSORED',
      'INVALID_DATA',
    ].sort();
    expect([...ALL_OUTCOME_CLASSES].sort()).toEqual(expected as never);
  });

  it('declares the §8.1 OutcomeMaturity vocabulary', () => {
    const expected = [
      'PENDING',
      'PARTIALLY_MATURED',
      'FULLY_MATURED',
      'CENSORED',
      'INVALID_DATA',
    ].sort();
    expect([...ALL_OUTCOME_MATURITIES].sort()).toEqual(expected as never);
  });

  it('declares the §64.3 / FR-EXEC-015 AdapterFamily vocabulary', () => {
    const expected = [
      'CONSTANT_PRODUCT_AMM',
      'CONCENTRATED_LIQUIDITY_AMM',
      'DISCRETE_LIQUIDITY_BIN_AMM',
      'BONDING_CURVE',
      'STABLE_CURVE',
      'DYNAMIC_FEE_AMM',
      'VIRTUAL_RESERVE',
      'AGGREGATED_MULTI_ROUTE_READ_ONLY',
      'UNKNOWN',
    ].sort();
    expect([...ALL_ADAPTER_FAMILIES].sort()).toEqual(expected as never);
  });

  it('declares AdapterSupportState vocabulary', () => {
    const expected = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'].sort();
    expect([...ALL_ADAPTER_SUPPORT_STATES].sort()).toEqual(expected as never);
  });

  it('declares ExecutionStatus vocabulary', () => {
    const expected = [
      'EXECUTED_FULL',
      'EXECUTION_PARTIAL',
      'EXECUTION_UNAVAILABLE',
      'POOL_MATH_UNSUPPORTED',
      'INSUFFICIENT_DATA',
    ].sort();
    expect([...ALL_EXECUTION_STATUSES].sort()).toEqual(expected as never);
  });

  it('declares FR-EXEC-017 StressScenarioKind vocabulary', () => {
    const expected = [
      'BASE_CASE',
      'P50_DELAY',
      'P90_DELAY',
      'CONSERVATIVE_LATENCY_ADVERSE_SELECTION',
      'LIQUIDITY_DRAWDOWN',
      'FEE_VOLATILITY',
      'ROUTE_DEGRADATION',
      'FAILED_PARTIAL_FILL',
    ].sort();
    expect([...ALL_STRESS_SCENARIO_KINDS].sort()).toEqual(expected as never);
  });

  it('declares §64.7 ExitPolicyKind vocabulary', () => {
    const expected = [
      'FIXED_HORIZON',
      'TAKE_PROFIT_STOP_LOSS',
      'TRAILING_EXIT',
      'STAGED_EXIT',
      'LIQUIDITY_RISK_DETERIORATION',
      'THESIS_INVALIDATION',
    ].sort();
    expect([...ALL_EXIT_POLICY_KINDS].sort()).toEqual(expected as never);
  });

  it('declares PrimaryOrdering vocabulary', () => {
    const expected = ['ADVERSE_FEASIBLE', 'UNAMBIGUOUS'].sort();
    expect([...ALL_PRIMARY_ORDERINGS].sort()).toEqual(expected as never);
  });

  it('declares §64.14 ObservationPlanTriggerClass vocabulary', () => {
    const expected = [
      'DEEP_RESEARCH',
      'EARLY_WATCH',
      'CONFIRMED_OPPORTUNITY',
      'CONTROL_SAMPLE',
      'SHADOW_PORTFOLIO',
    ].sort();
    expect([...ALL_OBSERVATION_PLAN_TRIGGER_CLASSES].sort()).toEqual(expected as never);
  });

  it('refuses invalid vocabulary values fail-closed', () => {
    expect(() => parseOutcomeClass('SUPER_WIN')).toThrow();
    expect(() => parseOutcomeMaturity('ALMOST_DONE')).toThrow();
    expect(() => parseAdapterFamily('UNISWAP_CLONE')).toThrow();
    expect(() => parseStressScenarioKind('OPTIMISTIC_ONLY')).toThrow();
    expect(() => parseExitPolicyKind('YOLO_HOLD')).toThrow();
  });
});

describe('T001: Execution Simulation pure laws truth-tables (§8.2, §64, FR-EXEC-004…020)', () => {
  it('enforces outcomeLabelPrecedence law (§8.2)', () => {
    // Precedence: INVALID_DATA → CENSORED → PENDING/PARTIALLY_MATURED → TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY → TRADABLE_SUCCESS → TRADABLE_FAILURE → TRADABLE_NEUTRAL
    expect(outcomeLabelPrecedence({ isInvalid: true, isCensored: false, tradableOutcome: 'TRADABLE_SUCCESS' })).toBe('INVALID_DATA');
    expect(outcomeLabelPrecedence({ isInvalid: false, isCensored: true, tradableOutcome: 'TRADABLE_SUCCESS' })).toBe('CENSORED');
    expect(outcomeLabelPrecedence({ maturity: 'PENDING', tradableOutcome: 'TRADABLE_SUCCESS' })).toBe('PENDING');
    expect(outcomeLabelPrecedence({ maturity: 'PARTIALLY_MATURED', tradableOutcome: 'TRADABLE_SUCCESS' })).toBe('PARTIALLY_MATURED');
    expect(outcomeLabelPrecedence({ securityOrLiquidityBlocked: true, tradableOutcome: 'TRADABLE_SUCCESS' })).toBe('TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY');
    expect(outcomeLabelPrecedence({ tradableOutcome: 'TRADABLE_SUCCESS' })).toBe('TRADABLE_SUCCESS');
    expect(outcomeLabelPrecedence({ tradableOutcome: 'TRADABLE_FAILURE' })).toBe('TRADABLE_FAILURE');
    expect(outcomeLabelPrecedence({ tradableOutcome: 'TRADABLE_NEUTRAL' })).toBe('TRADABLE_NEUTRAL');
  });

  it('enforces signalCannotRenderProfit pure law (FR-EXEC-006 / INV-011)', () => {
    // SIGNAL_SUCCESS without TRADABLE_SUCCESS cannot render profit
    expect(signalCannotRenderProfit({ signalOutcome: 'SIGNAL_SUCCESS', tradableOutcome: 'TRADABLE_SUCCESS', netProfitUsd: 100 })).toBe(false); // not violating law
    expect(signalCannotRenderProfit({ signalOutcome: 'SIGNAL_SUCCESS', tradableOutcome: 'TRADABLE_FAILURE', netProfitUsd: 100 })).toBe(true); // violating / renders profit from signal alone -> blocked
    expect(signalCannotRenderProfit({ signalOutcome: 'SIGNAL_SUCCESS', tradableOutcome: 'UNTRADABLE_SIGNAL_WIN', netProfitUsd: 0 })).toBe(false);
  });

  it('enforces tradabilityBlocksConfirmedOpportunity preserving diagnostic signal labels (FR-EXEC-007)', () => {
    const verdict = tradabilityBlocksConfirmedOpportunity({
      signalOutcome: 'SIGNAL_SUCCESS',
      tradableStatus: 'EXECUTION_UNAVAILABLE',
    });
    expect(verdict.opportunityPromotionBlocked).toBe(true);
    expect(verdict.diagnosticSignalLabel).toBe('SIGNAL_SUCCESS');
    expect(verdict.tradabilityVerdict).toBe('UNTRADABLE_SIGNAL_WIN');
  });

  it('enforces executableTargetSatisfied pure law (§64.13, FR-EXEC-004)', () => {
    // Isolated wick without sufficient executable volume or target duration is never sufficient
    expect(executableTargetSatisfied({ touchesPrice: true, durationSlots: 1, volumeSufficient: false, durationSufficient: false })).toBe(false);
    expect(executableTargetSatisfied({ touchesPrice: true, durationSlots: 1, volumeSufficient: true, durationSufficient: false })).toBe(true);
    expect(executableTargetSatisfied({ touchesPrice: true, durationSlots: 10, volumeSufficient: false, durationSufficient: true })).toBe(true);
    expect(executableTargetSatisfied({ touchesPrice: false, durationSlots: 10, volumeSufficient: true, durationSufficient: true })).toBe(false);
  });

  it('enforces uncertaintyBlocksTradability pure law (FR-EXEC-020)', () => {
    // Uncertainty bound exceeding policy limit blocks confirmed tradability
    expect(uncertaintyBlocksTradability({ uncertaintyScore: 0.05, policyLimit: 0.1 })).toBe(false);
    expect(uncertaintyBlocksTradability({ uncertaintyScore: 0.15, policyLimit: 0.1 })).toBe(true);
    expect(uncertaintyBlocksTradability({ isStateIncomplete: true, policyLimit: 0.1 })).toBe(true);
  });

  it('enforces robustDelayGate pure law (§64.8)', () => {
    // Candidate valid only at unrealistically short delay cannot pass p90 profile
    expect(robustDelayGate({ profileRequiredDelay: 'P90_DELAY', maxFeasibleDelay: 'P50_DELAY' })).toBe(false);
    expect(robustDelayGate({ profileRequiredDelay: 'P90_DELAY', maxFeasibleDelay: 'P90_DELAY' })).toBe(true);
    expect(robustDelayGate({ profileRequiredDelay: 'P50_DELAY', maxFeasibleDelay: 'P90_DELAY' })).toBe(true);
  });

  it('enforces adverseOrderingRequired pure law (§64.7)', () => {
    // Coarse intervals where both target and invalidation are reachable must yield ADVERSE_FEASIBLE primary ordering
    expect(adverseOrderingRequired({ targetReachable: true, invalidationReachable: true, coarseInterval: true })).toBe(true);
    expect(adverseOrderingRequired({ targetReachable: true, invalidationReachable: false, coarseInterval: true })).toBe(false);
  });
});
