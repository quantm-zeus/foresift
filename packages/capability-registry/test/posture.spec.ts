/**
 * Deployment-posture unit suite (T021, FR-PROD-004, AC-153).
 *
 * PGlite hooks carry explicit 120s timeouts (the full `prod` migration set is
 * applied per file).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PROTECTED_DIMENSIONS } from '@foresift/domain';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  assertBestEffortPreservesProtectedDimensions,
  assertCapacityContractBacksPosture,
  assertCapacityDegradationPreservesProtectedDimensions,
  declareBestEffortPosture,
  degradeForCapacityPressure,
  evaluateDeploymentPosture,
  registerCriticalDependency,
  recordSla,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const NOW = '2026-06-01T00:00:00Z';
const FUTURE = '2027-06-01T00:00:00Z';
const PAST = '2025-01-01T00:00:00Z';

let db: PGlite;
let engine: DatabaseEngine;

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
}, 180_000);

afterAll(async () => {
  await db.close();
});

async function rejection(work: Promise<unknown>): Promise<{ code?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string };
  }
  throw new Error('expected a typed refusal, but the operation succeeded');
}

describe('§69.6 critical-dependency SLA evaluation', () => {
  it('yields SLA_BACKED only when every critical dependency has an applicable unexpired SLA', async () => {
    await registerCriticalDependency(engine, {
      dependencyId: 'dep-a',
      kind: 'PROVIDER',
      owner: 'ops',
    });
    await registerCriticalDependency(engine, {
      dependencyId: 'dep-b',
      kind: 'DATABASE',
      owner: 'ops',
    });
    await recordSla(engine, {
      slaId: 'sla-a',
      dependencyId: 'dep-a',
      applicable: true,
      slaRef: 'contract-a',
      verifiedAt: PAST,
      expiresAt: FUTURE,
    });
    await recordSla(engine, {
      slaId: 'sla-b',
      dependencyId: 'dep-b',
      applicable: true,
      slaRef: 'contract-b',
      verifiedAt: PAST,
      expiresAt: FUTURE,
    });

    const posture = await evaluateDeploymentPosture(engine, { now: NOW });
    expect(posture.posture).toBe('SLA_BACKED');
    expect(posture.missingSlaRefs).toEqual([]);
    expect(posture.criticalDependencyIds).toContain('dep-a');
    expect(posture.protectedDimensions).toEqual([...ALL_PROTECTED_DIMENSIONS]);
  }, 120_000);

  it('declares FREE_TIER_BEST_EFFORT with an explicit degraded scope for missing/expired/non-applicable SLAs', async () => {
    await registerCriticalDependency(engine, {
      dependencyId: 'dep-missing',
      kind: 'PROVIDER',
      owner: 'ops',
    });
    await registerCriticalDependency(engine, {
      dependencyId: 'dep-expired',
      kind: 'SCHEDULER',
      owner: 'ops',
    });
    await registerCriticalDependency(engine, {
      dependencyId: 'dep-nonapplicable',
      kind: 'OBJECT_STORE',
      owner: 'ops',
    });
    await recordSla(engine, {
      slaId: 'sla-expired',
      dependencyId: 'dep-expired',
      applicable: true,
      slaRef: 'contract-expired',
      verifiedAt: PAST,
      expiresAt: '2026-01-01T00:00:00Z',
    });
    await recordSla(engine, {
      slaId: 'sla-none',
      dependencyId: 'dep-nonapplicable',
      applicable: false,
      slaRef: null,
      verifiedAt: PAST,
      expiresAt: null,
    });

    const posture = await evaluateDeploymentPosture(engine, { now: NOW });
    expect(posture.posture).toBe('FREE_TIER_BEST_EFFORT');
    expect(posture.missingSlaRefs).toEqual(
      expect.arrayContaining(['dep-missing', 'dep-expired', 'dep-nonapplicable']),
    );
    expect(posture.degradedScope['degraded']).toBe('FREE_TIER_EXTERNAL_DEPENDENCIES');
    expect(posture.reason).toMatch(/best-effort free-tier posture/);

    await declareBestEffortPosture(engine, {
      declarationId: 'declaration-best-effort',
      posture: 'FREE_TIER_BEST_EFFORT',
      degradedScope: posture.degradedScope,
      missingSlaRefs: posture.missingSlaRefs,
      weakenedDimensions: ['freshness', 'breadth', 'depth', 'alert_availability'],
      protectedDimensions: [...ALL_PROTECTED_DIMENSIONS],
      reason: posture.reason,
      at: NOW,
    });
    const rows = await engine.query<{ posture: string; missing_sla_refs: unknown }>(
      `SELECT posture, missing_sla_refs FROM prod.best_effort_declarations
        WHERE declaration_id = 'declaration-best-effort'`,
    );
    expect(rows.rows[0]?.posture).toBe('FREE_TIER_BEST_EFFORT');
  }, 120_000);
});

describe('AC-153 protected-dimension law', () => {
  it('refuses a declaration weakening any protected dimension', () => {
    for (const dimension of ALL_PROTECTED_DIMENSIONS) {
      expect(() =>
        assertBestEffortPreservesProtectedDimensions({
          posture: 'FREE_TIER_BEST_EFFORT',
          weakenedDimensions: [dimension],
          protectedDimensions: [...ALL_PROTECTED_DIMENSIONS],
        }),
      ).toThrow();
    }
    expect(() =>
      assertBestEffortPreservesProtectedDimensions({
        posture: 'FREE_TIER_BEST_EFFORT',
        weakenedDimensions: ['not_a_dimension'],
        protectedDimensions: [...ALL_PROTECTED_DIMENSIONS],
      }),
    ).toThrow();
    expect(() =>
      assertBestEffortPreservesProtectedDimensions({
        posture: 'FREE_TIER_BEST_EFFORT',
        weakenedDimensions: ['freshness'],
        protectedDimensions: ['identity'],
      }),
    ).toThrow();
    expect(() =>
      assertBestEffortPreservesProtectedDimensions({
        posture: 'SLA_BACKED',
        weakenedDimensions: ['freshness'],
        protectedDimensions: [...ALL_PROTECTED_DIMENSIONS],
      }),
    ).toThrow();
  }, 120_000);

  it('refuses the weakening at the SQL level as well', async () => {
    const weakened = await rejection(
      engine.query(
        `INSERT INTO prod.best_effort_declarations
           (declaration_id, posture, degraded_scope, missing_sla_refs, weakened_dimensions,
            protected_dimensions, reason)
         VALUES ('declaration-sql-weakening', 'FREE_TIER_BEST_EFFORT', '{}'::jsonb, '[]'::jsonb,
                 ARRAY['audit']::text[], $1::text[], 'weaken audit')`,
        [[...ALL_PROTECTED_DIMENSIONS]],
      ),
    );
    expect(weakened.code).toBe('23514');
  }, 120_000);
});

describe('capacity/quota degradation preserves protected dimensions', () => {
  it('maps capacity pressure onto relaxable dimensions only', () => {
    const breadth = degradeForCapacityPressure({ breadthReduced: false });
    expect(breadth.step).toBe('REDUCE_BREADTH');
    expect(breadth.relaxedDimensions).toEqual(['breadth']);
    expect(breadth.posture).toBe('FREE_TIER_BEST_EFFORT');

    const depth = degradeForCapacityPressure({ breadthReduced: true, depthReduced: false });
    expect(depth.step).toBe('REDUCE_DEPTH');
    expect(depth.relaxedDimensions).toEqual(['depth']);

    const cache = degradeForCapacityPressure({
      breadthReduced: true,
      depthReduced: true,
      cacheAvailable: true,
    });
    expect(cache.step).toBe('RETURN_CACHE');
    expect(cache.relaxedDimensions).toEqual(['freshness']);

    const skip = degradeForCapacityPressure({ breadthReduced: true, depthReduced: true });
    expect(skip.step).toBe('SKIP_LOW_PRIORITY');
    expect(skip.relaxedDimensions).toEqual(['alert_availability']);
  }, 120_000);

  it('asserts integrity, audit, duplicate prevention, capacity, and risk monitoring survive', () => {
    // The declaration's protected set keeps every mandatory dimension.
    const relaxed = degradeForCapacityPressure({ breadthReduced: false });
    for (const dimension of [
      'identity',
      'point_in_time',
      'audit',
      'duplicate_prevention',
      'security',
      'execution_semantics',
      'capacity',
      'critical_risk_monitoring',
      'claim_boundaries',
    ] as const) {
      expect(relaxed.protectedDimensions).toContain(dimension);
    }
    expect(() =>
      assertCapacityDegradationPreservesProtectedDimensions([
        'breadth',
        'depth',
        'alert_availability',
      ]),
    ).not.toThrow();
    expect(() => assertCapacityDegradationPreservesProtectedDimensions(['audit'])).toThrow();
    expect(() => assertCapacityDegradationPreservesProtectedDimensions(['capacity'])).toThrow();
    expect(() => assertCapacityContractBacksPosture(null)).toThrow();
  }, 120_000);
});
