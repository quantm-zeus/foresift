/**
 * AC-120 acceptance (positive) — signal vs tradable outcome separation (§64.12, §8.2).
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-007, AC-120.
 * AC text: "A token rising above target that cannot fill/exit the configured notional
 * is SIGNAL_SUCCESS but cannot be TRADABLE_SUCCESS (UNTRADABLE_SIGNAL_WIN)."
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
