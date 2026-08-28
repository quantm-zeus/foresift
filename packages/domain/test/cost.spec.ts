/**
 * §62 Free-first cost, quota, and sustainable capacity domain-vocabulary units
 * (FR-COST-001…010, FR-COST-011…016; PRD §38.13, §38.41, §62).
 *
 * Table-driven: every vocabulary resolves its full legal set, refuses
 * unknown strings with typed fail-closed codes, and enforces exact domain invariants.
 */
import { describe, expect, it } from 'bun:test';
import * as Domain from '../src/index.ts';

// Known vocabulary expectations per PRD §62 & §38.13
const EXPECTED_COST_CLASSES = [
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
] as const;

const EXPECTED_COST_MODES = ['STRICT_FREE', 'FREE_FIRST', 'PAID_ALLOWED'] as const;

const EXPECTED_RESERVE_BUCKET_IDS = [
  'RISK_MONITORING',
  'ALERT_VERIFICATION',
  'INTERACTIVE_MCP',
  'EMERGENCY_BACKFILL',
  'OUTCOME_COLLECTION',
  'SCHEDULED_CANDIDATE_VERIFICATION',
  'DEEP_RESEARCH',
  'FIRST_PARTY_COLLECTOR',
  'RANDOMIZED_EXPLORATION',
] as const;

const EXPECTED_RESOURCE_DIMENSIONS = [
  'SCHEDULER',
  'WORKFLOW',
  'DATABASE',
  'OBJECT_STORE',
  'NOTIFICATION',
  'MODEL_TOKENS_BYOK',
] as const;

const EXPECTED_PAID_POLICY_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED',
  'EXPIRED',
  'REVOKED',
] as const;

describe('Cost & Capacity domain vocabularies (FR-COST-001..010)', () => {
  it('declares the complete cost class vocabulary with stable spellings', () => {
    const all = (Domain as Record<string, unknown>).ALL_COST_CLASSES as readonly string[] | undefined;
    expect(all).toBeDefined();
    for (const c of EXPECTED_COST_CLASSES) {
      expect(all!).toContain(c);
    }
    expect(all!.length).toBe(EXPECTED_COST_CLASSES.length);
  });

  it('declares the complete cost mode vocabulary (STRICT_FREE, FREE_FIRST, PAID_ALLOWED)', () => {
    const all = (Domain as Record<string, unknown>).ALL_COST_MODES as readonly string[] | undefined;
    expect(all).toBeDefined();
    for (const m of EXPECTED_COST_MODES) {
      expect(all!).toContain(m);
    }
    expect(all!.length).toBe(EXPECTED_COST_MODES.length);
  });

  it('declares the complete protected reserve bucket vocabulary', () => {
    const all = (Domain as Record<string, unknown>).ALL_RESERVE_BUCKET_IDS as
      | readonly string[]
      | undefined;
    expect(all).toBeDefined();
    for (const r of EXPECTED_RESERVE_BUCKET_IDS) {
      expect(all!).toContain(r);
    }
    expect(all!.length).toBe(EXPECTED_RESERVE_BUCKET_IDS.length);
  });

  it('declares the complete 6-dimension resource budget vocabulary', () => {
    const all = (Domain as Record<string, unknown>).ALL_RESOURCE_BUDGET_DIMENSIONS as
      | readonly string[]
      | undefined;
    expect(all).toBeDefined();
    for (const d of EXPECTED_RESOURCE_DIMENSIONS) {
      expect(all!).toContain(d);
    }
    expect(all!.length).toBe(EXPECTED_RESOURCE_DIMENSIONS.length);
  });

  it('declares the complete paid provider policy lifecycle status vocabulary', () => {
    const all = (Domain as Record<string, unknown>).ALL_PAID_POLICY_STATUSES as
      | readonly string[]
      | undefined;
    expect(all).toBeDefined();
    for (const s of EXPECTED_PAID_POLICY_STATUSES) {
      expect(all!).toContain(s);
    }
    expect(all!.length).toBe(EXPECTED_PAID_POLICY_STATUSES.length);
  });
});

describe('Cost & Capacity domain parse helpers fail-closed', () => {
  it('costClass resolver accepts valid members and refuses unknown values', () => {
    const fn = (Domain as Record<string, unknown>).costClass as
      | ((s: string) => string)
      | undefined;
    expect(typeof fn).toBe('function');
    for (const c of EXPECTED_COST_CLASSES) {
      expect(fn!(c)).toBe(c);
    }
    expect(() => fn!('FREE_UNLIMITED')).toThrow();
    expect(() => fn!('')).toThrow();
    expect(() => fn!('paid')).toThrow();
  });

  it('costMode resolver accepts valid members and refuses unknown values', () => {
    const fn = (Domain as Record<string, unknown>).costMode as
      | ((s: string) => string)
      | undefined;
    expect(typeof fn).toBe('function');
    for (const m of EXPECTED_COST_MODES) {
      expect(fn!(m)).toBe(m);
    }
    expect(() => fn!('STRICT_PAID')).toThrow();
    expect(() => fn!('UNMETERED')).toThrow();
  });

  it('reserveBucketId resolver accepts valid members and refuses unknown values', () => {
    const fn = (Domain as Record<string, unknown>).reserveBucketId as
      | ((s: string) => string)
      | undefined;
    expect(typeof fn).toBe('function');
    for (const r of EXPECTED_RESERVE_BUCKET_IDS) {
      expect(fn!(r)).toBe(r);
    }
    expect(() => fn!('ARBITRARY_RESERVE')).toThrow();
    expect(() => fn!('GENERAL_POOL')).toThrow();
  });

  it('resourceBudgetDimension resolver accepts valid members and refuses unknown values', () => {
    const fn = (Domain as Record<string, unknown>).resourceBudgetDimension as
      | ((s: string) => string)
      | undefined;
    expect(typeof fn).toBe('function');
    for (const d of EXPECTED_RESOURCE_DIMENSIONS) {
      expect(fn!(d)).toBe(d);
    }
    expect(() => fn!('GPU_MEMORY')).toThrow();
    expect(() => fn!('LAMBDA_HOURS')).toThrow();
  });
});
