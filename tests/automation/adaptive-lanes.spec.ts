// Hyperdrive H3 P2-10 — adaptive lane count regressions: parallelizable-work
// heuristic, exact preflight refinement, governor and permit caps, and
// conservative degradation on missing truth.
import { describe, test, expect } from 'bun:test';
import {
  resolveAdaptiveLaneCount,
  LANE_COUNT_LIMITS,
  ADAPTIVE_LANES_SCHEMA,
} from '../../scripts/automation/adaptive-lanes.mjs';

describe('resolveAdaptiveLaneCount', () => {
  test('serial-only work collapses to one lane; [P] units justify extras', () => {
    expect(resolveAdaptiveLaneCount({ openTaskCount: 5, parallelizableCount: 0 }).lanes).toBe(1);
    expect(resolveAdaptiveLaneCount({ openTaskCount: 5, parallelizableCount: 1 }).lanes).toBe(1); // a single [P] unit needs no extra lane
    expect(resolveAdaptiveLaneCount({ openTaskCount: 5, parallelizableCount: 2 }).lanes).toBe(2);
    expect(resolveAdaptiveLaneCount({ openTaskCount: 9, parallelizableCount: 4 }).lanes).toBe(
      LANE_COUNT_LIMITS.max,
    ); // ceiling
  });

  test('exact preflight shard need overrides the heuristic both ways', () => {
    const low = resolveAdaptiveLaneCount({
      openTaskCount: 9,
      parallelizableCount: 4,
      disjointShardNeed: 2,
    });
    expect(low.lanes).toBe(2);
    expect(low.reason).toContain('exact preflight');
    const floor = resolveAdaptiveLaneCount({
      openTaskCount: 5,
      parallelizableCount: 0,
      disjointShardNeed: 1,
    });
    expect(floor.lanes).toBe(1);
  });

  test('governor pressure caps lanes; RED never blocks the serial core', () => {
    const yellow = resolveAdaptiveLaneCount({
      openTaskCount: 9,
      parallelizableCount: 4,
      governorState: 'YELLOW',
    });
    expect(yellow.lanes).toBe(1);
    expect(yellow.capped).toBe(true);
    const red = resolveAdaptiveLaneCount({
      openTaskCount: 9,
      parallelizableCount: 4,
      governorState: 'RED',
    });
    expect(red.lanes).toBe(1);
    expect(red.capped).toBe(true);
  });

  test('provider permit capacity caps lanes below work need', () => {
    const capped = resolveAdaptiveLaneCount({
      openTaskCount: 9,
      parallelizableCount: 4,
      codexLimit: 1,
      claudeLimit: 1,
    });
    expect(capped.lanes).toBe(2);
    expect(capped.capped).toBe(true);
    expect(capped.reason).toContain('provider capacity');
  });

  test('missing truth degrades to the conservative default, never expansion', () => {
    const d = resolveAdaptiveLaneCount({});
    expect(d.lanes).toBe(1);
    expect(d.schema).toBe(ADAPTIVE_LANES_SCHEMA);
    const junk = resolveAdaptiveLaneCount({
      openTaskCount: 'nine' as unknown as number,
      parallelizableCount: NaN,
      governorState: 'green',
    });
    expect(junk.lanes).toBe(1);
  });
});
