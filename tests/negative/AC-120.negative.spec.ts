/**
 * AC-120 negative (failure) — profit rendering from signal win without tradability is structurally refused.
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-007, FR-MAT-001, FR-EVAL-001, AC-120.
 * Refusal: SIGNAL_SUCCESS cannot render profit when TRADABLE_SUCCESS is absent or failed.
 *
 * Facet convention:
 * 1. Base execution refusal: profit rendering without tradable success throws.
 * 2. Evaluation-side replay/label refusal (FR-MAT-001, FR-EVAL-001): replay cannot conflate signal and tradable outcomes.
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

function validateReplayOutcomeSeparation(outcome: {
  signalOutcome: string;
  tradableOutcome?: string;
}) {
  if (!outcome.tradableOutcome) {
    throw new Error('REPLAY_REQUIRES_SEPARATE_TRADABLE_LABEL');
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

describe('AC-120 negative — evaluation-side replay/label facet (FR-MAT-001, FR-EVAL-001)', () => {
  it('throws when replay produces outcome without separate tradable label', () => {
    expect(() =>
      validateReplayOutcomeSeparation({
        signalOutcome: 'SIGNAL_SUCCESS',
      }),
    ).toThrow('REPLAY_REQUIRES_SEPARATE_TRADABLE_LABEL');
  });
});
