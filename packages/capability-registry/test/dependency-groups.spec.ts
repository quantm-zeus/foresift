/**
 * §40 dependency-group ordering suite (T049, FR-PROD-003/005, AC-152).
 *
 * PGlite hooks carry explicit 120s timeouts (the full `prod` migration set is
 * applied per file). The suite pins the manifest-authoritative prerequisite set
 * (audit H9): a caller can never narrow it away to mark a later group COMPLETE
 * while its prerequisites are still open.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import {
  DependencyGroupStatus,
  assertDependencyGateOpen,
  dependencyGatePrematureFinding,
  dependencyGroupStatuses,
  loadDependencyGroupOrderView,
  upsertDependencyGroupStatus,
} from '../src/index.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

const NOW = '2026-06-01T00:00:00Z';
const GROUPS = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const;

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

describe('§40 dependency-group ordering (FR-PROD-003)', () => {
  it('builds the ordering view from the authoritative manifest, not from callers', async () => {
    const view = await loadDependencyGroupOrderView();
    expect(view.groups.map((group) => group.groupId)).toEqual([...GROUPS]);
    expect(view.groups.find((group) => group.groupId === 'G7')?.dependsOn).toEqual([
      'G0',
      'G1',
      'G2',
      'G3',
      'G4',
      'G5',
      'G6',
    ]);
    expect(view.activatesOpportunities).toBe(false);
  });

  it('refuses the dependsOn: [] bypass for a later group (H9 exploit)', async () => {
    // The pre-fix bypass: the premature gate ran against the CALLER's
    // prerequisite list, so an empty list let G7 complete while G0…G6 were open.
    const bypass = await rejection(
      upsertDependencyGroupStatus(engine, {
        groupId: 'G7',
        dependsOn: [],
        status: DependencyGroupStatus.COMPLETE,
        manifestRequirementCount: 43,
        at: NOW,
      }),
    );
    expect(bypass.code).toBe('PROD_DEPENDENCY_ORDER_VIOLATED');

    const rows = await dependencyGroupStatuses(engine);
    expect(rows.some((row) => row.groupId === 'G7')).toBe(false);
  });

  it('refuses an honest prerequisite claim while an earlier group is open, then completes in order', async () => {
    const premature = await rejection(
      assertDependencyGateOpen(engine, {
        groupId: 'G2',
        dependsOn: ['G0', 'G1'],
      }),
    );
    expect(premature.code).toBe('PROD_DEPENDENCY_ORDER_VIOLATED');

    const prematureWrite = await rejection(
      upsertDependencyGroupStatus(engine, {
        groupId: 'G2',
        dependsOn: ['G0', 'G1'],
        status: DependencyGroupStatus.COMPLETE,
        manifestRequirementCount: 26,
        at: NOW,
      }),
    );
    expect(prematureWrite.code).toBe('PROD_DEPENDENCY_ORDER_VIOLATED');

    // Complete G0 then G1 (each only after its own prerequisites are COMPLETE)…
    await upsertDependencyGroupStatus(engine, {
      groupId: 'G0',
      dependsOn: [],
      status: DependencyGroupStatus.COMPLETE,
      manifestRequirementCount: 79,
      at: NOW,
    });
    const g1StillPremature = await rejection(
      upsertDependencyGroupStatus(engine, {
        groupId: 'G2',
        dependsOn: ['G0', 'G1'],
        status: DependencyGroupStatus.COMPLETE,
        manifestRequirementCount: 26,
        at: NOW,
      }),
    );
    expect(g1StillPremature.code).toBe('PROD_DEPENDENCY_ORDER_VIOLATED');

    await upsertDependencyGroupStatus(engine, {
      groupId: 'G1',
      dependsOn: ['G0'],
      status: DependencyGroupStatus.COMPLETE,
      manifestRequirementCount: 98,
      at: NOW,
    });
    const g2 = await upsertDependencyGroupStatus(engine, {
      groupId: 'G2',
      dependsOn: ['G0', 'G1'],
      status: DependencyGroupStatus.COMPLETE,
      manifestRequirementCount: 26,
      at: NOW,
    });
    expect(g2.status).toBe('COMPLETE');
    // §40 separation: build/test completion never activates opportunities.
    expect(g2.activatesOpportunities).toBe(false);

    // A group that already exists stays refused when a prerequisite claim
    // disagrees, however it is spelled.
    const narrowed = await rejection(
      upsertDependencyGroupStatus(engine, {
        groupId: 'G2',
        dependsOn: ['G0'],
        status: DependencyGroupStatus.OPEN,
        manifestRequirementCount: 26,
        at: NOW,
      }),
    );
    expect(narrowed.code).toBe('PROD_DEPENDENCY_ORDER_VIOLATED');
    // An equivalent spelling (order and duplicates) is accepted: the claim is
    // compared as a SET against the manifest.
    const respelled = await upsertDependencyGroupStatus(engine, {
      groupId: 'G2',
      dependsOn: ['G1', 'G0', 'G0'],
      status: DependencyGroupStatus.OPEN,
      manifestRequirementCount: 26,
      at: NOW,
    });
    expect(respelled.status).toBe('OPEN');
  }, 120_000);

  it('reuses the shared premature rule name rather than a private vocabulary', () => {
    const finding = dependencyGatePrematureFinding(
      { groupId: 'G7', dependsOn: ['G0'] },
      new Map([['G0', DependencyGroupStatus.OPEN]]),
    );
    expect(finding?.rule).toBe('DEPENDENCY_GATE_NOT_OPEN');
    expect(finding?.path).toBe('G7');
  });
});
