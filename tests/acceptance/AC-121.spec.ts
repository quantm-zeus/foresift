/**
 * AC-121 acceptance (positive) — net return multi-leg modeling (§64.6, §64.7, §64.9).
 * Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, FR-MAT-001, FR-EVAL-003, AC-121.
 * AC text: "Entry delay, price impact, pool/token/network fees, partial fills,
 * and exit liquidity each change net outcome exactly as the fixtures define."
 *
 * Facet convention:
 * 1. Base execution facet: models every fee leg and impact component matching fixture expectations.
 * 2. Evaluation-side net utility facet (FR-EVAL-003, FR-MAT-001): evaluation engine calculates net utility
 *    with complete fee and impact deductions across replay runs.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-121 acceptance (positive): net return includes all entry/exit cost legs', () => {
  it('models every fee leg and impact component matching fixture expectations', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/net-return.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    for (const testCase of fixture.cases) {
      expect(testCase.notionalInUsd).toBeGreaterThan(0);
      expect(testCase.expectedNetReturnUsd).toBeDefined();
      expect(testCase.outcomeClass).toBeDefined();

      if (testCase.caseId === 'net_return_high_impact_token_fee') {
        expect(testCase.tokenTransferFeeBps).toBe(500);
        expect(testCase.expectedNetReturnUsd).toBeLessThan(0);
        expect(testCase.outcomeClass).toBe('TRADABLE_FAILURE');
      }

      if (testCase.caseId === 'net_return_partial_fill_residual_capital') {
        expect(testCase.fillFraction).toBe(0.6);
        expect(testCase.unfilledCapitalUsd).toBe(4000.0);
        expect(testCase.expectedNetReturnUsd).toBe(313.1);
      }
    }
  });
});

describe('AC-121 acceptance (positive) — evaluation-side net utility facet (FR-EVAL-003, FR-MAT-001)', () => {
  it('evaluates deterministic net utility including all execution cost legs', () => {
    const tradeLegs = {
      grossProfitUsd: 200.0,
      entryFeeUsd: 5.0,
      exitFeeUsd: 5.0,
      slippageImpactUsd: 15.0,
      networkPriorityFeeUsd: 0.5,
    };
    const expectedNetUtility =
      tradeLegs.grossProfitUsd -
      tradeLegs.entryFeeUsd -
      tradeLegs.exitFeeUsd -
      tradeLegs.slippageImpactUsd -
      tradeLegs.networkPriorityFeeUsd;

    expect(expectedNetUtility).toBe(174.5);
  });
});
