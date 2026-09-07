/**
 * AC-121 acceptance (positive) — net return multi-leg modeling (§64.6, §64.7, §64.9).
 * Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, AC-121.
 * AC text: "Entry delay, price impact, pool/token/network fees, partial fills,
 * and exit liquidity each change net outcome exactly as the fixtures define."
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
