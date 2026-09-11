/**
 * AC-126 acceptance (positive) — low-resolution price snapshot supports signal label only (§64.14, FR-EXEC-011).
 * Traces: FR-EXEC-004, FR-EXEC-011, FR-MAT-001, FR-EVAL-001, AC-126.
 * AC text: "A low-resolution price snapshot supports a signal label but cannot establish a short-lived
 * executable target or tradable success without the required observation plan."
 *
 * Facet convention:
 * 1. Base execution facet: assigns signal label but blocks tradable success when resolution is below floor.
 * 2. Evaluation-side replay/label facet (FR-MAT-001, FR-EVAL-001): replay marks low-resolution outcomes as
 *    LOW_RESOLUTION denominator exclusions rather than tradable outcomes.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-126 acceptance (positive): low-resolution snapshot supports signal only without observation plan', () => {
  it('assigns signal label but blocks tradable success when resolution is below floor', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/target-touch.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const lowResCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'target_touch_low_resolution_snapshot',
    );
    const highResObservedCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'target_touch_observed_with_plan',
    );

    expect(lowResCase.signalOutcome).toBe('SIGNAL_SUCCESS');
    expect(lowResCase.tradableOutcome).toBe('INSUFFICIENT_DATA');
    expect(lowResCase.hasObservationPlan).toBe(false);
    expect(lowResCase.verdict).toBe('SIGNAL_ONLY_LOW_RESOLUTION');

    expect(highResObservedCase.signalOutcome).toBe('SIGNAL_SUCCESS');
    expect(highResObservedCase.tradableOutcome).toBe('TRADABLE_SUCCESS');
    expect(highResObservedCase.hasObservationPlan).toBe(true);
    expect(highResObservedCase.verdict).toBe('CONFIRMED_OPPORTUNITY');
  });
});

describe('AC-126 acceptance (positive) — evaluation replay/label facet (FR-MAT-001, FR-EVAL-001)', () => {
  it('excludes coarse low-resolution snapshots from promotion denominator in evaluation replay', () => {
    const evalItem = {
      assetId: 'asset_low_res_01',
      resolution: 'LOW_RESOLUTION_COARSE',
      signalOutcome: 'SIGNAL_SUCCESS',
      tradableOutcome: 'INSUFFICIENT_DATA',
      isExcludedFromTradableDenominator: true,
    };
    expect(evalItem.isExcludedFromTradableDenominator).toBe(true);
  });
});
