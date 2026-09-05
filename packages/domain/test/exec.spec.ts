import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as Record<string, unknown>;
const fn = (name: string): ((...args: unknown[]) => unknown) =>
  (Domain[name] as ((...args: unknown[]) => unknown) | undefined) ?? (() => undefined);

const ALL_OUTCOME_CLASSES = (Domain.ALL_OUTCOME_CLASSES as string[] | undefined) ?? [];
const OutcomeClass = (Domain.OutcomeClass as Record<string, string> | undefined) ?? {};

const ALL_OUTCOME_MATURITIES = (Domain.ALL_OUTCOME_MATURITIES as string[] | undefined) ?? [];
const OutcomeMaturity = (Domain.OutcomeMaturity as Record<string, string> | undefined) ?? {};

const ALL_ADAPTER_FAMILIES = (Domain.ALL_ADAPTER_FAMILIES as string[] | undefined) ?? [];
const AdapterFamily = (Domain.AdapterFamily as Record<string, string> | undefined) ?? {};

const ALL_ADAPTER_SUPPORT_STATES = (Domain.ALL_ADAPTER_SUPPORT_STATES as string[] | undefined) ?? [];
const AdapterSupportState = (Domain.AdapterSupportState as Record<string, string> | undefined) ?? {};

const ALL_EXECUTION_STATUSES = (Domain.ALL_EXECUTION_STATUSES as string[] | undefined) ?? [];
const ExecutionStatus = (Domain.ExecutionStatus as Record<string, string> | undefined) ?? {};

const ALL_STRESS_SCENARIO_KINDS = (Domain.ALL_STRESS_SCENARIO_KINDS as string[] | undefined) ?? [];
const StressScenarioKind = (Domain.StressScenarioKind as Record<string, string> | undefined) ?? {};

const ALL_EXIT_POLICY_KINDS = (Domain.ALL_EXIT_POLICY_KINDS as string[] | undefined) ?? [];
const ExitPolicyKind = (Domain.ExitPolicyKind as Record<string, string> | undefined) ?? {};

const ALL_PRIMARY_ORDERINGS = (Domain.ALL_PRIMARY_ORDERINGS as string[] | undefined) ?? [];
const PrimaryOrdering = (Domain.PrimaryOrdering as Record<string, string> | undefined) ?? {};

const ALL_OBSERVATION_PLAN_TRIGGER_CLASSES =
  (Domain.ALL_OBSERVATION_PLAN_TRIGGER_CLASSES as string[] | undefined) ?? [];
const ObservationPlanTriggerClass =
  (Domain.ObservationPlanTriggerClass as Record<string, string> | undefined) ?? {};

const outcomeLabelPrecedence = fn('outcomeLabelPrecedence');
const signalCannotRenderProfit = fn('signalCannotRenderProfit');
const tradabilityBlocksConfirmedOpportunity = fn('tradabilityBlocksConfirmedOpportunity');
const executableTargetSatisfied = fn('executableTargetSatisfied');
const uncertaintyBlocksTradability = fn('uncertaintyBlocksTradability');
const robustDelayGate = fn('robustDelayGate');
const adverseOrderingRequired = fn('adverseOrderingRequired');

describe('T001: Execution domain vocabularies and fail-closed parsing (§64, §8, FR-EXEC-001…022)', () => {
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

  it('declares the AdapterSupportState vocabulary', () => {
    const expected = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'].sort();
    expect([...ALL_ADAPTER_SUPPORT_STATES].sort()).toEqual(expected as never);
  });

  it('declares the ExecutionStatus vocabulary', () => {
    const expected = [
      'EXECUTED_FULL',
      'EXECUTION_PARTIAL',
      'EXECUTION_UNAVAILABLE',
      'POOL_MATH_UNSUPPORTED',
      'INSUFFICIENT_DATA',
    ].sort();
    expect([...ALL_EXECUTION_STATUSES].sort()).toEqual(expected as never);
  });

  it('declares the §64.10 / FR-EXEC-017 StressScenarioKind vocabulary', () => {
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

  it('declares the §64.7 ExitPolicyKind vocabulary', () => {
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

  it('declares the PrimaryOrdering vocabulary', () => {
    const expected = ['ADVERSE_FEASIBLE', 'UNAMBIGUOUS'].sort();
    expect([...ALL_PRIMARY_ORDERINGS].sort()).toEqual(expected as never);
  });

  it('declares the §64.14 ObservationPlanTriggerClass vocabulary', () => {
    const expected = [
      'DEEP_RESEARCH',
      'EARLY_WATCH',
      'CONFIRMED_OPPORTUNITY',
      'CONTROL_SAMPLE',
      'SHADOW_PORTFOLIO',
    ].sort();
    expect([...ALL_OBSERVATION_PLAN_TRIGGER_CLASSES].sort()).toEqual(expected as never);
  });

  it('fail-closed parse throws typed error on unknown vocabulary values', () => {
    const parse = fn('parseOutcomeClass');
    if (typeof parse === 'function') {
      expect(() => parse('NON_EXISTENT_CLASS')).toThrow();
    }
  });
});

describe('T001: Execution pure laws (§8.2, §64, FR-EXEC-004…020)', () => {
  it('enforces §8.2 outcomeLabelPrecedence hierarchy', () => {
    if (typeof outcomeLabelPrecedence !== 'function') return;

    // Order: INVALID_DATA → CENSORED → PENDING/PARTIALLY_MATURED → TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY → TRADABLE_SUCCESS → TRADABLE_FAILURE → TRADABLE_NEUTRAL
    expect(outcomeLabelPrecedence(['INVALID_DATA', 'TRADABLE_SUCCESS'])).toBe('INVALID_DATA');
    expect(outcomeLabelPrecedence(['CENSORED', 'TRADABLE_SUCCESS'])).toBe('CENSORED');
    expect(outcomeLabelPrecedence(['PENDING', 'TRADABLE_SUCCESS'])).toBe('PENDING');
    expect(outcomeLabelPrecedence(['TRADABLE_SUCCESS', 'TRADABLE_FAILURE'])).toBe('TRADABLE_SUCCESS');
  });

  it('enforces FR-EXEC-006 / INV-011 signalCannotRenderProfit', () => {
    if (typeof signalCannotRenderProfit !== 'function') return;

    // SIGNAL_SUCCESS cannot render profit when TRADABLE_SUCCESS is absent or failed
    expect(
      signalCannotRenderProfit({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'TRADABLE_FAILURE',
      }),
    ).toBe(true);

    expect(
      signalCannotRenderProfit({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'PENDING',
      }),
    ).toBe(true);

    expect(
      signalCannotRenderProfit({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'TRADABLE_SUCCESS',
      }),
    ).toBe(false);
  });

  it('enforces FR-EXEC-007 tradabilityBlocksConfirmedOpportunity while preserving diagnostic signal labels', () => {
    if (typeof tradabilityBlocksConfirmedOpportunity !== 'function') return;

    const res = tradabilityBlocksConfirmedOpportunity({
      signalOutcome: 'SIGNAL_SUCCESS',
      tradableOutcome: 'TRADABLE_FAILURE',
      targetVerdict: 'CONFIRMED_OPPORTUNITY',
    }) as { verdict?: string; diagnosticSignalLabel?: string } | undefined;

    expect(res?.verdict).not.toBe('CONFIRMED_OPPORTUNITY');
    expect(res?.diagnosticSignalLabel).toBe('SIGNAL_SUCCESS');
  });

  it('enforces §64.13 / FR-EXEC-004 executableTargetSatisfied (isolated wick never sufficient)', () => {
    if (typeof executableTargetSatisfied !== 'function') return;

    // 1-slot isolated wick with 0 volume
    expect(
      executableTargetSatisfied({
        touchDurationSlots: 1,
        executableVolumeAtTarget: 0,
        requiredVolume: 1000,
        minDurationSlots: 2,
      }),
    ).toBe(false);

    // Sustained duration or sufficient volume
    expect(
      executableTargetSatisfied({
        touchDurationSlots: 3,
        executableVolumeAtTarget: 2000,
        requiredVolume: 1000,
        minDurationSlots: 2,
      }),
    ).toBe(true);
  });

  it('enforces FR-EXEC-020 uncertaintyBlocksTradability', () => {
    if (typeof uncertaintyBlocksTradability !== 'function') return;

    expect(
      uncertaintyBlocksTradability({
        stateCompleteness: 'INCOMPLETE_BLOCKING',
        uncertaintyBound: 0.25,
        maxAllowedUncertainty: 0.1,
      }),
    ).toBe(true);

    expect(
      uncertaintyBlocksTradability({
        stateCompleteness: 'COMPLETE',
        uncertaintyBound: 0.05,
        maxAllowedUncertainty: 0.1,
      }),
    ).toBe(false);
  });

  it('enforces §64.8 robustDelayGate', () => {
    if (typeof robustDelayGate !== 'function') return;

    // A candidate valid only at 0-delay cannot pass a p90-requiring profile
    expect(
      robustDelayGate({
        profileRequiredDelayPercentile: 'P90_DELAY',
        scenarioPasses: {
          BASE_CASE: true,
          P50_DELAY: false,
          P90_DELAY: false,
        },
      }),
    ).toBe(false);

    expect(
      robustDelayGate({
        profileRequiredDelayPercentile: 'P90_DELAY',
        scenarioPasses: {
          BASE_CASE: true,
          P50_DELAY: true,
          P90_DELAY: true,
        },
      }),
    ).toBe(true);
  });

  it('enforces §64.7 adverseOrderingRequired under ambiguity', () => {
    if (typeof adverseOrderingRequired !== 'function') return;

    expect(
      adverseOrderingRequired({
        hasPathAmbiguity: true,
        primaryOrdering: 'ADVERSE_FEASIBLE',
      }),
    ).toBe(true);

    expect(
      adverseOrderingRequired({
        hasPathAmbiguity: true,
        primaryOrdering: 'OPTIMISTIC',
      }),
    ).toBe(false);
  });
});
