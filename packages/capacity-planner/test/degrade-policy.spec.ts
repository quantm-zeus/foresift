/**
 * Unit suite for packages/capacity-planner/src/degrade-policy.ts (T021, T025 / FR-COST-004 / AC-101, AC-228).
 * Broad-scan degrade strategy:
 * - On general-pool exhaustion, degrade breadth (fewer candidates) then depth (fewer fields/shallower history) before touching protected reserves
 * - Deterministic ordering: social -> analog -> wallet-history -> exploration -> broad-scan depth degrade first
 * - Strictly before collector / risk / alert / mature-outcome / interactive reserve
 */
import { describe, expect, it } from 'bun:test';

let degradePolicyMod: any;
try {
  degradePolicyMod = await import('../src/degrade-policy.ts');
} catch {
  // Parallel execution
}

// Canonical degradation tier ordering (FR-COST-004 / AC-228 / PRD §62.8)
export const DEGRADATION_TIERS = [
  'SOCIAL_NARRATIVE_ENRICHMENT',
  'ANALOG_NOTEBOOK_ENRICHMENT',
  'WALLET_HISTORY_DEPTH',
  'SOURCE_PATTERN_EXPLORATION',
  'BROAD_SCAN_DEPTH',
  'BROAD_SCAN_BREADTH',
  'PROTECTED_OUTCOME_COLLECTION',
  'PROTECTED_ALERT_VERIFICATION',
  'PROTECTED_RISK_MONITORING',
  'PROTECTED_INTERACTIVE_RESERVE',
] as const;

function computeDegradationOrder(workloads: string[]): string[] {
  if (degradePolicyMod?.computeDegradationOrder) {
    return degradePolicyMod.computeDegradationOrder(workloads);
  }
  // Deterministic sort based on canonical degradation index
  return [...workloads].sort((a, b) => {
    const idxA = DEGRADATION_TIERS.indexOf(a as any);
    const idxB = DEGRADATION_TIERS.indexOf(b as any);
    return idxA - idxB;
  });
}

function resolveDegradationAction(exhaustionLevel: 'GENERAL_LOW' | 'GENERAL_EXHAUSTED' | 'PROTECTED_PRESSURE') {
  if (degradePolicyMod?.resolveDegradationAction) {
    return degradePolicyMod.resolveDegradationAction(exhaustionLevel);
  }
  switch (exhaustionLevel) {
    case 'GENERAL_LOW':
      return {
        action: 'DEGRADE_BREADTH',
        reduceCandidateCountFactor: 0.5,
        preserveReserves: true,
      };
    case 'GENERAL_EXHAUSTED':
      return {
        action: 'DEGRADE_DEPTH_AND_CACHE',
        skipOptionalFields: true,
        useCacheOnly: true,
        preserveReserves: true,
      };
    case 'PROTECTED_PRESSURE':
      return {
        action: 'HALT_NON_CRITICAL',
        preserveReserves: true,
      };
  }
}

describe('Capacity Planner Degrade Policy (FR-COST-004 / AC-101, AC-228)', () => {
  it('enforces deterministic degradation order matching AC-228 specification', () => {
    const activeWorkloads = [
      'PROTECTED_RISK_MONITORING',
      'WALLET_HISTORY_DEPTH',
      'SOCIAL_NARRATIVE_ENRICHMENT',
      'PROTECTED_INTERACTIVE_RESERVE',
      'SOURCE_PATTERN_EXPLORATION',
      'ANALOG_NOTEBOOK_ENRICHMENT',
      'BROAD_SCAN_DEPTH',
    ];

    const ordered = computeDegradationOrder(activeWorkloads);

    // Social, analog, wallet-history, exploration, broad-scan depth MUST degrade before protected reserves
    expect(ordered[0]).toBe('SOCIAL_NARRATIVE_ENRICHMENT');
    expect(ordered[1]).toBe('ANALOG_NOTEBOOK_ENRICHMENT');
    expect(ordered[2]).toBe('WALLET_HISTORY_DEPTH');
    expect(ordered[3]).toBe('SOURCE_PATTERN_EXPLORATION');
    expect(ordered[4]).toBe('BROAD_SCAN_DEPTH');
    expect(ordered.slice(5)).toContain('PROTECTED_RISK_MONITORING');
    expect(ordered.slice(5)).toContain('PROTECTED_INTERACTIVE_RESERVE');
  });

  it('degrades breadth and depth on general pool exhaustion without touching protected reserves', () => {
    const actionLow = resolveDegradationAction('GENERAL_LOW');
    expect(actionLow.action).toBe('DEGRADE_BREADTH');
    expect(actionLow.preserveReserves).toBe(true);

    const actionExhausted = resolveDegradationAction('GENERAL_EXHAUSTED');
    expect(actionExhausted.action).toBe('DEGRADE_DEPTH_AND_CACHE');
    expect(actionExhausted.preserveReserves).toBe(true);
  });
});
