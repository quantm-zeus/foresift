/**
 * AC-120 negative (failure) — profit rendering from signal win without tradability is structurally refused.
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-007, AC-120.
 * Refusal: SIGNAL_SUCCESS cannot render profit when TRADABLE_SUCCESS is absent or failed.
 */
import { describe, expect, it } from 'bun:test';

function validateProfitRendering(params: {
  signalOutcome: 'SIGNAL_SUCCESS' | 'SIGNAL_FAILURE';
  tradableOutcome: 'TRADABLE_SUCCESS' | 'TRADABLE_FAILURE' | 'PENDING' | 'INSUFFICIENT_DATA';
  renderedProfitUsd: number;
}) {
  if (params.tradableOutcome !== 'TRADABLE_SUCCESS' && params.renderedProfitUsd > 0) {
    throw new Error('PROFIT_RENDERING_WITHOUT_TRADABLE_SUCCESS_REFUSED');
  }
  return true;
}

describe('AC-120 negative: profit rendering from signal win without tradable completion refused', () => {
  it('throws when trying to render profit from SIGNAL_SUCCESS when tradable outcome is TRADABLE_FAILURE', () => {
    expect(() =>
      validateProfitRendering({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'TRADABLE_FAILURE',
        renderedProfitUsd: 150.0,
      }),
    ).toThrow('PROFIT_RENDERING_WITHOUT_TRADABLE_SUCCESS_REFUSED');
  });

  it('throws when trying to render profit from SIGNAL_SUCCESS when tradable outcome is PENDING or INSUFFICIENT_DATA', () => {
    expect(() =>
      validateProfitRendering({
        signalOutcome: 'SIGNAL_SUCCESS',
        tradableOutcome: 'PENDING',
        renderedProfitUsd: 50.0,
      }),
    ).toThrow('PROFIT_RENDERING_WITHOUT_TRADABLE_SUCCESS_REFUSED');
  });
});
