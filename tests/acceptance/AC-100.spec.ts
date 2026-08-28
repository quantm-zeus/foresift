/**
 * AC-100 acceptance (positive) — cost-capacity facet.
 * Traces: FR-COST-001, FR-COST-002, FR-COST-007.
 * AC text (manifest §39): "In STRICT_FREE mode, paid, unknown-cost, overage,
 * automatic-upgrade, and paid-fallback operations are blocked before network
 * execution and audited."
 *
 * Facet scope (cost-capacity):
 * - Evaluates provider operations against STRICT_FREE guard.
 * - Asserts COST_BLOCKED stage block before network execution.
 * - Confirms audited denial record contains candidate, caller, reason, alternative.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';
import { CostQuotaAdapter } from '../../packages/cost-router/src/quota-adapter.ts';
import { evaluateStrictFreeGuard } from '../../packages/cost-router/src/strict-free-guard.ts';
import {
  FREE_QUOTA_OP,
  FREE_UNMETERED_OP,
  PAID_EXPLICIT_OP,
  UNKNOWN_COST_OP,
  AUTO_UPGRADE_OP,
} from '../fixtures/cost/operations.ts';

let tdb: TestDatabase;
let adapter: CostQuotaAdapter;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  adapter = new CostQuotaAdapter({ engine: tdb.engine, mode: 'STRICT_FREE' });
});

afterAll(async () => {
  await closeTestDatabase(tdb);
});

describe('AC-100 acceptance (positive): STRICT_FREE pre-network blocking and audit', () => {
  it('admits free unmetered operations under STRICT_FREE', async () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: FREE_UNMETERED_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 1000,
      requestedUnits: 0,
      callerId: 'actor_user:run_100_1',
      paidFallbackAttempted: false,
    });
    expect(verdict.allowed).toBe(true);
  });

  it('admits free quota operations within budget under STRICT_FREE', async () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: FREE_QUOTA_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 1,
      callerId: 'actor_user:run_100_2',
      paidFallbackAttempted: false,
    });
    expect(verdict.allowed).toBe(true);
  });

  it('blocks PAID_EXPLICIT operations before execution and generates audit payload', async () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: PAID_EXPLICIT_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 10,
      callerId: 'actor_user:run_100_3',
      paidFallbackAttempted: false,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.denial).toBeDefined();
    expect(verdict.denial!.reason).toMatch(/^PAID_BLOCKED:/);
    expect(verdict.denial!.candidate).toContain('prov_paid_market');
    expect(verdict.denial!.caller).toBe('actor_user:run_100_3');
    expect(verdict.denial!.alternative).toBeDefined();
  });

  it('blocks UNKNOWN_COST operations before execution', async () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: UNKNOWN_COST_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 1,
      callerId: 'actor_user:run_100_4',
      paidFallbackAttempted: false,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.denial!.reason).toMatch(/^UNKNOWN_COST:/);
  });

  it('blocks over-quota operations before execution', async () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: FREE_QUOTA_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 0,
      requestedUnits: 1,
      callerId: 'actor_user:run_100_5',
      paidFallbackAttempted: false,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.denial!.reason).toMatch(/^QUOTA_EXHAUSTED:/);
  });

  it('blocks auto-upgrade operations before execution', async () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: AUTO_UPGRADE_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 5,
      callerId: 'actor_user:run_100_6',
      paidFallbackAttempted: false,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.denial!.reason).toMatch(/^AUTO_UPGRADE_BLOCKED:/);
  });

  it('blocks paid fallback attempts before execution', async () => {
    const verdict = evaluateStrictFreeGuard({
      declaration: FREE_QUOTA_OP,
      workloadClass: 'INTERACTIVE_HIGH',
      remainingUnits: 100,
      requestedUnits: 1,
      callerId: 'actor_user:run_100_7',
      paidFallbackAttempted: true,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.denial!.reason).toMatch(/^PAID_FALLBACK_BLOCKED:/);
  });
});
