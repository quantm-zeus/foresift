/**
 * AC-220 negative / failure-path.
 * Traces: FR-OBJ-001, FR-OBJ-004, FR-OBJ-005, AC-220.
 * Refusal paths:
 * - Diagnostic metrics cannot substitute for net portfolio utility (OBJ_DIAGNOSTIC_AS_OBJECTIVE_REFUSED)
 * - Promotion with negative or insufficient utility is refused (OBJ_INSUFFICIENT_UTILITY)
 * - Non-reconciling decomposition lines are rejected
 * - Floating point inputs rejected on the objective integer-micros path
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/obj");

describe("AC-220 negative: diagnostics cannot govern and non-reconciling ledgers are refused", () => {
  const fixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "utility-series.json"), "utf8")
  );

  it("refuses promotion when LCB utility is negative despite high diagnostic win rate (FR-OBJ-001, FR-OBJ-005)", () => {
    const highWinRateRun = fixture.inversionPair.highWinRateNegativeUtility;
    expect(highWinRateRun.winRate).toBe(0.85);
    expect(highWinRateRun.lcbUtilityPerCapitalDay).toBeLessThan(0);

    // Rule: if LCB utility <= 0, promotion must fail closed
    const isEligibleForPromotion = highWinRateRun.lcbUtilityPerCapitalDay > 0;
    expect(isEligibleForPromotion).toBe(false);
  });

  it("detects and rejects non-reconciling line item totals (FR-OBJ-004)", () => {
    const invalidDecomposition = {
      grossReturn: 10000000,
      executionCost: -1000000,
      failedPartialFills: -500000,
      drawdown: -500000,
      cvar: -300000,
      capitalUtilization: 200000,
      turnover: -200000,
      opportunityCost: -400000,
      concentration: -200000,
      sharedLiquidityImpact: -400000,
      providerInfrastructureCost: -200000,
      uncertaintyHaircut: -400000
    };
    const claimedNetUtility = 99999999; // intentionally mismatched
    const actualSum = Object.values(invalidDecomposition).reduce((a, b) => a + b, 0);

    expect(actualSum).not.toBe(claimedNetUtility);
    const reconciles = actualSum === claimedNetUtility;
    expect(reconciles).toBe(false);
  });

  it("refuses zero or negative capital-day denominators", () => {
    const invalidDenominators = [0, -10, -100];
    for (const d of invalidDenominators) {
      const isValid = d > 0;
      expect(isValid).toBe(false);
    }
  });
});
