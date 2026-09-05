/**
 * Exec domain vocabularies and pure laws (§64, §8, FR-EXEC-001/004/006/007/013/
 * 015/017/020, AC-120, AC-122) — fail-closed parsing and truth tables.
 */
import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as Record<string, unknown>;
const fn = (name: string): ((...args: unknown[]) => unknown) =>
  (Domain[name] as ((...args: unknown[]) => unknown) | undefined) ?? (() => undefined);

const OutcomeClass = (Domain.OutcomeClass as Record<string, string>) ?? {};
const OutcomeMaturity = (Domain.OutcomeMaturity as Record<string, string>) ?? {};
const AdapterFamily = (Domain.AdapterFamily as Record<string, string>) ?? {};
const AdapterSupportState = (Domain.AdapterSupportState as Record<string, string>) ?? {};
const ExecutionStatus = (Domain.ExecutionStatus as Record<string, string>) ?? {};
const StressScenarioKind = (Domain.StressScenarioKind as Record<string, string>) ?? {};
const ExitPolicyKind = (Domain.ExitPolicyKind as Record<string, string>) ?? {};
const PrimaryOrdering = (Domain.PrimaryOrdering as Record<string, string>) ?? {};
const TradabilityVerdict = (Domain.TradabilityVerdict as Record<string, string>) ?? {};
const ObservationPlanTriggerClass =
  (Domain.ObservationPlanTriggerClass as Record<string, string>) ?? {};
const ExecErrorCode = (Domain.ExecErrorCode as Record<string, string>) ?? {};

const outcomeClass = fn('outcomeClass');
const outcomeMaturity = fn('outcomeMaturity');
const adapterFamily = fn('adapterFamily');
const adapterSupportState = fn('adapterSupportState');
const executionStatus = fn('executionStatus');
const stressScenarioKind = fn('stressScenarioKind');
const exitPolicyKind = fn('exitPolicyKind');
const primaryOrdering = fn('primaryOrdering');
const tradabilityVerdict = fn('tradabilityVerdict');
const observationPlanTriggerClass = fn('observationPlanTriggerClass');
const outcomeLabelPrecedence = fn('outcomeLabelPrecedence');
const signalCannotRenderProfit = fn('signalCannotRenderProfit');
const tradabilityBlocksConfirmedOpportunity = fn('tradabilityBlocksConfirmedOpportunity');
const executableTargetSatisfied = fn('executableTargetSatisfied');
const uncertaintyBlocksTradability = fn('uncertaintyBlocksTradability');
const robustDelayGate = fn('robustDelayGate');
const adverseOrderingRequired = fn('adverseOrderingRequired');

const OC = OutcomeClass as Record<string, string>;
const OM = OutcomeMaturity as Record<string, string>;

function expectTypedError(fnCall: () => unknown, code: string): void {
  try {
    fnCall();
    throw new Error(`expected typed error ${code}`);
  } catch (error) {
    expect((error as Error).name).toBe('ExecVocabularyError');
    expect((error as { code?: string }).code).toBe(code);
  }
}

const maturedClauses = {
  invalidData: false,
  censored: false,
  maturity: 'FULLY_MATURED',
  tradableSecurityOrLiquidityFailure: false,
  tradableSuccess: false,
  tradableFailure: false,
  signalSuccess: false,
  signalFailure: false,
};

describe('Exec domain vocabularies (§64, §8, §12.8)', () => {
  it('declares the §64.12 OutcomeClass vocabulary with all nine classes', () => {
    expect(Object.values(OutcomeClass).sort()).toEqual(
      [
        'SIGNAL_SUCCESS',
        'SIGNAL_FAILURE',
        'TRADABLE_SUCCESS',
        'TRADABLE_FAILURE',
        'TRADABLE_NEUTRAL',
        'NEUTRAL',
        'PENDING',
        'CENSORED',
        'INVALID_DATA',
      ].sort(),
    );
  });

  it('declares the §8.1/§12.8 OutcomeMaturity vocabulary', () => {
    expect(Object.values(OutcomeMaturity)).toEqual([
      'PENDING',
      'PARTIALLY_MATURED',
      'FULLY_MATURED',
      'CENSORED',
      'INVALID_DATA',
    ]);
  });

  it('declares the §64.3+FR-EXEC-015 AdapterFamily vocabulary including VIRTUAL_RESERVE and UNKNOWN', () => {
    expect(Object.values(AdapterFamily)).toEqual([
      'CONSTANT_PRODUCT_AMM',
      'CONCENTRATED_LIQUIDITY_AMM',
      'DISCRETE_LIQUIDITY_BIN_AMM',
      'BONDING_CURVE',
      'STABLE_CURVE',
      'DYNAMIC_FEE_AMM',
      'VIRTUAL_RESERVE',
      'AGGREGATED_MULTI_ROUTE_READ_ONLY',
      'UNKNOWN',
    ]);
  });

  it('declares execution-support vocabularies (§64.3 support states, §64.4 statuses, FR-EXEC-017 stress kinds, §64.7 exit kinds)', () => {
    expect(Object.values(AdapterSupportState)).toEqual(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE']);
    expect(Object.values(ExecutionStatus)).toEqual([
      'EXECUTED_FULL',
      'EXECUTION_PARTIAL',
      'EXECUTION_UNAVAILABLE',
      'POOL_MATH_UNSUPPORTED',
      'INSUFFICIENT_DATA',
    ]);
    expect(Object.values(StressScenarioKind)).toEqual([
      'BASE_CASE',
      'P50_DELAY',
      'P90_DELAY',
      'CONSERVATIVE_LATENCY_ADVERSE_SELECTION',
      'LIQUIDITY_DRAWDOWN',
      'FEE_VOLATILITY',
      'ROUTE_DEGRADATION',
      'FAILED_PARTIAL_FILL',
    ]);
    expect(Object.values(ExitPolicyKind)).toEqual([
      'FIXED_HORIZON',
      'TAKE_PROFIT_STOP_LOSS',
      'TRAILING_EXIT',
      'STAGED_EXIT',
      'LIQUIDITY_RISK_DETERIORATION',
      'THESIS_INVALIDATION',
    ]);
    expect(Object.values(PrimaryOrdering)).toEqual(['ADVERSE_FEASIBLE', 'UNAMBIGUOUS']);
    expect(Object.values(ObservationPlanTriggerClass)).toEqual([
      'DEEP_RESEARCH',
      'EARLY_WATCH',
      'CONFIRMED_OPPORTUNITY',
      'CONTROL_SAMPLE',
      'SHADOW_PORTFOLIO',
    ]);
  });

  it('parses known values and rejects unknown/future values with typed errors', () => {
    expect(outcomeClass('SIGNAL_SUCCESS')).toBe('SIGNAL_SUCCESS');
    expect(outcomeMaturity('PARTIALLY_MATURED')).toBe('PARTIALLY_MATURED');
    expect(adapterFamily('CONSTANT_PRODUCT_AMM')).toBe('CONSTANT_PRODUCT_AMM');
    expect(adapterSupportState('DEGRADED')).toBe('DEGRADED');
    expect(executionStatus('EXECUTION_UNAVAILABLE')).toBe('EXECUTION_UNAVAILABLE');
    expect(stressScenarioKind('P90_DELAY')).toBe('P90_DELAY');
    expect(exitPolicyKind('TRAILING_EXIT')).toBe('TRAILING_EXIT');
    expect(primaryOrdering('ADVERSE_FEASIBLE')).toBe('ADVERSE_FEASIBLE');
    expect(tradabilityVerdict('TRADABLE')).toBe('TRADABLE');
    expect(observationPlanTriggerClass('CONTROL_SAMPLE')).toBe('CONTROL_SAMPLE');

    expectTypedError(() => outcomeClass('TRADABLE_WIN'), ExecErrorCode.OUTCOME_CLASS_UNKNOWN);
    expectTypedError(() => outcomeClass(null), ExecErrorCode.OUTCOME_CLASS_UNKNOWN);
    expectTypedError(() => outcomeMaturity('MATURE'), ExecErrorCode.OUTCOME_MATURITY_UNKNOWN);
    expectTypedError(
      () => adapterFamily('GENERIC_AMM'),
      ExecErrorCode.ADAPTER_FAMILY_UNKNOWN,
    );
    expectTypedError(
      () => adapterSupportState('BEST_EFFORT'),
      ExecErrorCode.ADAPTER_SUPPORT_STATE_UNKNOWN,
    );
    expectTypedError(
      () => executionStatus('EXECUTED'),
      ExecErrorCode.EXECUTION_STATUS_UNKNOWN,
    );
    expectTypedError(
      () => stressScenarioKind('OPTIMISTIC'),
      ExecErrorCode.STRESS_SCENARIO_KIND_UNKNOWN,
    );
    expectTypedError(() => exitPolicyKind('BEST_OF'), ExecErrorCode.EXIT_POLICY_KIND_UNKNOWN);
    expectTypedError(
      () => primaryOrdering('OPTIMISTIC'),
      ExecErrorCode.PRIMARY_ORDERING_UNKNOWN,
    );
    expectTypedError(
      () => tradabilityVerdict('MAYBE'),
      ExecErrorCode.TRADABILITY_VERDICT_UNKNOWN,
    );
    expectTypedError(
      () => observationPlanTriggerClass('EVERYTHING'),
      ExecErrorCode.OBSERVATION_PLAN_TRIGGER_CLASS_UNKNOWN,
    );
  });
});

describe('outcomeLabelPrecedence law (§8.2)', () => {
  it('ranks INVALID_DATA first regardless of other clauses', () => {
    const result = outcomeLabelPrecedence({
      ...maturedClauses,
      invalidData: true,
      tradableSuccess: true,
      signalSuccess: true,
    });
    expect(result.tradableLabel).toBe(OC.INVALID_DATA);
    expect(result.signalLabel).toBe(OC.SIGNAL_SUCCESS);
  });

  it('ranks CENSORED above all terminal tradable labels', () => {
    // §8.2 step 2: CENSORED applies when no terminal event is established, so
    // the clause set carries no terminal tradable clause.
    const result = outcomeLabelPrecedence({
      ...maturedClauses,
      censored: true,
      signalFailure: true,
    });
    expect(result.tradableLabel).toBe(OC.CENSORED);
  });

  it('maps PENDING and PARTIALLY_MATURED maturity to the PENDING label', () => {
    for (const maturity of [OM.PENDING, OM.PARTIALLY_MATURED]) {
      const result = outcomeLabelPrecedence({
        ...maturedClauses,
        maturity,
        tradableSuccess: true,
      });
      expect(result.tradableLabel).toBe(OC.PENDING);
    }
  });

  it('ranks security/liquidity tradable failure above success and explicit failure', () => {
    const result = outcomeLabelPrecedence({
      ...maturedClauses,
      tradableSecurityOrLiquidityFailure: true,
      signalSuccess: true,
    });
    expect(result.tradableLabel).toBe(OC.TRADABLE_FAILURE);
    expect(result.tradableFailureReason).toBe('SECURITY_OR_LIQUIDITY');
    // Signal label preserved on its own axis — not collapsed into tradable.
    expect(result.signalLabel).toBe(OC.SIGNAL_SUCCESS);
  });

  it('ranks TRADABLE_SUCCESS above explicit failure', () => {
    const result = outcomeLabelPrecedence({
      ...maturedClauses,
      tradableSuccess: true,
      tradableFailure: true,
    });
    expect(result.tradableLabel).toBe(OC.TRADABLE_SUCCESS);
  });

  it('falls through to TRADABLE_NEUTRAL for a fully matured, uneventful outcome', () => {
    const result = outcomeLabelPrecedence({ ...maturedClauses });
    expect(result.tradableLabel).toBe(OC.TRADABLE_NEUTRAL);
  });

  it('keeps the signal label on a separate axis (AC-120 substrate)', () => {
    const result = outcomeLabelPrecedence({
      ...maturedClauses,
      tradableFailure: true,
      signalSuccess: true,
    });
    expect(result.tradableLabel).toBe(OC.TRADABLE_FAILURE);
    expect(result.signalLabel).toBe(OC.SIGNAL_SUCCESS);
  });

  it('fails closed on malformed clause sets', () => {
    expectTypedError(() => outcomeLabelPrecedence(null), ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID);
    expectTypedError(
      () => outcomeLabelPrecedence({ ...maturedClauses, maturity: 'DONE' }),
      ExecErrorCode.OUTCOME_MATURITY_UNKNOWN,
    );
    expectTypedError(
      () => outcomeLabelPrecedence({ ...maturedClauses, tradableSuccess: 'yes' }),
      ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
    );
    expectTypedError(
      () => outcomeLabelPrecedence({ ...maturedClauses, signalSuccess: true, signalFailure: true }),
      ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
    );
    expectTypedError(
      () => outcomeLabelPrecedence({ ...maturedClauses, censored: true, tradableSuccess: true }),
      ExecErrorCode.EXEC_LABEL_CLAUSES_INVALID,
    );
  });
});

describe('signalCannotRenderProfit law (FR-EXEC-006 / INV-011)', () => {
  it('flags profit rendering without TRADABLE_SUCCESS (AC-120)', () => {
    expect(
      signalCannotRenderProfit({
        signalLabel: OC.SIGNAL_SUCCESS,
        tradableLabel: null,
        renderProfit: true,
      }),
    ).toBe(true);
    expect(
      signalCannotRenderProfit({
        signalLabel: OC.SIGNAL_SUCCESS,
        tradableLabel: OC.TRADABLE_FAILURE,
        renderProfit: true,
      }),
    ).toBe(true);
    expect(
      signalCannotRenderProfit({
        signalLabel: OC.SIGNAL_SUCCESS,
        tradableLabel: OC.PENDING,
        renderProfit: true,
      }),
    ).toBe(true);
  });

  it('permits profit rendering only with TRADABLE_SUCCESS', () => {
    expect(
      signalCannotRenderProfit({
        signalLabel: OC.SIGNAL_SUCCESS,
        tradableLabel: OC.TRADABLE_SUCCESS,
        renderProfit: true,
      }),
    ).toBe(false);
  });

  it('never flags renders that do not claim profit', () => {
    expect(
      signalCannotRenderProfit({
        signalLabel: OC.SIGNAL_SUCCESS,
        tradableLabel: null,
        renderProfit: false,
      }),
    ).toBe(false);
  });

  it('rejects non-signal axis labels and malformed input', () => {
    expectTypedError(
      () => signalCannotRenderProfit({ signalLabel: OC.TRADABLE_SUCCESS, tradableLabel: null, renderProfit: true }),
      ExecErrorCode.EXEC_PROFIT_RENDERING_INPUT_INVALID,
    );
    expectTypedError(
      () => signalCannotRenderProfit({ signalLabel: OC.SIGNAL_SUCCESS, renderProfit: 'yes' }),
      ExecErrorCode.EXEC_PROFIT_RENDERING_INPUT_INVALID,
    );
  });
});

describe('tradabilityBlocksConfirmedOpportunity law (FR-EXEC-007)', () => {
  it('confirms only on TRADABLE and preserves the diagnostic signal label', () => {
    const ok = tradabilityBlocksConfirmedOpportunity({
      signalLabel: OC.SIGNAL_SUCCESS,
      verdict: 'TRADABLE',
    });
    expect(ok.confirmedOpportunity).toBe(true);
    expect(ok.blockReason).toBe(null);
    expect(ok.preservedSignalLabel).toBe(OC.SIGNAL_SUCCESS);
  });

  it('blocks on every other verdict while keeping the signal label unchanged', () => {
    for (const verdict of [
      'UNCERTAINTY_BLOCKED',
      'TARGET_NOT_EXECUTABLE',
      'STATE_INCOMPLETE',
      'EXECUTION_UNAVAILABLE',
      'POOL_MATH_UNSUPPORTED',
      'INSUFFICIENT_DATA',
    ]) {
      const blocked = tradabilityBlocksConfirmedOpportunity({
        signalLabel: OC.SIGNAL_SUCCESS,
        verdict,
      });
      expect(blocked.confirmedOpportunity).toBe(false);
      expect(blocked.blockReason).toBe(verdict);
      // FR-EXEC-007: diagnostic labels preserved — a blocked confirmation
      // must not rewrite SIGNAL_SUCCESS.
      expect(blocked.preservedSignalLabel).toBe(OC.SIGNAL_SUCCESS);
    }
  });
});

describe('executableTargetSatisfied law (§64.13 / FR-EXEC-004 / AC-122)', () => {
  it('requires executable volume or configured target-duration support', () => {
    expect(
      executableTargetSatisfied({
        touched: true,
        executableVolumeObserved: true,
        targetDurationSupported: false,
        isolatedWick: false,
      }),
    ).toBe(true);
    expect(
      executableTargetSatisfied({
        touched: true,
        executableVolumeObserved: false,
        targetDurationSupported: true,
        isolatedWick: false,
      }),
    ).toBe(true);
  });

  it('never accepts an isolated wick as sufficient (AC-122)', () => {
    expect(
      executableTargetSatisfied({
        touched: true,
        executableVolumeObserved: false,
        targetDurationSupported: false,
        isolatedWick: true,
      }),
    ).toBe(false);
    // Even alongside other evidence, an isolated wick cannot carry the target.
    expect(
      executableTargetSatisfied({
        touched: true,
        executableVolumeObserved: true,
        targetDurationSupported: true,
        isolatedWick: true,
      }),
    ).toBe(false);
  });

  it('rejects untouched targets and fails closed on malformed clauses', () => {
    expect(
      executableTargetSatisfied({
        touched: false,
        executableVolumeObserved: true,
        targetDurationSupported: true,
        isolatedWick: false,
      }),
    ).toBe(false);
    expectTypedError(
      () => executableTargetSatisfied({ touched: true, executableVolumeObserved: 'yes' }),
      ExecErrorCode.EXEC_TARGET_INPUT_INVALID,
    );
  });
});

describe('uncertaintyBlocksTradability law (FR-EXEC-020)', () => {
  it('blocks when state is incomplete, parity unverified, or the bound is absent', () => {
    expect(
      uncertaintyBlocksTradability({
        stateComplete: false,
        parityVerified: true,
        uncertaintyBound: 0.01,
        policyLimit: 0.05,
      }),
    ).toBe(true);
    expect(
      uncertaintyBlocksTradability({
        stateComplete: true,
        parityVerified: false,
        uncertaintyBound: 0.01,
        policyLimit: 0.05,
      }),
    ).toBe(true);
    expect(
      uncertaintyBlocksTradability({
        stateComplete: true,
        parityVerified: true,
        uncertaintyBound: null,
        policyLimit: 0.05,
      }),
    ).toBe(true);
  });

  it('blocks when the bound crosses the policy limit and passes within it', () => {
    expect(
      uncertaintyBlocksTradability({
        stateComplete: true,
        parityVerified: true,
        uncertaintyBound: 0.06,
        policyLimit: 0.05,
      }),
    ).toBe(true);
    expect(
      uncertaintyBlocksTradability({
        stateComplete: true,
        parityVerified: true,
        uncertaintyBound: 0.05,
        policyLimit: 0.05,
      }),
    ).toBe(false);
  });

  it('fails closed on out-of-domain bounds and non-boolean clauses', () => {
    expectTypedError(
      () => uncertaintyBlocksTradability({ stateComplete: true, parityVerified: true, uncertaintyBound: 1.5, policyLimit: 2 }),
      ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID,
    );
    expectTypedError(
      () => uncertaintyBlocksTradability({ stateComplete: 'yes', parityVerified: true, uncertaintyBound: 0.1, policyLimit: 0.2 }),
      ExecErrorCode.EXEC_UNCERTAINTY_INPUT_INVALID,
    );
  });
});

describe('robustDelayGate law (§64.8 / FR-EXEC-017)', () => {
  const KINDS = StressScenarioKind as Record<string, string>;

  it('passes only when every required scenario explicitly passed', () => {
    const result = robustDelayGate({
      profileRequires: [KINDS.P50_DELAY, KINDS.P90_DELAY],
      results: { P50_DELAY: true, P90_DELAY: true },
    });
    expect(result.robust).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('treats missing evaluations as failures (fail-closed)', () => {
    const result = robustDelayGate({
      profileRequires: [KINDS.P50_DELAY, KINDS.P90_DELAY],
      results: { P50_DELAY: true },
    });
    expect(result.robust).toBe(false);
    expect(result.failures).toEqual([KINDS.P90_DELAY]);
  });

  it('reports failed required scenarios', () => {
    const result = robustDelayGate({
      profileRequires: [KINDS.P90_DELAY],
      results: { P90_DELAY: false },
    });
    expect(result.robust).toBe(false);
    expect(result.failures).toEqual([KINDS.P90_DELAY]);
  });

  it('refuses an empty requirement set as a configuration error', () => {
    expectTypedError(
      () => robustDelayGate({ profileRequires: [], results: {} }),
      ExecErrorCode.EXEC_DELAY_GATE_INPUT_INVALID,
    );
  });
});

describe('adverseOrderingRequired law (§64.7 / FR-MAT-009)', () => {
  it('selects the adverse feasible ordering with path ambiguity when both triggers are reachable', () => {
    const result = adverseOrderingRequired({
      favorableReachable: true,
      adverseReachable: true,
      orderingKnown: false,
    });
    expect(result.primaryOrdering).toBe('ADVERSE_FEASIBLE');
    expect(result.pathAmbiguous).toBe(true);
  });

  it('stays unambiguous when the ordering is known or only one trigger is feasible', () => {
    expect(
      adverseOrderingRequired({ favorableReachable: true, adverseReachable: true, orderingKnown: true }),
    ).toEqual({ primaryOrdering: 'UNAMBIGUOUS', pathAmbiguous: false });
    expect(
      adverseOrderingRequired({ favorableReachable: true, adverseReachable: false, orderingKnown: false }),
    ).toEqual({ primaryOrdering: 'UNAMBIGUOUS', pathAmbiguous: false });
    expect(
      adverseOrderingRequired({ favorableReachable: false, adverseReachable: true, orderingKnown: false }),
    ).toEqual({ primaryOrdering: 'UNAMBIGUOUS', pathAmbiguous: false });
  });
});
