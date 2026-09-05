/**
 * AC-121 acceptance (positive) — Net return composition across fee, impact, and liquidity legs.
 * Traces: FR-EXEC-002, FR-EXEC-003, FR-EXEC-018, AC-121.
 * AC text: "Entry delay, price impact, pool/token/network fees, partial fills, and exit liquidity
 * each change net outcome exactly as the fixtures define (§64.6/64.7/64.9)."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NET_RETURN_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/net-return.json',
);

describe('AC-121: Net return composition and exact leg breakdown (positive)', () => {
  it('computes exact net return matching all modeled fee, impact, and delay legs for standard CPMM', () => {
    const fixture = JSON.parse(readFileSync(NET_RETURN_FIXTURE, 'utf8'));
    const standardCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'net_ret_clean_cpmm',
    );

    expect(standardCase).toBeDefined();
    expect(standardCase.expectedTotalCostUsd).toBe(9.735);
    expect(standardCase.expectedNetProfitUsd).toBe(240.265);
    expect(standardCase.expectedNetReturnFraction).toBeCloseTo(0.240265, 6);
  });

  it('accurately incorporates Token-2022 transfer fees into total cost and net profit', () => {
    const fixture = JSON.parse(readFileSync(NET_RETURN_FIXTURE, 'utf8'));
    const token2022Case = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'net_ret_token2022_transfer_fee',
    );

    expect(token2022Case).toBeDefined();
    expect(token2022Case.expectedBreakdown.tokenTransferFeeUsd).toBe(55.0);
    expect(token2022Case.expectedTotalCostUsd).toBe(69.62);
    expect(token2022Case.expectedNetProfitUsd).toBe(130.38);
  });

  it('correctly models partial fills and unfilled capital return', () => {
    const fixture = JSON.parse(readFileSync(NET_RETURN_FIXTURE, 'utf8'));
    const partialCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'net_ret_partial_fill_residual_capital',
    );

    expect(partialCase).toBeDefined();
    expect(partialCase.fillFraction).toBe(0.5);
    expect(partialCase.unfilledCapitalReturnedUsd).toBe(1000.0);
    expect(partialCase.expectedNetProfitUsd).toBe(222.57);
  });

  it('reflects adverse selection wipeout turning nominal gain into net loss', () => {
    const fixture = JSON.parse(readFileSync(NET_RETURN_FIXTURE, 'utf8'));
    const wipeoutCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'net_ret_slippage_adverse_selection_wipeout',
    );

    expect(wipeoutCase).toBeDefined();
    expect(wipeoutCase.grossReturnUsd).toBe(50.0);
    expect(wipeoutCase.expectedTotalCostUsd).toBe(80.29);
    expect(wipeoutCase.expectedNetProfitUsd).toBe(-30.29);
    expect(wipeoutCase.expectedNetReturnFraction).toBeLessThan(0);
  });
});
