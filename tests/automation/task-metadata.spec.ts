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
  TASK_EVIDENCE_KINDS,
  parseTaskMetadata,
  resolveTaskMetadata,
  resolveBlockEvidence,
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
      evidence: 'FILE_OUTPUT',
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
      evidence: 'FILE_OUTPUT',
    });
    expect(resolveTaskMetadata('- [ ] T002 [P] write tests')).toEqual({
      executor: 'PRODUCT',
      kind: 'IMPLEMENTATION',
      evidence: 'FILE_OUTPUT',
    });
  });

  test('COORDINATOR normalizes kind; TEST derives TEST_AUTHORING; vocabulary is the contract', () => {
    expect(resolveTaskMetadata('- [ ] T063 [executor: COORDINATOR] manifest regen')).toEqual({
      executor: 'COORDINATOR',
      kind: 'MECHANICAL_BOOKKEEPING',
      evidence: 'FILE_OUTPUT',
    });
    expect(resolveTaskMetadata('- [ ] T070 [executor: TEST] author suites')).toEqual({
      executor: 'TEST',
      kind: 'TEST_AUTHORING',
      evidence: 'FILE_OUTPUT',
    });
    expect([...TASK_EXECUTORS]).toEqual(['PRODUCT', 'TEST', 'COORDINATOR']);
  });

  test('isCoordinatorTask reads the resolved executor field', () => {
    expect(isCoordinatorTask({ executor: 'COORDINATOR' })).toBe(true);
    expect(isCoordinatorTask({ executor: 'PRODUCT' })).toBe(false);
    expect(isCoordinatorTask(null)).toBe(false);
  });

  test('evidence kinds: unknown fails closed; COORDINATOR_ARTIFACT needs COORDINATOR; default is FILE_OUTPUT', () => {
    // Unknown evidence vocabulary is a hard graph-build error, never silent.
    expect(() => resolveTaskMetadata('- [ ] T001 [evidence: VIBES] x')).toThrow(
      /TASK_EVIDENCE_UNKNOWN/,
    );
    // COORDINATOR_ARTIFACT is coordinator-only.
    expect(() =>
      resolveTaskMetadata('- [ ] T001 [executor: PRODUCT] [evidence: COORDINATOR_ARTIFACT] x'),
    ).toThrow(/TASK_EVIDENCE_INVALID_FOR_EXECUTOR/);
    expect(
      resolveTaskMetadata(
        '- [ ] T063 [executor: COORDINATOR] [evidence: COORDINATOR_ARTIFACT] regen',
      ).evidence,
    ).toBe('COORDINATOR_ARTIFACT');
    // Non-file kinds parse for AI executors too (proof routed by the owner).
    expect(
      resolveTaskMetadata('- [ ] T016 [evidence: VERIFICATION_ONLY] run the gate').evidence,
    ).toBe('VERIFICATION_ONLY');
    // The full vocabulary is the contract (mission item 10).
    expect([...TASK_EVIDENCE_KINDS]).toEqual([
      'FILE_OUTPUT',
      'TEST_PROOF',
      'VERIFICATION_ONLY',
      'COORDINATOR_ARTIFACT',
      'NO_OP_ALREADY_SATISFIED',
      'SHARED_SURFACE_OUTPUT',
    ]);
  });
});

describe('resolveBlockEvidence: full task-block evidence law (run 4e59191b/T020)', () => {
  // Exact T020 shape at the 4e59191b launch base: the checkbox line carries
  // NO marker; the NO_OP_ALREADY_SATISFIED reservation sits on a wrapped
  // continuation line. Checkbox-line-only parsing classified it
  // PRODUCT/FILE_OUTPUT and dispatched it to both writer lanes.
  const T020_BLOCK = `T020 is reserved for the test lane (see Phase 7): product tasks do not
      author suites. — [evidence: NO_OP_ALREADY_SATISFIED] planning-time
      numbering reservation only; no product code.
      Traces: FR-MAT-001…012, FR-EVAL-001…009.`;

  test('a wrapped continuation-line marker is recognized', () => {
    expect(resolveBlockEvidence(T020_BLOCK, { unitId: 'T020' })).toBe('NO_OP_ALREADY_SATISFIED');
  });

  test('NO_OP anywhere dominates even a title-line FILE_OUTPUT claim', () => {
    const block = `T020 extend the thing [evidence: FILE_OUTPUT]
      continuation prose — [evidence: NO_OP_ALREADY_SATISFIED] reservation`;
    expect(resolveBlockEvidence(block, { unitId: 'T020' })).toBe('NO_OP_ALREADY_SATISFIED');
  });

  test('title-line marker keeps authority when the body carries none', () => {
    expect(
      resolveBlockEvidence('T001 implement [evidence: TEST_PROOF] the thing\nplain body', {
        unitId: 'T001',
      }),
    ).toBe('TEST_PROOF');
  });

  test('first body marker wins when the title line is unmarked', () => {
    expect(
      resolveBlockEvidence('T001 implement the thing\nbody [evidence: VERIFICATION_ONLY] prose', {
        unitId: 'T001',
      }),
    ).toBe('VERIFICATION_ONLY');
  });

  test('absent everywhere defaults to FILE_OUTPUT (legacy plans)', () => {
    expect(resolveBlockEvidence('T001 implement the thing\nplain body', { unitId: 'T001' })).toBe(
      'FILE_OUTPUT',
    );
  });

  test('unknown kind ANYWHERE in the block fails closed (misspelled no-op never becomes product work)', () => {
    expect(() =>
      resolveBlockEvidence('T001 implement the thing\nbody [evidence: NOOP_SATISFIED] prose', {
        unitId: 'T001',
      }),
    ).toThrow(/TASK_EVIDENCE_UNKNOWN/);
    expect(() => resolveBlockEvidence('T001 [evidence: VIBES] x', { unitId: 'T001' })).toThrow(
      /TASK_EVIDENCE_UNKNOWN/,
    );
  });

  test('COORDINATOR_ARTIFACT still requires a coordinator executor', () => {
    expect(() =>
      resolveBlockEvidence('T001 regen [evidence: COORDINATOR_ARTIFACT]', {
        unitId: 'T001',
        executor: 'PRODUCT',
      }),
    ).toThrow(/TASK_EVIDENCE_INVALID_FOR_EXECUTOR/);
    expect(
      resolveBlockEvidence('T063 regen [evidence: COORDINATOR_ARTIFACT]', {
        unitId: 'T063',
        executor: 'COORDINATOR',
      }),
    ).toBe('COORDINATOR_ARTIFACT');
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
