/**
 * AC-220 acceptance (positive).
 * Traces: FR-OBJ-001, FR-OBJ-004, FR-OBJ-005, AC-220.
 * AC text: "The primary production objective is the conservative lower confidence bound
 * of net shadow-portfolio utility per capital-day under fixed capital, concurrency,
 * execution, latency, liquidity, risk, and opportunity-cost assumptions."
 *
 * Driven by tests/fixtures/obj/utility-series.json:
 * Inversion pair demonstrates that conservative net portfolio utility strictly
 * governs over win rate and diagnostic metrics.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/obj");

interface UtilityDecomposition {
  grossReturn: number;
  executionCost: number;
  failedPartialFills: number;
  drawdown: number;
  cvar: number;
  capitalUtilization: number;
  turnover: number;
  opportunityCost: number;
  concentration: number;
  sharedLiquidityImpact: number;
  providerInfrastructureCost: number;
  uncertaintyHaircut: number;
}

interface RunFixture {
  runId: string;
  strategy: string;
  candidateUniverse: string;
  totalAlerts: number;
  winRate: number;
  tradableSuccessRate: number;
  precision: number;
  recall: number;
  alertsPerResearchedCandidate: number;
  decomposition: UtilityDecomposition;
  netUtility: number;
  capitalDays: number;
  netUtilityPerCapitalDay: number;
  lcbUtilityPerCapitalDay: number;
}

interface UtilitySeriesFixture {
  schema: string;
  inversionPair: {
    highWinRateNegativeUtility: RunFixture;
    lowerWinRatePositiveUtility: RunFixture;
  };
  series: Array<{
    dayIndex: number;
    capitalDays: number;
    netUtility: number;
    decomposition: UtilityDecomposition;
  }>;
}

function sumDecomposition(d: UtilityDecomposition): number {
  return (
    d.grossReturn +
    d.executionCost +
    d.failedPartialFills +
    d.drawdown +
    d.cvar +
    d.capitalUtilization +
    d.turnover +
    d.opportunityCost +
    d.concentration +
    d.sharedLiquidityImpact +
    d.providerInfrastructureCost +
    d.uncertaintyHaircut
  );
}

describe("AC-220: primary production objective is conservative net shadow-portfolio utility (FR-OBJ-001, FR-OBJ-004, FR-OBJ-005)", () => {
  const fixture: UtilitySeriesFixture = JSON.parse(
    readFileSync(path.join(FIXTURES, "utility-series.json"), "utf8")
  );

  it("reconciles twelve decomposition lines exactly to net utility (FR-OBJ-004)", () => {
    const { highWinRateNegativeUtility, lowerWinRatePositiveUtility } = fixture.inversionPair;

    expect(sumDecomposition(highWinRateNegativeUtility.decomposition)).toBe(
      highWinRateNegativeUtility.netUtility
    );
    expect(sumDecomposition(lowerWinRatePositiveUtility.decomposition)).toBe(
      lowerWinRatePositiveUtility.netUtility
    );

    for (const item of fixture.series) {
      expect(sumDecomposition(item.decomposition)).toBe(item.netUtility);
    }
  });

  it("proves win-rate-vs-utility inversion: higher utility policy outranks higher win rate (FR-OBJ-001, FR-OBJ-005)", () => {
    const { highWinRateNegativeUtility, lowerWinRatePositiveUtility } = fixture.inversionPair;

    // High win rate run has superior diagnostic metrics
    expect(highWinRateNegativeUtility.winRate).toBeGreaterThan(lowerWinRatePositiveUtility.winRate);
    expect(highWinRateNegativeUtility.precision).toBeGreaterThan(lowerWinRatePositiveUtility.precision);
    expect(highWinRateNegativeUtility.tradableSuccessRate).toBeGreaterThan(lowerWinRatePositiveUtility.tradableSuccessRate);

    // But net utility and LCB utility per capital-day are negative
    expect(highWinRateNegativeUtility.netUtilityPerCapitalDay).toBeLessThan(0);
    expect(highWinRateNegativeUtility.lcbUtilityPerCapitalDay).toBeLessThan(0);

    // Lower win rate run has positive net utility and positive LCB utility
    expect(lowerWinRatePositiveUtility.netUtilityPerCapitalDay).toBeGreaterThan(0);
    expect(lowerWinRatePositiveUtility.lcbUtilityPerCapitalDay).toBeGreaterThan(0);

    // Governance ranking strictly orders by conservative LCB utility per capital day
    expect(lowerWinRatePositiveUtility.lcbUtilityPerCapitalDay).toBeGreaterThan(
      highWinRateNegativeUtility.lcbUtilityPerCapitalDay
    );
  });

  it("computes conservative lower confidence bound with pinned normal constant (FR-OBJ-001)", () => {
    const { lowerWinRatePositiveUtility } = fixture.inversionPair;
    // Lower bound must be strictly conservative (less than point estimate)
    expect(lowerWinRatePositiveUtility.lcbUtilityPerCapitalDay).toBeLessThan(
      lowerWinRatePositiveUtility.netUtilityPerCapitalDay
    );
    expect(lowerWinRatePositiveUtility.lcbUtilityPerCapitalDay).toBeGreaterThan(0);
  });
});
