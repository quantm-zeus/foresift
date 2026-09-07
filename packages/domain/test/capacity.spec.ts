/**
 * Capacity domain vocabulary unit tests (FR-COST-011, FR-COST-013, FR-COST-015, FR-COST-016, FR-COST-017).
 * Tests fail-closed resolution for BudgetDimension, ProviderMode, ReserveClass,
 * DegradationStep, ContractResult, ReconciliationDimension, ReconciliationBreachKind,
 * AttributionUnitKind, and RenderedSpendClass, as well as G0 ReserveId interop.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALL_ATTRIBUTION_UNIT_KINDS,
  ALL_BUDGET_DIMENSIONS,
  ALL_CONTRACT_RESULTS,
  ALL_DEGRADATION_STEPS,
  ALL_PROVIDER_MODES,
  ALL_RECONCILIATION_BREACH_KINDS,
  ALL_RECONCILIATION_DIMENSIONS,
  ALL_RENDERED_SPEND_CLASSES,
  ALL_RESERVE_CLASSES,
  AttributionUnitKind,
  attributionUnitKind,
  BudgetDimension,
  budgetDimension,
  ContractResult,
  contractResult,
  DegradationStep,
  degradationStep,
  ProviderMode,
  providerMode,
  ReconciliationBreachKind,
  reconciliationBreachKind,
  ReconciliationDimension,
  reconciliationDimension,
  RenderedSpendClass,
  renderedSpendClass,
  ReserveClass,
  reserveClass,
} from '../src/capacity.ts';
import { ALL_RESERVE_IDS, reserveId } from '../src/cost.ts';
import { ForesiftError } from '../src/errors.ts';

const CAPACITY_VOCABULARIES = [
  ['budgetDimension', budgetDimension, ALL_BUDGET_DIMENSIONS],
  ['providerMode', providerMode, ALL_PROVIDER_MODES],
  ['reserveClass', reserveClass, ALL_RESERVE_CLASSES],
  ['degradationStep', degradationStep, ALL_DEGRADATION_STEPS],
  ['contractResult', contractResult, ALL_CONTRACT_RESULTS],
  ['reconciliationDimension', reconciliationDimension, ALL_RECONCILIATION_DIMENSIONS],
  ['reconciliationBreachKind', reconciliationBreachKind, ALL_RECONCILIATION_BREACH_KINDS],
  ['attributionUnitKind', attributionUnitKind, ALL_ATTRIBUTION_UNIT_KINDS],
  ['renderedSpendClass', renderedSpendClass, ALL_RENDERED_SPEND_CLASSES],
] as const;

describe('capacity domain vocabulary resolution (fail-closed)', () => {
  it.each(CAPACITY_VOCABULARIES)(
    '%s resolves every member of its exact PRD vocabulary',
    (_name, resolve, all) => {
      for (const value of all) {
        expect(resolve(value)).toBe(value);
      }
    },
  );

  it.each(CAPACITY_VOCABULARIES)(
    '%s refuses unknown values fail-closed with ForesiftError',
    (_name, resolve, all) => {
      expect(() => resolve('TOTALLY_UNKNOWN_VALUE')).toThrow(ForesiftError);
      expect(() => resolve('')).toThrow(ForesiftError);
      for (const value of all) {
        const drifted = value.toLowerCase();
        if (!all.includes(drifted as never)) {
          expect(() => resolve(drifted)).toThrow(ForesiftError);
        }
      }
    },
  );
});

describe('BudgetDimension exact PRD §62.2 specification (FR-COST-011)', () => {
  it('contains exactly the 6 budget dimension literals', () => {
    expect(ALL_BUDGET_DIMENSIONS).toEqual([
      'DATA_PROVIDER',
      'MODEL',
      'COMPUTE_WORKFLOW',
      'DATABASE_STORAGE',
      'OBJECT_STORAGE_EGRESS',
      'NOTIFICATION',
    ]);
  });
});

describe('ProviderMode exact PRD §62.2 specification', () => {
  it('contains exactly the 3 data-provider modes', () => {
    expect(ALL_PROVIDER_MODES).toEqual([
      'STRICT_FREE',
      'FREE_FIRST',
      'PAID_ALLOWED',
    ]);
  });
});

describe('ReserveClass exact PRD §62.4 specification (FR-COST-013, ADR-2)', () => {
  it('contains exactly the 9 reserve classes', () => {
    expect(ALL_RESERVE_CLASSES).toEqual([
      'RISK_MONITORING',
      'ALERT_VERIFICATION',
      'INTERACTIVE_MCP',
      'EMERGENCY_BACKFILL',
      'OUTCOME_COLLECTION',
      'SCHEDULED_CANDIDATE_VERIFICATION',
      'DEEP_RESEARCH',
      'FIRST_PARTY_COLLECTOR',
      'EXPLORATION_PROBES',
    ]);
  });

  it('maintains interop with G0 ReserveId (all 4 legacy members parse through both vocabularies)', () => {
    for (const legacyId of ALL_RESERVE_IDS) {
      expect(ALL_RESERVE_CLASSES).toContain(legacyId as never);
      expect(reserveClass(legacyId)).toBe(legacyId as never);
      expect(reserveId(legacyId)).toBe(legacyId);
    }
  });
});

describe('DegradationStep exact PRD §62.8 specification (FR-COST-015)', () => {
  it('contains exactly the 11 degradation step literals in canonical order', () => {
    expect(ALL_DEGRADATION_STEPS).toEqual([
      'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
      'REDUCE_SOCIAL_NARRATIVE_DEPTH',
      'REDUCE_WALLET_HISTORY_DEPTH',
      'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT',
      'EXTEND_LOW_PRIORITY_RECHECK_INTERVAL',
      'REDUCE_CHEAP_MONITOR_BREADTH',
      'PAUSE_EXPLORATION_ABOVE_PROTECTED_FLOOR',
      'USE_ACCEPTABLE_CACHE_FOR_MANUAL_NON_ALERT',
      'STOP_NEW_OPPORTUNITY_RESEARCH',
      'PRESERVE_CRITICAL_OBLIGATIONS',
      'RETURN_PARTIAL_INSUFFICIENT_DATA',
    ]);
  });
});

describe('ContractResult specification (FR-COST-012)', () => {
  it('contains exactly PASS, FAIL, UNVERIFIED', () => {
    expect(ALL_CONTRACT_RESULTS).toEqual(['PASS', 'FAIL', 'UNVERIFIED']);
  });
});

describe('ReconciliationDimension exact PRD §62.9 specification (FR-COST-016)', () => {
  it('contains exactly the 5 reconciliation dimensions', () => {
    expect(ALL_RECONCILIATION_DIMENSIONS).toEqual([
      'OPERATION',
      'WORKLOAD',
      'CANDIDATE',
      'RUN',
      'MODULE',
    ]);
  });
});

describe('ReconciliationBreachKind specification (FR-COST-016, ADR-6)', () => {
  it('contains MATERIAL_UNDERESTIMATION and RESERVE_BREACH', () => {
    expect(ALL_RECONCILIATION_BREACH_KINDS).toEqual([
      'MATERIAL_UNDERESTIMATION',
      'RESERVE_BREACH',
    ]);
  });
});

describe('AttributionUnitKind exact PRD §62.9 specification (FR-COST-017)', () => {
  it('contains exactly the 5 attribution unit kinds', () => {
    expect(ALL_ATTRIBUTION_UNIT_KINDS).toEqual([
      'RESEARCHED_CANDIDATE',
      'MATURE_OUTCOME',
      'USEFUL_ALERT',
      'PREVENTED_RISK_EVENT',
      'PORTFOLIO_UTILITY_UNIT',
    ]);
  });
});

describe('RenderedSpendClass exact PRD §62.12 specification (FR-COST-011, FR-COST-017)', () => {
  it('contains exactly the 7 rendered spend classes', () => {
    expect(ALL_RENDERED_SPEND_CLASSES).toEqual([
      'PAID_DATA_SPEND',
      'FREE_QUOTA_CONSUMPTION',
      'MODEL_SPEND',
      'INFRASTRUCTURE_SPEND',
      'STORAGE_EGRESS_SPEND',
      'NOTIFICATION_SPEND',
      'HUMAN_REVIEW_EFFORT',
    ]);
  });
});
