/**
 * AC-122 acceptance (positive) — Executable target touch vs isolated wick law.
 * Traces: FR-EXEC-004, AC-122.
 * AC text: "A one-slot target wick without executable volume or duration does not satisfy
 * tradable success (§64.13); target touch requires executable volume or configured target-duration support."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_TOUCH_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/target-touch.json',
);

describe('AC-122: Executable target touch requirement and isolated wick refusal (positive)', () => {
  it('denies tradable success for isolated one-slot wick with insufficient volume', () => {
    const fixture = JSON.parse(readFileSync(TARGET_TOUCH_FIXTURE, 'utf8'));
    const shallowWick = fixture.touchCases.find(
      (c: Record<string, unknown>) => c.caseId === 'wick_single_slot_shallow_volume',
    );

    expect(shallowWick).toBeDefined();
    expect(shallowWick.isolatedWickDetected).toBe(true);
    expect(shallowWick.touchDurationSlots).toBe(1);
    expect(shallowWick.executableVolumeAtTargetUsd).toBeLessThan(shallowWick.requiredNotionalUsd);
    expect(shallowWick.tradableSuccess).toBe(false);
    expect(shallowWick.verdict).toBe('UNTRADABLE_SIGNAL_WIN');
  });

  it('satisfies tradable success when single-slot touch is backed by deep executable volume', () => {
    const fixture = JSON.parse(readFileSync(TARGET_TOUCH_FIXTURE, 'utf8'));
    const deepVolumeTouch = fixture.touchCases.find(
      (c: Record<string, unknown>) => c.caseId === 'wick_single_slot_deep_volume',
    );

    expect(deepVolumeTouch).toBeDefined();
    expect(deepVolumeTouch.isolatedWickDetected).toBe(false);
    expect(deepVolumeTouch.executableVolumeAtTargetUsd).toBeGreaterThanOrEqual(deepVolumeTouch.requiredNotionalUsd);
    expect(deepVolumeTouch.tradableSuccess).toBe(true);
    expect(deepVolumeTouch.verdict).toBe('TRADABLE_SUCCESS');
  });

  it('satisfies tradable success when target price is sustained across required duration slots', () => {
    const fixture = JSON.parse(readFileSync(TARGET_TOUCH_FIXTURE, 'utf8'));
    const sustainedDuration = fixture.touchCases.find(
      (c: Record<string, unknown>) => c.caseId === 'target_sustained_duration_supported',
    );

    expect(sustainedDuration).toBeDefined();
    expect(sustainedDuration.touchDurationSlots).toBeGreaterThanOrEqual(sustainedDuration.minTargetDurationRequiredSlots);
    expect(sustainedDuration.tradableSuccess).toBe(true);
    expect(sustainedDuration.verdict).toBe('TRADABLE_SUCCESS');
  });
});
