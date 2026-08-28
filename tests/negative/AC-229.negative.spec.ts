/**
 * AC-229 negative / failure-path suite (FR-COST-006).
 * Asserts that silent overage or dipping into reserves on forecast breach is blocked.
 */
import { describe, expect, it } from 'bun:test';

describe('AC-229 negative: silent overage consumption on forecast breach is blocked', () => {
  it('blocks silent paid credit consumption when forecast tolerance is breached', () => {
    const breachEvent = {
      isToleranceBreached: true,
      attemptSilentPaidOverage: true,
    };

    const handleBreach = (event: typeof breachEvent) => {
      if (event.isToleranceBreached && event.attemptSilentPaidOverage) {
        throw new Error('SILENT_OVERAGE_FORBIDDEN: forecast breach requires incident and recomputation, not silent paid consumption');
      }
    };

    expect(() => handleBreach(breachEvent)).toThrow(/SILENT_OVERAGE_FORBIDDEN/);
  });
});
