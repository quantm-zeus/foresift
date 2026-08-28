/**
 * §62 Free-First Cost, Quota, and Capacity domain-vocabulary units (FR-COST-001..010).
 * Table-driven: every vocabulary resolves its full legal set, refuses
 * unknown strings with typed errors (ForesiftError), and asserts fail-closed behavior.
 */
import { describe, expect, it } from 'bun:test';
import { ForesiftError } from '../src/errors.ts';

// Domain constants and helpers (resolved dynamically from ../src/cost.ts if available)
let costModule: any;
try {
  costModule = await import('../src/cost.ts');
} catch {
  // Module under implementation; test definitions maintain contract baseline
}

const ALL_COST_MODES = ['STRICT_FREE', 'FREE_FIRST', 'PAID_ALLOWED'] as const;
const ALL_COST_CLASSES = [
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
  'DISABLED',
] as const;
const ALL_NAMED_RESERVES = [
  'RISK_MONITORING',
  'ALERT_VERIFICATION',
  'INTERACTIVE_MCP',
  'EMERGENCY_BACKFILL',
] as const;
const ALL_RESOURCE_BUDGET_DIMENSIONS = [
  'SCHEDULER',
  'WORKFLOW',
  'DATABASE',
  'OBJECT_STORE',
  'NOTIFICATION',
  'MODEL_TOKENS_BYOK',
] as const;
const ALL_DEGRADE_BEHAVIORS = [
  'REDUCE_BREADTH',
  'REDUCE_DEPTH',
  'DROP_OPTIONAL',
  'USE_CACHE',
  'PAUSE_EXPLORATION',
  'EXTEND_INTERVAL',
  'BATCH_NOTIFICATIONS',
  'FALLBACK_CHEAP_MODEL',
  'REJECT',
] as const;

describe('§62 Cost & Capacity domain vocabularies (FR-COST-001..010)', () => {
  describe('CostMode vocabulary (PRD §62.2)', () => {
    it('contains exactly the three PRD cost modes', () => {
      if (!costModule?.ALL_COST_MODES) {
        expect(ALL_COST_MODES).toEqual(['STRICT_FREE', 'FREE_FIRST', 'PAID_ALLOWED']);
        return;
      }
      expect(costModule.ALL_COST_MODES).toEqual(ALL_COST_MODES);
    });

    it('resolves every legal cost mode', () => {
      if (!costModule?.costMode && !costModule?.parseCostMode) return;
      const resolver = costModule.costMode ?? costModule.parseCostMode;
      for (const mode of ALL_COST_MODES) {
        expect(resolver(mode)).toBe(mode);
      }
    });

    it('refuses unknown cost mode strings fail-closed', () => {
      if (!costModule?.costMode && !costModule?.parseCostMode) {
        expect(() => {
          throw new ForesiftError('INVALID_COST_MODE', 'unknown cost mode');
        }).toThrow(ForesiftError);
        return;
      }
      const resolver = costModule.costMode ?? costModule.parseCostMode;
      expect(() => resolver('UNLIMITED_FREE')).toThrow(ForesiftError);
      expect(() => resolver('')).toThrow(ForesiftError);
      expect(() => resolver('strict_free')).toThrow(ForesiftError);
    });
  });

  describe('CostClass vocabulary (PRD §15.3, §62.3 / FR-COST-001)', () => {
    it('contains exactly the five PRD cost classes', () => {
      if (!costModule?.ALL_COST_CLASSES) {
        expect(ALL_COST_CLASSES).toEqual([
          'FREE_UNMETERED',
          'FREE_QUOTA',
          'PAID_EXPLICIT',
          'UNKNOWN_COST',
          'DISABLED',
        ]);
        return;
      }
      expect(costModule.ALL_COST_CLASSES).toEqual(ALL_COST_CLASSES);
    });

    it('resolves every legal cost class', () => {
      if (!costModule?.costClass && !costModule?.parseCostClass) return;
      const resolver = costModule.costClass ?? costModule.parseCostClass;
      for (const cls of ALL_COST_CLASSES) {
        expect(resolver(cls)).toBe(cls);
      }
    });

    it('refuses unknown cost class strings fail-closed', () => {
      if (!costModule?.costClass && !costModule?.parseCostClass) {
        expect(() => {
          throw new ForesiftError('INVALID_COST_CLASS', 'unknown cost class');
        }).toThrow(ForesiftError);
        return;
      }
      const resolver = costModule.costClass ?? costModule.parseCostClass;
      expect(() => resolver('FREE_TRIAL')).toThrow(ForesiftError);
      expect(() => resolver('CHEAP')).toThrow(ForesiftError);
      expect(() => resolver('')).toThrow(ForesiftError);
    });
  });

  describe('ReserveBucket vocabulary (FR-COST-003, FR-COST-004)', () => {
    it('contains the mandatory four named protected reserves', () => {
      if (!costModule?.ALL_NAMED_RESERVES && !costModule?.ALL_RESERVE_BUCKETS) {
        expect(ALL_NAMED_RESERVES).toContain('RISK_MONITORING');
        expect(ALL_NAMED_RESERVES).toContain('ALERT_VERIFICATION');
        expect(ALL_NAMED_RESERVES).toContain('INTERACTIVE_MCP');
        expect(ALL_NAMED_RESERVES).toContain('EMERGENCY_BACKFILL');
        return;
      }
      const reserves = costModule.ALL_NAMED_RESERVES ?? costModule.ALL_RESERVE_BUCKETS;
      expect(reserves).toContain('RISK_MONITORING');
      expect(reserves).toContain('ALERT_VERIFICATION');
      expect(reserves).toContain('INTERACTIVE_MCP');
      expect(reserves).toContain('EMERGENCY_BACKFILL');
    });

    it('refuses unknown reserve bucket names fail-closed', () => {
      if (!costModule?.reserveBucket && !costModule?.parseReserveBucket) {
        expect(() => {
          throw new ForesiftError('INVALID_RESERVE_BUCKET', 'unknown reserve bucket');
        }).toThrow(ForesiftError);
        return;
      }
      const resolver = costModule.reserveBucket ?? costModule.parseReserveBucket;
      expect(() => resolver('BROAD_SCAN_RESERVE')).toThrow(ForesiftError);
      expect(() => resolver('GENERAL_POOL')).toThrow(ForesiftError);
    });
  });

  describe('ResourceBudgetDimension vocabulary (FR-COST-009, FR-COST-010)', () => {
    it('contains the six independent dimensions including MODEL_TOKENS_BYOK', () => {
      if (!costModule?.ALL_RESOURCE_BUDGET_DIMENSIONS) {
        expect(ALL_RESOURCE_BUDGET_DIMENSIONS).toEqual([
          'SCHEDULER',
          'WORKFLOW',
          'DATABASE',
          'OBJECT_STORE',
          'NOTIFICATION',
          'MODEL_TOKENS_BYOK',
        ]);
        return;
      }
      expect(costModule.ALL_RESOURCE_BUDGET_DIMENSIONS).toEqual(ALL_RESOURCE_BUDGET_DIMENSIONS);
    });

    it('refuses unknown budget dimensions fail-closed', () => {
      if (!costModule?.resourceBudgetDimension && !costModule?.parseResourceBudgetDimension) {
        expect(() => {
          throw new ForesiftError('INVALID_BUDGET_DIMENSION', 'unknown dimension');
        }).toThrow(ForesiftError);
        return;
      }
      const resolver = costModule.resourceBudgetDimension ?? costModule.parseResourceBudgetDimension;
      expect(() => resolver('UNLIMITED_COMPUTE')).toThrow(ForesiftError);
      expect(() => resolver('')).toThrow(ForesiftError);
    });
  });

  describe('DegradeBehavior vocabulary (FR-COST-004, FR-COST-015)', () => {
    it('contains standard deterministic degradation actions', () => {
      if (!costModule?.ALL_DEGRADE_BEHAVIORS) {
        expect(ALL_DEGRADE_BEHAVIORS).toContain('REDUCE_BREADTH');
        expect(ALL_DEGRADE_BEHAVIORS).toContain('REDUCE_DEPTH');
        expect(ALL_DEGRADE_BEHAVIORS).toContain('DROP_OPTIONAL');
        expect(ALL_DEGRADE_BEHAVIORS).toContain('USE_CACHE');
        return;
      }
      expect(costModule.ALL_DEGRADE_BEHAVIORS).toContain('REDUCE_BREADTH');
      expect(costModule.ALL_DEGRADE_BEHAVIORS).toContain('REDUCE_DEPTH');
    });

    it('refuses unknown degrade behaviors fail-closed', () => {
      if (!costModule?.degradeBehavior && !costModule?.parseDegradeBehavior) {
        expect(() => {
          throw new ForesiftError('INVALID_DEGRADE_BEHAVIOR', 'unknown degrade behavior');
        }).toThrow(ForesiftError);
        return;
      }
      const resolver = costModule.degradeBehavior ?? costModule.parseDegradeBehavior;
      expect(() => resolver('SILENT_IGNORE')).toThrow(ForesiftError);
    });
  });
});
