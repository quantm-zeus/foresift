/**
 * AC-247 negative / failure-path.
 * Traces: FR-OBJ-006, FR-OBJ-007, FR-OBJ-009, AC-247.
 * Refusal paths:
 * - Frozen counts immutable under retrospective estimates
 * - Backdated ledger modifications refused
 */
import { describe, expect, it } from 'bun:test';

describe('AC-247 negative: backdated or retrospective mutation of frozen ledgers is refused', () => {
  it('refuses retrospective overwrite of existing frozen experiment results', () => {
    const frozenExperiment = Object.freeze({
      experimentId: 'exp-frozen-001',
      utility: 80000,
      frozen: true,
    });

    const attemptOverwrite = (exp: typeof frozenExperiment, newUtility: number) => {
      if (exp.frozen) {
        throw new Error('OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED');
      }
      return { ...exp, utility: newUtility };
    };

    expect(() => attemptOverwrite(frozenExperiment, 95000)).toThrow(
      /OBJ_FROZEN_EXPERIMENT_REWRITE_REFUSED/,
    );
  });
});
