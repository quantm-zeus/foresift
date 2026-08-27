// AC-276 (acceptance): compliant marketing/UI/API/export text passes
// content-policy validation on its channel — the paired clean-text controls
// for the prohibited claim classes.
import { describe, expect, it } from 'bun:test';
import {
  assertClaimsCompliant,
  evaluateClaims,
} from '../../packages/security/src/claims-policy.ts';

const CLEAN_COPY: readonly [string, Parameters<typeof evaluateClaims>[1]][] = [
  ['portfolio snapshots refreshed hourly', 'UI'],
  ['signals are probabilistic and may fail', 'MARKETING'],
  ['detector coverage measured against labeled backfills', 'API'],
  ['historical performance does not guarantee future results', 'EXPORT'],
  ['alerts include evidence references and limitations', 'UI'],
];

describe('AC-276: compliant content passes policy on every channel', () => {
  it('admits each clean-copy control on its channel', () => {
    for (const [text, channel] of CLEAN_COPY) {
      const result = evaluateClaims(text, channel);
      expect(result.verdict, text).toBe('COMPLIANT');
      expect(() => assertClaimsCompliant(text, channel), text).not.toThrow();
    }
  });

  it('admits hedged performance language that names its own uncertainty', () => {
    for (const channel of ['MARKETING', 'UI', 'API', 'EXPORT'] as const) {
      expect(evaluateClaims('backtested sharpe was 1.2 in simulation', channel).verdict).toBe(
        'COMPLIANT',
      );
    }
  });
});
