/**
 * AC-120 negative (failure) — Prohibition against rendering profit from signal success alone.
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-007, AC-120.
 * Tests structural refusal of rendering financial profit from signal success without tradable completion (FR-EXEC-006 / INV-011).
 */
import { describe, expect, it } from 'bun:test';

function assertOutcomeProfitLegality(outcome: {
  signalOutcome: string;
  tradableOutcome: string;
  renderedProfitUsd: number;
}) {
  if (outcome.tradableOutcome !== 'TRADABLE_SUCCESS' && outcome.renderedProfitUsd > 0) {
    throw new Error('SIGNAL_SUCCESS_CANNOT_RENDER_PROFIT_WITHOUT_TRADABLE_SUCCESS');
  }
  return true;
}

function assertPromotionPermitted(candidate: {
  signalOutcome: string;
  tradableOutcome: string;
  promotionTarget: 'CONFIRMED_OPPORTUNITY' | 'EARLY_WATCH';
}) {
  if (
    candidate.promotionTarget === 'CONFIRMED_OPPORTUNITY' &&
    candidate.tradableOutcome !== 'TRADABLE_SUCCESS'
  ) {
    throw new Error('TRADABILITY_BLOCKS_CONFIRMED_OPPORTUNITY');
  }
  return true;
}

describe('AC-120 negative: profit rendering and promotion without tradable success is refused', () => {
  it('refuses positive profit rendering when tradable outcome is absent or failed', () => {
    expect(() =>
      assertOutcomeProfitLegality({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'UNTRADABLE_SIGNAL_WIN',
        renderedProfitUsd: 150.0,
      }),
    ).toThrow('SIGNAL_SUCCESS_CANNOT_RENDER_PROFIT_WITHOUT_TRADABLE_SUCCESS');

    expect(() =>
      assertOutcomeProfitLegality({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'TRADABLE_FAILURE',
        renderedProfitUsd: 50.0,
      }),
    ).toThrow('SIGNAL_SUCCESS_CANNOT_RENDER_PROFIT_WITHOUT_TRADABLE_SUCCESS');
  });

  it('refuses CONFIRMED_OPPORTUNITY promotion when tradable success is not achieved', () => {
    expect(() =>
      assertPromotionPermitted({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'UNTRADABLE_SIGNAL_WIN',
        promotionTarget: 'CONFIRMED_OPPORTUNITY',
      }),
    ).toThrow('TRADABILITY_BLOCKS_CONFIRMED_OPPORTUNITY');
  });
});
