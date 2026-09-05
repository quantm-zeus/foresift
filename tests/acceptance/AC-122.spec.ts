/**
 * AC-122 acceptance (positive) — target touch executable volume and duration (§64.13).
 * Traces: FR-EXEC-004, AC-122.
 * AC text: "A one-slot target wick without executable volume or duration does not satisfy tradable success."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('AC-122 acceptance (positive): isolated wick does not satisfy tradable success', () => {
  it('requires executable volume and duration to satisfy tradable success', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/target-touch.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const isolatedWick = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'target_touch_isolated_wick',
    );
    const sustained = fixture.cases.find(
      (c: Record<string, unknown>) => c.caseId === 'target_touch_sustained_depth',
    );

    expect(isolatedWick.wickDurationSlots).toBeLessThan(isolatedWick.minRequiredDurationSlots);
    expect(isolatedWick.wickExecutableVolumeUsd).toBeLessThan(isolatedWick.requiredNotionalUsd);
    expect(isolatedWick.tradableOutcome).toBe('TRADABLE_FAILURE');

    expect(sustained.touchDurationSlots).toBeGreaterThanOrEqual(sustained.minRequiredDurationSlots);
    expect(sustained.executableVolumeUsd).toBeGreaterThanOrEqual(sustained.requiredNotionalUsd);
    expect(sustained.tradableOutcome).toBe('TRADABLE_SUCCESS');
  });
});
