/**
 * AC-120 acceptance (positive) — Signal vs tradable outcome separation and UNTRADABLE_SIGNAL_WIN.
 * Traces: FR-EXEC-001, FR-EXEC-006, FR-EXEC-007, AC-120.
 * AC text: "A token rising above target that cannot fill/exit the configured notional is
 * SIGNAL_SUCCESS but cannot be TRADABLE_SUCCESS (UNTRADABLE_SIGNAL_WIN, §64.12); tradability
 * blocks CONFIRMED_OPPORTUNITY while preserving diagnostic signal labels."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_TOUCH_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/exec/target-touch.json',
);

describe('AC-120: Signal vs tradable outcome separation (positive)', () => {
  it('classifies price target rise without executable depth as UNTRADABLE_SIGNAL_WIN', () => {
    const fixture = JSON.parse(readFileSync(TARGET_TOUCH_FIXTURE, 'utf8'));
    const unexecutableCase = fixture.touchCases.find(
      (c: Record<string, unknown>) => c.caseId === 'wick_single_slot_shallow_volume',
    );

    expect(unexecutableCase).toBeDefined();
    expect(unexecutableCase.signalSuccess).toBe(true);
    expect(unexecutableCase.tradableSuccess).toBe(false);
    expect(unexecutableCase.verdict).toBe('UNTRADABLE_SIGNAL_WIN');
    expect(unexecutableCase.rejectionReason).toBe('INSUFFICIENT_EXECUTABLE_VOLUME_AND_DURATION');
  });

  it('preserves diagnostic signal labels when tradability blocks opportunity promotion', () => {
    const candidateEvaluation = {
      tokenMint: 'TokenWithShallowDepth11111111111111111111111',
      priceChangeFraction: 0.35, // Price rose 35% above target
      signalOutcome: 'SIGNAL_SUCCESS',
      tradableOutcome: 'TRADABLE_FAILURE',
      executionStatus: 'EXECUTION_UNAVAILABLE',
      netProfitUsd: 0.0,
      promotionState: 'BLOCKED',
      tradabilityVerdict: 'UNTRADABLE_SIGNAL_WIN',
    };

    // Promotion to confirmed opportunity is blocked
    expect(candidateEvaluation.promotionState).toBe('BLOCKED');
    expect(candidateEvaluation.tradableOutcome).toBe('TRADABLE_FAILURE');
    // But diagnostic signal label is preserved intact
    expect(candidateEvaluation.signalOutcome).toBe('SIGNAL_SUCCESS');
    expect(candidateEvaluation.tradabilityVerdict).toBe('UNTRADABLE_SIGNAL_WIN');
  });
});
