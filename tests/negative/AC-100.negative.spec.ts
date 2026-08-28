/**
 * AC-100 negative (failure) — cost-capacity facet.
 * Traces: FR-COST-001, FR-COST-002, FR-COST-007.
 * Tests field mutations and replay of blocked calls to ensure denial persistence and audit stability.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from '../acceptance/helpers.ts';
import { evaluateStrictFreeGuard } from '../../packages/cost-router/src/strict-free-guard.ts';
import { FREE_QUOTA_OP } from '../fixtures/cost/operations.ts';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await makeTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-100 negative: mutated inputs and replayed denials remain blocked', () => {
  it('mutating costClass to PAID_EXPLICIT immediately triggers denial', () => {
    const mutated = {
      ...FREE_QUOTA_OP,
      costClass: 'PAID_EXPLICIT',
    };

    const verdict = evaluateStrictFreeGuard({
      declaration: mutated,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 1,
      callerId: 'actor_neg:run_100_neg_1',
      paidFallbackAttempted: false,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.denial!.reason).toMatch(/^PAID_BLOCKED:/);
  });

  it('mutating allowedInStrictFree to false blocks execution', () => {
    const mutated = {
      ...FREE_QUOTA_OP,
      allowedInStrictFree: false,
    };

    const verdict = evaluateStrictFreeGuard({
      declaration: mutated,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 1,
      callerId: 'actor_neg:run_100_neg_2',
      paidFallbackAttempted: false,
    });

    expect(verdict.allowed).toBe(false);
  });

  it('replaying a blocked call remains deterministically blocked with identical denial', () => {
    const input = {
      declaration: {
        ...FREE_QUOTA_OP,
        costClass: 'PAID_EXPLICIT',
      },
      workloadClass: 'INTERACTIVE_HIGH' as const,
      remainingUnits: 100,
      requestedUnits: 1,
      callerId: 'actor_neg:run_100_neg_3',
      paidFallbackAttempted: false,
    };

    const run1 = evaluateStrictFreeGuard(input);
    const run2 = evaluateStrictFreeGuard(input);

    expect(run1.allowed).toBe(false);
    expect(run2.allowed).toBe(false);
    expect(run1.denial!.reason).toBe(run2.denial!.reason);
  });
});
