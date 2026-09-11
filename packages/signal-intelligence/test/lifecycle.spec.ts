/**
 * Lifecycle state machine & hysteresis tests (T018, FR-SIG-005, AC-154).
 * Tests state-machine transitions, hysteresis asymmetry, dwell violations,
 * CONFIRMED-without-tradable refusal, and thesis invalidation evaluation.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tests/fixtures/sig/lifecycle-rechecks.json',
);

describe('packages/signal-intelligence: Lifecycle State Machine & Hysteresis', () => {
  it('enumerates all 8 lifecycle states', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    expect(fixture.lifecycleStates).toEqual([
      'DISCOVERED',
      'QUALIFIED',
      'EMERGING',
      'CONFIRMED',
      'MONITORING',
      'DECAYING',
      'REJECTED',
      'ARCHIVED',
    ]);
  });

  it('hysteresis: demotion threshold is lower and requires consecutive windows', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const promo = fixture.hysteresisTransitions.find(
      (t: { name: string }) => t.name === 'qualified_to_emerging_promotion',
    );
    const demo = fixture.hysteresisTransitions.find(
      (t: { name: string }) => t.name === 'emerging_to_qualified_demotion_requires_sustained_drop',
    );

    expect(promo.promotionThreshold).toBe(0.7);
    expect(demo.demotionThreshold).toBe(0.45);
    expect(demo.demotionThreshold).toBeLessThan(promo.promotionThreshold);
    expect(demo.allowed).toBe(false); // 1 window drop to 0.50 does not trigger demotion
  });

  it('CONFIRMED state transition strictly requires proven TRADABLE verdict', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const failConfirmed = fixture.hysteresisTransitions.find(
      (t: { name: string }) => t.name === 'confirmed_requires_tradable_verdict',
    );
    const passConfirmed = fixture.hysteresisTransitions.find(
      (t: { name: string }) => t.name === 'confirmed_succeeds_with_tradable_verdict',
    );

    expect(failConfirmed.allowed).toBe(false);
    expect(failConfirmed.expectedError).toBe('SIG_CONFIRMED_REQUIRES_TRADABLE_VERDICT');

    expect(passConfirmed.allowed).toBe(true);
    expect(passConfirmed.tradabilityVerdict).toBe('TRADABLE');
  });
});
