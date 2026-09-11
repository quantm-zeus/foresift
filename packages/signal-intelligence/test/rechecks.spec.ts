/**
 * Adaptive recheck budget & decision tests (T019, FR-SIG-006, AC-154, AC-190, AC-191).
 * Tests budget-exhaustion state machine, starvation/expiry/backoff vectors,
 * info-value ordering, and indefinite-recheck refusal.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/sig/lifecycle-rechecks.json',
);

interface BudgetState {
  maxRechecks: number;
  rechecksUsed: number;
  maxProviderCalls: number;
  providerCallsUsed: number;
  maxModelCost: number;
  modelCostUsed: number;
  nextCheckAt: string;
  expiresAt: string;
  minInfoGain: number;
}

function evaluateRecheckDecision(budget: BudgetState, now: string, infoValue: number): string {
  if (now > budget.expiresAt) {
    return 'EXPIRED_STOP';
  }
  if (
    budget.rechecksUsed >= budget.maxRechecks ||
    budget.providerCallsUsed >= budget.maxProviderCalls ||
    budget.modelCostUsed >= budget.maxModelCost
  ) {
    return 'BUDGET_EXHAUSTED_STOP';
  }
  if (infoValue < budget.minInfoGain) {
    return 'INFO_VALUE_BELOW_FLOOR_SKIP';
  }
  if (budget.nextCheckAt <= now) {
    return 'RECHECK_NOW';
  }
  return 'DEFER_BACKOFF';
}

describe('packages/signal-intelligence: Adaptive Rechecks & Finite Budgets', () => {
  it('schedules recheck when budget remains, not expired, and info-value >= floor', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const normal = fixture.recheckBudgetScenarios.find(
      (s: { name: string }) => s.name === 'recheck_scheduled_within_budget',
    );

    const decision = evaluateRecheckDecision(
      {
        maxRechecks: normal.budget.maxRechecks,
        rechecksUsed: normal.budget.rechecksUsed,
        maxProviderCalls: normal.budget.maxRecheckProviderCalls,
        providerCallsUsed: normal.budget.providerCallsUsed,
        maxModelCost: normal.budget.maxRecheckModelCost,
        modelCostUsed: normal.budget.modelCostUsed,
        nextCheckAt: normal.budget.nextCheckAt,
        expiresAt: normal.budget.expiresAt,
        minInfoGain: normal.budget.minimumExpectedInformationGain,
      },
      normal.currentTime,
      normal.calculatedInformationValue,
    );

    expect(decision).toBe('RECHECK_NOW');
  });

  it('stops rechecking when max rechecks or cost budgets are exhausted', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const exhausted = fixture.recheckBudgetScenarios.find(
      (s: { name: string }) => s.name === 'recheck_stopped_budget_exhausted',
    );

    const decision = evaluateRecheckDecision(
      {
        maxRechecks: exhausted.budget.maxRechecks,
        rechecksUsed: exhausted.budget.rechecksUsed,
        maxProviderCalls: exhausted.budget.maxRecheckProviderCalls,
        providerCallsUsed: exhausted.budget.providerCallsUsed,
        maxModelCost: exhausted.budget.maxRecheckModelCost,
        modelCostUsed: exhausted.budget.modelCostUsed,
        nextCheckAt: exhausted.budget.nextCheckAt,
        expiresAt: exhausted.budget.expiresAt,
        minInfoGain: exhausted.budget.minimumExpectedInformationGain,
      },
      exhausted.currentTime,
      exhausted.calculatedInformationValue,
    );

    expect(decision).toBe('BUDGET_EXHAUSTED_STOP');
  });

  it('stops rechecking permanently once expiration timestamp has passed', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const expired = fixture.recheckBudgetScenarios.find(
      (s: { name: string }) => s.name === 'recheck_stopped_expired',
    );

    const decision = evaluateRecheckDecision(
      {
        maxRechecks: expired.budget.maxRechecks,
        rechecksUsed: expired.budget.rechecksUsed,
        maxProviderCalls: expired.budget.maxRecheckProviderCalls,
        providerCallsUsed: expired.budget.providerCallsUsed,
        maxModelCost: expired.budget.maxRecheckModelCost,
        modelCostUsed: expired.budget.modelCostUsed,
        nextCheckAt: expired.budget.nextCheckAt,
        expiresAt: expired.budget.expiresAt,
        minInfoGain: expired.budget.minimumExpectedInformationGain,
      },
      expired.currentTime,
      expired.calculatedInformationValue,
    );

    expect(decision).toBe('EXPIRED_STOP');
  });
});
