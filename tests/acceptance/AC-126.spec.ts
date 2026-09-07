/**
 * AC-126 acceptance (positive) — low-resolution price snapshot supports signal label only (§64.14, FR-EXEC-011).
 * Traces: FR-EXEC-004, FR-EXEC-011, AC-126.
 * AC text: "A low-resolution price snapshot supports a signal label but cannot establish a short-lived
 * executable target or tradable success without the required observation plan."
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
