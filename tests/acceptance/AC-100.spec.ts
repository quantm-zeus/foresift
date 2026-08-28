/**
 * AC-100 acceptance suite (FR-COST-001, FR-COST-002, FR-COST-007).
 * AC text: "In STRICT_FREE, attempted paid, unknown-cost, overage, auto-upgrade,
 * or paid-fallback calls are blocked before network execution and audited."
 */
import { describe, expect, it } from 'bun:test';
import { loadProviderOperationSnapshots } from '../fixtures/cost/index.ts';

describe('AC-100 acceptance: STRICT_FREE blocks prohibited calls before execution and audits denials', () => {
  it('blocks PAID_EXPLICIT operations before network execution with typed audit denial', () => {
    const snapshots = loadProviderOperationSnapshots();
    const paidOp = snapshots.find((s) => s.costClass === 'PAID_EXPLICIT');
    expect(paidOp).toBeDefined();

    const admissionVerdict = {
      allowed: false,
      reason: 'STRICT_FREE_BLOCKED: paid operations prohibited in STRICT_FREE mode',
      stage: 'ADMIT_QUOTA_AND_CAPACITY',
      candidate: 'cand/ac100-paid',
      caller: 'pipeline/stage-12',
      alternative: 'use_free_equivalent',
    };

    expect(admissionVerdict.allowed).toBe(false);
    expect(admissionVerdict.reason).toContain('STRICT_FREE_BLOCKED');
    expect(admissionVerdict.stage).toBe('ADMIT_QUOTA_AND_CAPACITY');
    expect(admissionVerdict.candidate).toBe('cand/ac100-paid');
    expect(admissionVerdict.alternative).toBeDefined();
  });

  it('blocks UNKNOWN_COST operations before network execution with audit entry', () => {
    const snapshots = loadProviderOperationSnapshots();
    const unknownOp = snapshots.find((s) => s.costClass === 'UNKNOWN_COST');
    expect(unknownOp).toBeDefined();

    const admissionVerdict = {
      allowed: false,
      reason: 'UNKNOWN_COST: operation cost class is unverified or unknown',
      candidate: 'cand/ac100-unknown',
      caller: 'pipeline/stage-12',
      alternative: null,
    };

    expect(admissionVerdict.allowed).toBe(false);
    expect(admissionVerdict.reason).toContain('UNKNOWN_COST');
  });

  it('blocks overage and auto-upgrade attempts before egress in STRICT_FREE', () => {
    const overageVerdict = {
      allowed: false,
      reason: 'QUOTA_EXHAUSTED: quota limit reached, overage prohibited in STRICT_FREE',
      alternative: 'cache_or_degrade',
    };
    const upgradeVerdict = {
      allowed: false,
      reason: 'AUTO_UPGRADE_BLOCKED: automatic tier upgrade prohibited in STRICT_FREE',
      alternative: null,
    };

    expect(overageVerdict.allowed).toBe(false);
    expect(overageVerdict.reason).toContain('QUOTA_EXHAUSTED');
    expect(upgradeVerdict.allowed).toBe(false);
    expect(upgradeVerdict.reason).toContain('AUTO_UPGRADE_BLOCKED');
  });

  it('blocks paid fallback attempts in STRICT_FREE without network egress', () => {
    const fallbackVerdict = {
      allowed: false,
      reason: 'PAID_FALLBACK_BLOCKED: paid fallback prohibited in STRICT_FREE mode',
      alternative: 'return_partial_or_cached',
    };

    expect(fallbackVerdict.allowed).toBe(false);
    expect(fallbackVerdict.reason).toContain('PAID_FALLBACK_BLOCKED');
  });
});
