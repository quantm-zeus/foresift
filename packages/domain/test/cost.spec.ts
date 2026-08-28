/**
 * Cost domain vocabulary unit tests (FR-COST-001, FR-COST-002, FR-COST-003, FR-COST-009).
 * Tests fail-closed resolution for CostClass, ResetPolicyKind, ReserveId,
 * ResourceBudgetKind, and CostMode.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_COST_CLASSES,
  ALL_COST_MODES,
  ALL_RESERVE_IDS,
  ALL_RESET_POLICY_KINDS,
  ALL_RESOURCE_BUDGET_KINDS,
  CostClass,
  CostMode,
  ReserveId,
  ResetPolicyKind,
  ResourceBudgetKind,
  costClass,
  costMode,
  isAllowedInStrictFreeCostClass,
  isProtectedReserveWorkload,
  reserveId,
  resetPolicyKind,
  resourceBudgetKind,
} from '../src/cost.ts';
import { ForesiftError } from '../src/errors.ts';

const VOCABULARIES = [
  ['costClass', costClass, ALL_COST_CLASSES],
  ['resetPolicyKind', resetPolicyKind, ALL_RESET_POLICY_KINDS],
  ['reserveId', reserveId, ALL_RESERVE_IDS],
  ['resourceBudgetKind', resourceBudgetKind, ALL_RESOURCE_BUDGET_KINDS],
  ['costMode', costMode, ALL_COST_MODES],
] as const;

describe('cost domain vocabulary resolution', () => {
  it.each(VOCABULARIES)('%s resolves every member of its exact PRD set', (_name, resolve, all) => {
    for (const value of all) {
      expect(resolve(value)).toBe(value);
    }
  });

  it.each(VOCABULARIES)('%s refuses unknown values fail-closed with ForesiftError', (_name, resolve, all) => {
    expect(() => resolve('TOTALLY_UNKNOWN')).toThrow(ForesiftError);
    expect(() => resolve('')).toThrow(ForesiftError);
    for (const value of all) {
      const drifted = value.toLowerCase();
      if (!all.includes(drifted as never)) {
        expect(() => resolve(drifted)).toThrow(ForesiftError);
      }
    }
  });
});

describe('CostClass exact PRD specification', () => {
  it('contains the 5 standard cost classes verbatim', () => {
    expect(ALL_COST_CLASSES).toEqual([
      'FREE_UNMETERED',
      'FREE_QUOTA',
      'PAID_EXPLICIT',
      'UNKNOWN_COST',
      'DISABLED',
    ]);
  });

  it('identifies strict-free allowed classes accurately', () => {
    expect(isAllowedInStrictFreeCostClass(CostClass.FREE_UNMETERED)).toBe(true);
    expect(isAllowedInStrictFreeCostClass(CostClass.FREE_QUOTA)).toBe(true);
    expect(isAllowedInStrictFreeCostClass(CostClass.PAID_EXPLICIT)).toBe(false);
    expect(isAllowedInStrictFreeCostClass(CostClass.UNKNOWN_COST)).toBe(false);
    expect(isAllowedInStrictFreeCostClass(CostClass.DISABLED)).toBe(false);
  });
});

describe('ReserveId exact PRD specification', () => {
  it('contains the 4 protected reserves verbatim', () => {
    expect(ALL_RESERVE_IDS).toEqual([
      'RISK_MONITORING',
      'ALERT_VERIFICATION',
      'INTERACTIVE_MCP',
      'EMERGENCY_BACKFILL',
    ]);
  });

  it('rejects broad-scan workloads from protected reserve eligibility', () => {
    expect(isProtectedReserveWorkload('INTERACTIVE_HIGH')).toBe(true);
    expect(isProtectedReserveWorkload('RISK_MONITOR_HIGH')).toBe(true);
    expect(isProtectedReserveWorkload('SCHEDULED_NORMAL')).toBe(false);
    expect(isProtectedReserveWorkload('EVALUATION_LOW')).toBe(false);
    expect(isProtectedReserveWorkload('BACKFILL_LOW')).toBe(false);
  });
});

describe('ResourceBudgetKind exact PRD specification', () => {
  it('contains the 6 resource budget kinds verbatim', () => {
    expect(ALL_RESOURCE_BUDGET_KINDS).toEqual([
      'SCHEDULER_SLOTS',
      'WORKFLOW_STEPS',
      'DATABASE_BYTES',
      'OBJECT_STORE_BYTES',
      'NOTIFICATION_RATE',
      'MODEL_TOKENS_BYOK',
    ]);
  });
});

describe('CostMode exact PRD specification', () => {
  it('contains STRICT_FREE and PAID_ENABLED', () => {
    expect(ALL_COST_MODES).toEqual(['STRICT_FREE', 'PAID_ENABLED']);
  });
});
