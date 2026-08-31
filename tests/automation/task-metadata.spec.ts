// Hyperdrive H3 P0/P1-5 — explicit task metadata + post-integration
// coordinator duties. Regressions:
//   - [executor: X] / [kind: Y] markers parse, validate, and fail closed on
//     unknown values; missing markers default to PRODUCT (legacy plans);
//   - COORDINATOR units are excluded from shards, test lanes, and writer
//     briefs, and are emitted as graph.coordinatorUnits;
//   - the body-string manifest matcher is gone (the classifier is metadata).
//   - wave-coordinator-duties.mjs: manifest regen → coverage assertion →
//     mechanical commit, all zero-AI, fail-closed on coverage misses.
import { describe, test, expect } from 'bun:test';
import {
  parseTaskMetadata,
  resolveTaskMetadata,
  isCoordinatorTask,
  TASK_EXECUTORS,
} from '../../scripts/automation/task-metadata.mjs';
import { unitsIndexFromGraph } from '../../scripts/automation/task-completion-evidence.mjs';

describe('task metadata parsing + fail-closed validation', () => {
  test('explicit markers parse to uppercased values', () => {
    const parsed = parseTaskMetadata(
      '- [ ] T063 [executor: COORDINATOR] [kind: MECHANICAL_BOOKKEEPING] Regenerate the manifest',
    );
    expect(parsed.executor).toBe('COORDINATOR');
    expect(parsed.kind).toBe('MECHANICAL_BOOKKEEPING');
  });

  test('unknown executor fails closed (TASK_EXECUTOR_UNKNOWN)', () => {
    expect(() => resolveTaskMetadata('- [ ] T001 [executor: WIZARD] do magic')).toThrow(
      /TASK_EXECUTOR_UNKNOWN/,
    );
    // A value with characters outside the marker charset never parses as a
    // marker at all — it is treated as an absent marker (legacy default), so
    // it cannot smuggle an unknown executor.
    expect(resolveTaskMetadata('- [ ] T001 [executor: Product2] x')).toEqual({
      executor: 'PRODUCT',
      kind: 'IMPLEMENTATION',
    });
  });

  test('unknown kind fails closed (TASK_KIND_UNKNOWN)', () => {
    expect(() => resolveTaskMetadata('- [ ] T001 [kind: VIBES] x')).toThrow(/TASK_KIND_UNKNOWN/);
  });

  test('MECHANICAL_BOOKKEEPING requires COORDINATOR executor and vice versa', () => {
    expect(() =>
      resolveTaskMetadata('- [ ] T001 [executor: PRODUCT] [kind: MECHANICAL_BOOKKEEPING] x'),
    ).toThrow(/TASK_KIND_INVALID_FOR_EXECUTOR/);
    expect(() =>
      resolveTaskMetadata('- [ ] T001 [executor: COORDINATOR] [kind: IMPLEMENTATION] x'),
    ).toThrow(/TASK_KIND_INVALID_FOR_COORDINATOR/);
  });

  test('legacy plans without markers default to PRODUCT/IMPLEMENTATION', () => {
    expect(resolveTaskMetadata('- [ ] T001 implement the thing')).toEqual({
      executor: 'PRODUCT',
      kind: 'IMPLEMENTATION',
    });
    expect(resolveTaskMetadata('- [ ] T002 [P] write tests')).toEqual({
      executor: 'PRODUCT',
      kind: 'IMPLEMENTATION',
    });
  });

  test('COORDINATOR normalizes kind; TEST derives TEST_AUTHORING; vocabulary is the contract', () => {
    expect(resolveTaskMetadata('- [ ] T063 [executor: COORDINATOR] manifest regen')).toEqual({
      executor: 'COORDINATOR',
      kind: 'MECHANICAL_BOOKKEEPING',
    });
    expect(resolveTaskMetadata('- [ ] T070 [executor: TEST] author suites')).toEqual({
      executor: 'TEST',
      kind: 'TEST_AUTHORING',
    });
    expect([...TASK_EXECUTORS]).toEqual(['PRODUCT', 'TEST', 'COORDINATOR']);
  });

  test('isCoordinatorTask reads the resolved executor field', () => {
    expect(isCoordinatorTask({ executor: 'COORDINATOR' })).toBe(true);
    expect(isCoordinatorTask({ executor: 'PRODUCT' })).toBe(false);
    expect(isCoordinatorTask(null)).toBe(false);
  });
});

describe('graph-level coordinator exclusion (units index view)', () => {
  test('a graph with coordinator metadata exposes zero-AI duties, writers carry executor fields', () => {
    const graph = {
      units: [
        { id: 'T001', executor: 'PRODUCT', kind: 'IMPLEMENTATION', predictedWrites: ['src/a.ts'] },
        {
          id: 'T063',
          executor: 'COORDINATOR',
          kind: 'MECHANICAL_BOOKKEEPING',
          predictedWrites: ['evidence/bun-migration/bun-migration-manifest.json'],
        },
        {
          id: 'T070',
          executor: 'TEST',
          kind: 'TEST_AUTHORING',
          predictedWrites: ['tests/a.spec.ts'],
        },
      ],
    };
    const idx = unitsIndexFromGraph(graph);
    expect(idx.get('T063')?.executor).toBe('COORDINATOR');
    expect(isCoordinatorTask(idx.get('T063'))).toBe(true);
    expect(isCoordinatorTask(idx.get('T001'))).toBe(false);
  });
});
