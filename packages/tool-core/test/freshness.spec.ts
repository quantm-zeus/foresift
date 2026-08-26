/**
 * Freshness evaluation units (FR-CORE-006, §16.5): the PRD default table is
 * the data, boundaries are INCLUSIVE (fresh through freshUntil, stale-
 * admissible through staleUntil), MANUAL_ONLY families admit stale reads
 * only to manual holder modes, and composition-time overrides replace whole
 * rows while refusing inverted windows.
 */
import { describe, expect, it } from 'bun:test';
import { DEFAULT_FRESHNESS_POLICY_TABLE, FreshnessFieldFamily } from '@foresift/domain';
import { FreshnessEvaluator } from '../src/freshness.ts';

const STORED = '2026-08-01T00:00:00Z';
const at = (seconds: number) => new Date(Date.parse(STORED) + seconds * 1000).toISOString();

describe('default-table evaluation with inclusive edges', () => {
  // price-trades row: fresh 30s / stale 120s / MANUAL_ONLY — the strictest
  // family; AUTOMATED families exercise only the boundary arithmetic.
  it.each([
    ['at stored_at', 0, 'HIT_FRESH'],
    ['one second before the fresh edge', 29, 'HIT_FRESH'],
    ['exactly at the fresh edge (inclusive)', 30, 'HIT_FRESH'],
    ['inside the stale window', 60, 'EXPIRED'], // automated holders: refused
    ['exactly at the stale edge', 120, 'EXPIRED'], // automated holders: refused
    ['beyond the stale window', 121, 'EXPIRED'],
  ] as const)('price-trades automated holder: %s ⇒ %s', (_label, seconds, outcome) => {
    const evaluator = new FreshnessEvaluator();
    expect(
      evaluator.evaluate({
        family: FreshnessFieldFamily.PRICE_TRADES,
        storedAt: STORED,
        decisionTime: at(seconds),
        holderMode: 'CHATGPT',
      }).outcome,
    ).toBe(outcome);
  });

  it.each([
    ['one second past the fresh edge', 31, 'HIT_STALE'],
    ['mid stale window', 60, 'HIT_STALE'],
    ['exactly at the stale edge (inclusive)', 120, 'HIT_STALE'],
    ['one second beyond', 121, 'EXPIRED'],
  ] as const)('price-trades manual holder: %s ⇒ %s', (_label, seconds, outcome) => {
    const evaluator = new FreshnessEvaluator();
    expect(
      evaluator.evaluate({
        family: FreshnessFieldFamily.PRICE_TRADES,
        storedAt: STORED,
        decisionTime: at(seconds),
        holderMode: 'MCP_MANUAL',
      }).outcome,
    ).toBe(outcome);
  });

  it.each(['MCP_MANUAL', 'ADMIN_CHAT'] as const)('%s admits manual-only stale', (mode) => {
    const evaluator = new FreshnessEvaluator();
    expect(
      evaluator.evaluate({
        family: FreshnessFieldFamily.PRICE_TRADES,
        storedAt: STORED,
        decisionTime: at(60),
        holderMode: mode,
      }).outcome,
    ).toBe('HIT_STALE');
  });

  it.each(['CHATGPT', 'AUTOMATION'] as const)('%s is refused manual-only stale', (mode) => {
    const evaluator = new FreshnessEvaluator();
    expect(
      evaluator.evaluate({
        family: FreshnessFieldFamily.PRICE_TRADES,
        storedAt: STORED,
        decisionTime: at(60),
        holderMode: mode,
      }).outcome,
    ).toBe('EXPIRED');
  });

  it.each([
    [FreshnessFieldFamily.HOLDER_SUMMARY, 600],
    [FreshnessFieldFamily.METADATA, 604_800],
  ] as const)(
    '%s AUTOMATED family admits stale to automation at its fresh edge',
    (family, freshTtl) => {
      const evaluator = new FreshnessEvaluator();
      expect(
        evaluator.evaluate({
          family,
          storedAt: STORED,
          decisionTime: at(freshTtl),
          holderMode: 'AUTOMATION',
        }).outcome,
      ).toBe('HIT_FRESH');
      expect(
        evaluator.evaluate({
          family,
          storedAt: STORED,
          decisionTime: at(freshTtl + 1),
          holderMode: 'AUTOMATION',
        }).outcome,
      ).toBe('HIT_STALE');
    },
  );
});

describe('composition-time overrides', () => {
  it('replaces whole rows without touching the shared default table', () => {
    const evaluator = new FreshnessEvaluator({
      [FreshnessFieldFamily.PRICE_TRADES]: {
        freshTtlSeconds: 10,
        acceptableStaleSeconds: 20,
        staleAdmission: 'AUTOMATED',
      },
    });
    expect(evaluator.policyFor(FreshnessFieldFamily.PRICE_TRADES)).toEqual({
      freshTtlSeconds: 10,
      acceptableStaleSeconds: 20,
      staleAdmission: 'AUTOMATED',
    });
    // Untouched families keep PRD defaults; so does the shared table itself.
    expect(evaluator.policyFor(FreshnessFieldFamily.METADATA)).toEqual(
      DEFAULT_FRESHNESS_POLICY_TABLE[FreshnessFieldFamily.METADATA],
    );
  });

  it('refuses overrides that invert the window shape', () => {
    expect(
      () =>
        new FreshnessEvaluator({
          [FreshnessFieldFamily.METADATA]: {
            freshTtlSeconds: 100,
            acceptableStaleSeconds: 50,
            staleAdmission: 'AUTOMATED',
          },
        }),
    ).toThrow(/FRESHNESS_POLICY_INVALID|windows out of order/);
  });

  it('reports freshUntil/staleUntil consistent with the policy row', () => {
    const evaluator = new FreshnessEvaluator();
    const decision = evaluator.evaluate({
      family: FreshnessFieldFamily.LIQUIDITY_POOL,
      storedAt: STORED,
      decisionTime: STORED,
      holderMode: 'AUTOMATION',
    });
    expect(decision.freshUntil).toBe(at(120));
    expect(decision.staleUntil).toBe(at(600));
  });
});
