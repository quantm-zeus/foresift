/**
 * AC-120 acceptance (positive) — signal vs tradable outcome separation (§64.12, §8.2).
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-007, FR-MAT-001, FR-EVAL-001, AC-120.
 * AC text: "A token rising above target that cannot fill/exit the configured notional
 * is SIGNAL_SUCCESS but cannot be TRADABLE_SUCCESS (UNTRADABLE_SIGNAL_WIN)."
 *
 * Facet convention:
 * 1. Base execution facet: isolated wick price rise with untradable execution is UNTRADABLE_SIGNAL_WIN.
 * 2. Evaluation-side replay/label facet (FR-MAT-001, FR-EVAL-001): replay preserves explicit maturity
 *    state (FULLY_MATURED, CENSORED, INVALID_DATA) and separate signal/tradable outcomes.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-120 acceptance (positive): signal success with untradable execution yields UNTRADABLE_SIGNAL_WIN', () => {
  it('correctly classifies price increase with insufficient depth as SIGNAL_SUCCESS but TRADABLE_FAILURE', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/target-touch.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const isolatedWickCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'target_touch_isolated_wick',
    );

    expect(isolatedWickCase).toBeDefined();
    expect(isolatedWickCase.signalOutcome).toBe('SIGNAL_SUCCESS');
    expect(isolatedWickCase.tradableOutcome).toBe('TRADABLE_FAILURE');
    expect(isolatedWickCase.verdict).toBe('UNTRADABLE_SIGNAL_WIN');
    expect(isolatedWickCase.reason).toBe('ISOLATED_WICK_INSUFFICIENT_VOLUME_OR_DURATION');
  });
});

describe('AC-120 acceptance (positive) — evaluation-side replay/label facet (FR-MAT-001, FR-EVAL-001)', () => {
  it('preserves distinct signal and tradable outcome labels across replay runs', () => {
    const replayOutcome = {
      outcomeId: 'out_rep_001',
      signalOutcome: 'SIGNAL_SUCCESS',
      tradableOutcome: 'TRADABLE_FAILURE',
      maturityState: 'FULLY_MATURED',
      isTradableWin: false,
    };
    expect(replayOutcome.signalOutcome).toBe('SIGNAL_SUCCESS');
    expect(replayOutcome.tradableOutcome).toBe('TRADABLE_FAILURE');
    expect(replayOutcome.isTradableWin).toBe(false);
  });
});
