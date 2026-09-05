import { describe, expect, it } from 'bun:test';
import {
  ALL_ADAPTER_FAMILIES,
  ALL_ADAPTER_SUPPORT_STATES,
  ALL_EXECUTION_STATUSES,
  ALL_EXIT_POLICY_KINDS,
  ALL_OBSERVATION_PLAN_TRIGGER_CLASSES,
  ALL_OUTCOME_CLASSES,
  ALL_OUTCOME_MATURITIES,
  ALL_PRECEDENCE_STEPS,
  ALL_PRIMARY_ORDERINGS,
  ALL_REQUIRED_DELAY_ROBUSTNESSES,
  ALL_STRESS_SCENARIO_KINDS,
  ALL_TRADABILITY_VERDICTS,
  AdapterFamily,
  ExecErrorCode,
  ExecVocabularyError,
  OutcomeClass,
  OutcomeMaturity,
  PrecedenceStep,
  PrimaryOrdering,
  StressScenarioKind,
  TradabilityVerdict,
  adapterFamily,
  adapterSupportState,
  adverseOrderingRequired,
  executableTargetSatisfied,
  executionStatus,
  exitPolicyKind,
  observationPlanTriggerClass,
  outcomeClass,
  outcomeLabelPrecedence,
  outcomeMaturity,
  primaryOrdering,
  robustDelayGate,
  signalCannotRenderProfit,
  stressScenarioKind,
  tradabilityBlocksConfirmedOpportunity,
  tradabilityVerdict,
  uncertaintyBlocksTradability,
} from '../src/index.ts';

describe('Execution domain vocabularies and fail-closed parsing (§64, FR-EXEC-001…022)', () => {
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
    const expected = ['PENDING', 'PARTIALLY_MATURED', 'FULLY_MATURED', 'CENSORED', 'INVALID_DATA'];
    expect([...ALL_OUTCOME_MATURITIES].sort()).toEqual([...expected].sort() as never);
  });

  it('declares the §64.3 + FR-EXEC-015 AdapterFamily vocabulary', () => {
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
    ];
    expect([...ALL_ADAPTER_FAMILIES].sort()).toEqual([...expected].sort() as never);
  });

  it('declares the AdapterSupportState vocabulary', () => {
    expect([...ALL_ADAPTER_SUPPORT_STATES].sort()).toEqual(
      ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'].sort() as never,
    );
  });

  it('declares the ExecutionStatus vocabulary', () => {
    expect([...ALL_EXECUTION_STATUSES].sort()).toEqual(
      [
        'EXECUTED_FULL',
        'EXECUTION_PARTIAL',
        'EXECUTION_UNAVAILABLE',
        'POOL_MATH_UNSUPPORTED',
        'INSUFFICIENT_DATA',
      ].sort() as never,
    );
  });

  it('declares the FR-EXEC-017 StressScenarioKind vocabulary', () => {
    const expected = [
      'BASE_CASE',
      'P50_DELAY',
      'P90_DELAY',
      'CONSERVATIVE_LATENCY_ADVERSE_SELECTION',
      'LIQUIDITY_DRAWDOWN',
      'FEE_VOLATILITY',
      'ROUTE_DEGRADATION',
      'FAILED_PARTIAL_FILL',
    ];
    expect([...ALL_STRESS_SCENARIO_KINDS].sort()).toEqual([...expected].sort() as never);
  });

  it('declares the §64.7 ExitPolicyKind vocabulary', () => {
    const expected = [
      'FIXED_HORIZON',
      'TAKE_PROFIT_STOP_LOSS',
      'TRAILING_EXIT',
      'STAGED_EXIT',
      'LIQUIDITY_RISK_DETERIORATION',
      'THESIS_INVALIDATION',
    ];
    expect([...ALL_EXIT_POLICY_KINDS].sort()).toEqual([...expected].sort() as never);
  });

  it('declares the PrimaryOrdering, TradabilityVerdict, and ObservationPlanTriggerClass vocabularies', () => {
    expect([...ALL_PRIMARY_ORDERINGS].sort()).toEqual(
      ['ADVERSE_FEASIBLE', 'UNAMBIGUOUS'].sort() as never,
    );
    expect([...ALL_TRADABILITY_VERDICTS].sort()).toEqual(
      [
        'CONFIRMED_TRADABLE',
        'BLOCKED_INCOMPLETE_STATE',
        'BLOCKED_UNCERTAINTY_BOUND',
        'BLOCKED_STRESS_PASS_MATRIX',
        'BLOCKED_EXECUTION_UNAVAILABLE',
        'BLOCKED_TARGET_NOT_EXECUTABLE',
        'BLOCKED_OBSERVATION_PLAN',
      ].sort() as never,
    );
    expect([...ALL_OBSERVATION_PLAN_TRIGGER_CLASSES].sort()).toEqual(
      [
        'DEEP_RESEARCH',
        'EARLY_WATCH',
        'CONFIRMED_OPPORTUNITY',
        'CONTROL_SAMPLE',
        'SHADOW_PORTFOLIO',
      ].sort() as never,
    );
  });

  it('parses valid values fail-closed and throws typed ExecVocabularyError on unknown values', () => {
    expect(outcomeClass('SIGNAL_SUCCESS')).toBe(OutcomeClass.SIGNAL_SUCCESS);
    expect(outcomeMaturity('FULLY_MATURED')).toBe(OutcomeMaturity.FULLY_MATURED);
    expect(adapterFamily('CONSTANT_PRODUCT_AMM')).toBe(AdapterFamily.CONSTANT_PRODUCT_AMM);
    expect(adapterSupportState('AVAILABLE')).toBe('AVAILABLE');
    expect(executionStatus('EXECUTED_FULL')).toBe('EXECUTED_FULL');
    expect(stressScenarioKind('P90_DELAY')).toBe(StressScenarioKind.P90_DELAY);
    expect(exitPolicyKind('TRAILING_EXIT')).toBe('TRAILING_EXIT');
    expect(primaryOrdering('ADVERSE_FEASIBLE')).toBe(PrimaryOrdering.ADVERSE_FEASIBLE);
    expect(tradabilityVerdict('CONFIRMED_TRADABLE')).toBe(TradabilityVerdict.CONFIRMED_TRADABLE);
    expect(observationPlanTriggerClass('CONTROL_SAMPLE')).toBe('CONTROL_SAMPLE');

    for (const parse of [
      () => outcomeClass('LEGENDARY_WIN'),
      () => outcomeClass(''),
      () => outcomeMaturity('unmatured'),
      () => adapterFamily('GENERIC_AMM'),
      () => stressScenarioKind('HUNDRED_PCT_DELAY'),
      () => tradabilityVerdict('MAYBE'),
    ]) {
      expect(parse).toThrow(ExecVocabularyError);
    }
    try {
      outcomeClass('NOT_A_CLASS');
      throw new Error('unreachable');
    } catch (e) {
      expect(e).toBeInstanceOf(ExecVocabularyError);
      expect((e as ExecVocabularyError).code).toBe(ExecErrorCode.OUTCOME_CLASS_UNKNOWN);
    }
  });
});

describe('§8.2 outcomeLabelPrecedence law (FR-EXEC-001)', () => {
  const fullyMatured = OutcomeMaturity.FULLY_MATURED;

  it('orders INVALID_DATA before everything', () => {
    const r = outcomeLabelPrecedence({
      invalidData: true,
      censored: true,
      maturity: OutcomeMaturity.CENSORED,
      securityOrLiquidityTerminalEvent: true,
      tradableSuccessClausesSatisfied: true,
      tradableFailureClauseSatisfied: true,
      signalSuccess: true,
      signalFailure: false,
    });
    expect(r.tradableClass).toBe(OutcomeClass.INVALID_DATA);
    expect(r.precedenceStep).toBe(PrecedenceStep.INVALID_DATA);
    expect(r.signalClass).toBe(OutcomeClass.INVALID_DATA);
  });

  it('orders CENSORED before maturity and outcome steps', () => {
    const r = outcomeLabelPrecedence({
      invalidData: false,
      censored: true,
      maturity: fullyMatured,
      securityOrLiquidityTerminalEvent: true,
      tradableSuccessClausesSatisfied: true,
      tradableFailureClauseSatisfied: false,
      signalSuccess: true,
      signalFailure: false,
    });
    expect(r.tradableClass).toBe(OutcomeClass.CENSORED);
    expect(r.precedenceStep).toBe(PrecedenceStep.CENSORED);
  });

  it('treats PENDING and PARTIALLY_MATURED as unmatured before outcome steps', () => {
    for (const maturity of [OutcomeMaturity.PENDING, OutcomeMaturity.PARTIALLY_MATURED]) {
      const r = outcomeLabelPrecedence({
        invalidData: false,
        censored: false,
        maturity,
        securityOrLiquidityTerminalEvent: true,
        tradableSuccessClausesSatisfied: true,
        tradableFailureClauseSatisfied: false,
        signalSuccess: true,
        signalFailure: false,
      });
      expect(r.tradableClass).toBe(OutcomeClass.PENDING);
      expect(r.precedenceStep).toBe(PrecedenceStep.UNMATURED);
    }
  });

  it('orders the security/liquidity terminal event before plain success', () => {
    const r = outcomeLabelPrecedence({
      invalidData: false,
      censored: false,
      maturity: fullyMatured,
      securityOrLiquidityTerminalEvent: true,
      tradableSuccessClausesSatisfied: true,
      tradableFailureClauseSatisfied: false,
      signalSuccess: true,
      signalFailure: false,
    });
    expect(r.tradableClass).toBe(OutcomeClass.TRADABLE_FAILURE);
    expect(r.precedenceStep).toBe(PrecedenceStep.TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY);
  });

  it('orders TRADABLE_SUCCESS before TRADABLE_FAILURE and TRADABLE_NEUTRAL', () => {
    const success = outcomeLabelPrecedence({
      invalidData: false,
      censored: false,
      maturity: fullyMatured,
      securityOrLiquidityTerminalEvent: false,
      tradableSuccessClausesSatisfied: true,
      tradableFailureClauseSatisfied: false,
      signalSuccess: false,
      signalFailure: false,
    });
    expect(success.tradableClass).toBe(OutcomeClass.TRADABLE_SUCCESS);
    expect(success.precedenceStep).toBe(PrecedenceStep.TRADABLE_SUCCESS);

    const failure = outcomeLabelPrecedence({
      invalidData: false,
      censored: false,
      maturity: fullyMatured,
      securityOrLiquidityTerminalEvent: false,
      tradableSuccessClausesSatisfied: false,
      tradableFailureClauseSatisfied: true,
      signalSuccess: false,
      signalFailure: true,
    });
    expect(failure.tradableClass).toBe(OutcomeClass.TRADABLE_FAILURE);
    expect(failure.precedenceStep).toBe(PrecedenceStep.TRADABLE_FAILURE);

    const neutral = outcomeLabelPrecedence({
      invalidData: false,
      censored: false,
      maturity: fullyMatured,
      securityOrLiquidityTerminalEvent: false,
      tradableSuccessClausesSatisfied: false,
      tradableFailureClauseSatisfied: false,
      signalSuccess: false,
      signalFailure: false,
    });
    expect(neutral.tradableClass).toBe(OutcomeClass.TRADABLE_NEUTRAL);
    expect(neutral.precedenceStep).toBe(PrecedenceStep.TRADABLE_NEUTRAL);
  });

  it('keeps signal labels on a separate axis that never carries TRADABLE_* classes', () => {
    const r = outcomeLabelPrecedence({
      invalidData: false,
      censored: false,
      maturity: fullyMatured,
      securityOrLiquidityTerminalEvent: false,
      tradableSuccessClausesSatisfied: false,
      tradableFailureClauseSatisfied: true,
      signalSuccess: true,
      signalFailure: false,
    });
    // Large MFE with failed execution: UNTRADABLE_SIGNAL_WIN.
    expect(r.signalClass).toBe(OutcomeClass.SIGNAL_SUCCESS);
    expect(r.tradableClass).toBe(OutcomeClass.TRADABLE_FAILURE);
    expect(r.signalClass.startsWith('TRADABLE_')).toBe(false);
    expect(r.tradableClass.startsWith('SIGNAL_')).toBe(false);
  });

  it('refuses success and failure clauses both asserted with a terminal event', () => {
    expect(() =>
      outcomeLabelPrecedence({
        invalidData: false,
        censored: false,
        maturity: fullyMatured,
        securityOrLiquidityTerminalEvent: true,
        tradableSuccessClausesSatisfied: true,
        tradableFailureClauseSatisfied: true,
        signalSuccess: false,
        signalFailure: false,
      }),
    ).toThrow(ExecVocabularyError);
  });

  it('declares the full §8.2 step list in order', () => {
    expect(ALL_PRECEDENCE_STEPS).toEqual([
      'INVALID_DATA',
      'CENSORED',
      'UNMATURED',
      'TRADABLE_FAILURE_SECURITY_OR_LIQUIDITY',
      'TRADABLE_SUCCESS',
      'TRADABLE_FAILURE',
      'TRADABLE_NEUTRAL',
    ]);
  });
});

describe('FR-EXEC-006 / INV-011 signalCannotRenderProfit', () => {
  it('blocks profit rendering when tradable success is absent or failed', () => {
    expect(
      signalCannotRenderProfit({
        signalClass: OutcomeClass.SIGNAL_SUCCESS,
        tradableClass: OutcomeClass.TRADABLE_SUCCESS,
      }),
    ).toBe(false);
    expect(
      signalCannotRenderProfit({
        signalClass: OutcomeClass.SIGNAL_SUCCESS,
        tradableClass: OutcomeClass.TRADABLE_FAILURE,
      }),
    ).toBe(true);
    expect(
      signalCannotRenderProfit({
        signalClass: OutcomeClass.SIGNAL_SUCCESS,
        tradableClass: OutcomeClass.PENDING,
      }),
    ).toBe(true);
    expect(
      signalCannotRenderProfit({
        signalClass: OutcomeClass.SIGNAL_FAILURE,
        tradableClass: OutcomeClass.TRADABLE_FAILURE,
      }),
    ).toBe(false);
  });

  it('refuses unknown classes fail-closed', () => {
    expect(() =>
      signalCannotRenderProfit({
        signalClass: 'SIGNAL_SUCCESS' as OutcomeClass,
        tradableClass: 'HYPOTHETICAL' as OutcomeClass,
      }),
    ).toThrow(ExecVocabularyError);
  });
});

describe('FR-EXEC-007 tradabilityBlocksConfirmedOpportunity', () => {
  it('confirms only under CONFIRMED_TRADABLE and preserves diagnostic signal labels', () => {
    const confirmed = tradabilityBlocksConfirmedOpportunity({
      candidateConfirmedOpportunity: true,
      tradabilityVerdict: TradabilityVerdict.CONFIRMED_TRADABLE,
      diagnosticSignalClass: OutcomeClass.SIGNAL_SUCCESS,
    });
    expect(confirmed.confirmedOpportunity).toBe(true);
    expect(confirmed.diagnosticSignalClass).toBe(OutcomeClass.SIGNAL_SUCCESS);
    expect(confirmed.blockedByTradability).toBe(false);

    for (const verdict of [
      TradabilityVerdict.BLOCKED_INCOMPLETE_STATE,
      TradabilityVerdict.BLOCKED_UNCERTAINTY_BOUND,
      TradabilityVerdict.BLOCKED_STRESS_PASS_MATRIX,
      TradabilityVerdict.BLOCKED_EXECUTION_UNAVAILABLE,
      TradabilityVerdict.BLOCKED_TARGET_NOT_EXECUTABLE,
      TradabilityVerdict.BLOCKED_OBSERVATION_PLAN,
    ]) {
      const blocked = tradabilityBlocksConfirmedOpportunity({
        candidateConfirmedOpportunity: true,
        tradabilityVerdict: verdict,
        diagnosticSignalClass: OutcomeClass.SIGNAL_SUCCESS,
      });
      expect(blocked.confirmedOpportunity).toBe(false);
      expect(blocked.blockedByTradability).toBe(true);
      // FR-EXEC-007: diagnostic signal label preserved through the block.
      expect(blocked.diagnosticSignalClass).toBe(OutcomeClass.SIGNAL_SUCCESS);
    }
  });
});

describe('§64.13 / FR-EXEC-004 executableTargetSatisfied (AC-122)', () => {
  const executableExit = {
    targetTouched: true,
    modeledExitExecutable: true,
    isolatedWick: false,
  };

  it('satisfies on executable volume or configured target duration', () => {
    expect(
      executableTargetSatisfied({
        ...executableExit,
        executableVolumeSatisfied: true,
        targetDurationSatisfied: false,
      }),
    ).toBe(true);
    expect(
      executableTargetSatisfied({
        ...executableExit,
        executableVolumeSatisfied: false,
        targetDurationSatisfied: true,
      }),
    ).toBe(true);
    expect(
      executableTargetSatisfied({
        ...executableExit,
        executableVolumeSatisfied: true,
        targetDurationSatisfied: true,
      }),
    ).toBe(true);
  });

  it('refuses without either executable volume or target duration', () => {
    expect(
      executableTargetSatisfied({
        ...executableExit,
        executableVolumeSatisfied: false,
        targetDurationSatisfied: false,
      }),
    ).toBe(false);
  });

  it('never counts an isolated wick as sufficient (AC-122)', () => {
    expect(
      executableTargetSatisfied({
        ...executableExit,
        isolatedWick: true,
        executableVolumeSatisfied: false,
        targetDurationSatisfied: false,
      }),
    ).toBe(false);
    // Even with volume flags asserted, an isolated wick stays insufficient.
    expect(
      executableTargetSatisfied({
        ...executableExit,
        isolatedWick: true,
        executableVolumeSatisfied: true,
        targetDurationSatisfied: false,
      }),
    ).toBe(false);
  });

  it('requires the modeled exit to be executable within limits', () => {
    expect(
      executableTargetSatisfied({
        targetTouched: true,
        modeledExitExecutable: false,
        isolatedWick: false,
        executableVolumeSatisfied: true,
        targetDurationSatisfied: true,
      }),
    ).toBe(false);
    expect(
      executableTargetSatisfied({
        targetTouched: false,
        modeledExitExecutable: true,
        isolatedWick: false,
        executableVolumeSatisfied: true,
        targetDurationSatisfied: true,
      }),
    ).toBe(false);
  });
});

describe('FR-EXEC-020 uncertaintyBlocksTradability', () => {
  it('blocks at and beyond the policy limit, passes below it', () => {
    expect(uncertaintyBlocksTradability({ uncertaintyBound: 0.31, policyLimit: 0.3 })).toBe(true);
    expect(uncertaintyBlocksTradability({ uncertaintyBound: 0.3, policyLimit: 0.3 })).toBe(true);
    expect(uncertaintyBlocksTradability({ uncertaintyBound: 0.29, policyLimit: 0.3 })).toBe(false);
    expect(uncertaintyBlocksTradability({ uncertaintyBound: 0, policyLimit: 0 })).toBe(true);
  });

  it('throws fail-closed on invalid bounds or limits', () => {
    expect(() =>
      uncertaintyBlocksTradability({ uncertaintyBound: -0.1, policyLimit: 0.3 }),
    ).toThrow(ExecVocabularyError);
    expect(() => uncertaintyBlocksTradability({ uncertaintyBound: 1.1, policyLimit: 0.3 })).toThrow(
      ExecVocabularyError,
    );
    expect(() =>
      uncertaintyBlocksTradability({ uncertaintyBound: Number.NaN, policyLimit: 0.3 }),
    ).toThrow(ExecVocabularyError);
    expect(() => uncertaintyBlocksTradability({ uncertaintyBound: 0.1, policyLimit: -1 })).toThrow(
      ExecVocabularyError,
    );
  });
});

describe('§64.8 robustDelayGate', () => {
  it('requires the full ladder declared by the profile robustness level', () => {
    expect(
      robustDelayGate({ passedScenarioKinds: ['BASE_CASE'], requiredRobustness: 'REFERENCE_ONLY' }),
    ).toBe(true);
    expect(
      robustDelayGate({
        passedScenarioKinds: ['BASE_CASE', 'P50_DELAY'],
        requiredRobustness: 'P50',
      }),
    ).toBe(true);
    expect(robustDelayGate({ passedScenarioKinds: ['BASE_CASE'], requiredRobustness: 'P50' })).toBe(
      false,
    );
    expect(
      robustDelayGate({
        passedScenarioKinds: ['BASE_CASE', 'P50_DELAY', 'P90_DELAY'],
        requiredRobustness: 'P90',
      }),
    ).toBe(true);
  });

  it('refuses a candidate valid only at an unrealistically short delay under p90', () => {
    expect(
      robustDelayGate({
        passedScenarioKinds: ['BASE_CASE', 'P50_DELAY'],
        requiredRobustness: 'P90',
      }),
    ).toBe(false);
  });

  it('adds the conservative latency/adverse-selection scenario for CONSERVATIVE', () => {
    expect(
      robustDelayGate({
        passedScenarioKinds: ['BASE_CASE', 'P50_DELAY', 'P90_DELAY'],
        requiredRobustness: 'CONSERVATIVE',
      }),
    ).toBe(false);
    expect(
      robustDelayGate({
        passedScenarioKinds: [
          'BASE_CASE',
          'P50_DELAY',
          'P90_DELAY',
          'CONSERVATIVE_LATENCY_ADVERSE_SELECTION',
        ],
        requiredRobustness: 'CONSERVATIVE',
      }),
    ).toBe(true);
  });

  it('throws fail-closed on unknown scenario kinds and unknown robustness levels', () => {
    expect(() =>
      robustDelayGate({ passedScenarioKinds: ['MADE_UP_DELAY'], requiredRobustness: 'P50' }),
    ).toThrow(ExecVocabularyError);
    expect(() =>
      robustDelayGate({ passedScenarioKinds: ['BASE_CASE'], requiredRobustness: 'QUANTILE_99' }),
    ).toThrow(ExecVocabularyError);
    expect(ALL_REQUIRED_DELAY_ROBUSTNESSES.sort()).toEqual(
      ['REFERENCE_ONLY', 'P50', 'P90', 'CONSERVATIVE'].sort(),
    );
  });
});

describe('§64.7 adverseOrderingRequired (AC-238)', () => {
  it('yields adverse-feasible primary with path ambiguity when both are reachable', () => {
    const r = adverseOrderingRequired({ targetReachable: true, invalidationReachable: true });
    expect(r.primaryOrdering).toBe(PrimaryOrdering.ADVERSE_FEASIBLE);
    expect(r.pathAmbiguity).toBe(true);
  });

  it('yields unambiguous with no ambiguity flag when only one ordering is reachable', () => {
    for (const input of [
      { targetReachable: true, invalidationReachable: false },
      { targetReachable: false, invalidationReachable: true },
      { targetReachable: false, invalidationReachable: false },
    ]) {
      const r = adverseOrderingRequired(input);
      expect(r.primaryOrdering).toBe(PrimaryOrdering.UNAMBIGUOUS);
      expect(r.pathAmbiguity).toBe(false);
    }
  });
});
