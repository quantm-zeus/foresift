// Hyperdrive H3 P0-1 — evidence-backed, fail-closed task completion.
//
// Reproduces the MCP-incident class: a lane assigned T001,T002,T003 whose
// writer only actually writes T002's output must complete T002 and leave
// T001/T003 OPEN. The old invariant (ANY DIFF ⇒ ALL LANE TASKS COMPLETE) is
// gone from every engine; a model merely saying "done" completes nothing.
import { describe, test, expect } from 'bun:test';
import {
  taskEvidence,
  nominateCompletedUnits,
  validateLaneNominations,
  unitsIndexFromGraph,
} from '../../scripts/automation/task-completion-evidence.mjs';
import {
  claimCompletedUnits,
  parseTaskGraph,
} from '../../scripts/automation/writer-task-evidence.mjs';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const units = [
  { id: 'T001', predictedWrites: ['src/feature-a.ts'] },
  { id: 'T002', predictedWrites: ['src/feature-b.ts', 'src/feature-b.types.ts'] },
  { id: 'T003', predictedWrites: ['src/feature-c.ts'] },
  { id: 'T004', predictedWrites: [] }, // no deterministic outputs knowable
];
const unitsById = unitsIndexFromGraph({ units });

describe('writer-side nomination (predicted-write evidence only)', () => {
  test('MCP incident: lane assigned T001,T002,T003, writer changes only T002 output', () => {
    const { nominated, deferred } = nominateCompletedUnits({
      assignedTaskIds: ['T001', 'T002', 'T003'],
      unitsById,
      changedFiles: ['src/feature-b.ts'],
    });
    expect(nominated).toEqual(['T002']);
    expect(deferred.map((d) => d.taskId).sort()).toEqual(['T001', 'T003']);
  });

  test('an empty diff nominates nothing — never fabricated', () => {
    const { nominated, deferred } = nominateCompletedUnits({
      assignedTaskIds: ['T001', 'T002'],
      unitsById,
      changedFiles: [],
    });
    expect(nominated).toEqual([]);
    expect(deferred).toHaveLength(2);
    for (const d of deferred) expect(d.reason).toContain('predicted writes');
  });

  test('partial predicted-write coverage is evidence (any predicted path touched)', () => {
    const { nominated } = nominateCompletedUnits({
      assignedTaskIds: ['T002'],
      unitsById,
      changedFiles: ['src/feature-b.types.ts'],
    });
    expect(nominated).toEqual(['T002']);
  });

  test('tasks without predicted writes can never be completed by this protocol', () => {
    const { nominated, deferred } = nominateCompletedUnits({
      assignedTaskIds: ['T004'],
      unitsById,
      changedFiles: ['anything/else.ts'],
    });
    expect(nominated).toEqual([]);
    expect(deferred[0].reason).toContain('no predicted writes');
  });

  test('a declared blocker keeps its task OPEN even with diff evidence', () => {
    const { nominated, deferred } = nominateCompletedUnits({
      assignedTaskIds: ['T002'],
      unitsById,
      changedFiles: ['src/feature-b.ts'],
      blockers: ['blocked on upstream schema change: T002'],
    });
    expect(nominated).toEqual([]);
    expect(deferred[0].reason).toBe('declared blocker');
  });

  test('unknown units stay open (fail-closed)', () => {
    const { nominated, deferred } = nominateCompletedUnits({
      assignedTaskIds: ['T999'],
      unitsById,
      changedFiles: ['src/x.ts'],
    });
    expect(nominated).toEqual([]);
    expect(deferred[0].reason).toContain('unknown unit');
  });
});

describe('coordinator-side validation (fail-closed re-check)', () => {
  test('nominations re-validated against the coordinator’s OWN recomputed diff', () => {
    // Writer claims T001+T002 from its own dirty files; the coordinator's
    // recomputed lane diff only contains T002's output. T001 must be rejected.
    const { accepted, rejected } = validateLaneNominations({
      laneTaskIds: ['T001', 'T002', 'T003'],
      unitsById,
      changedFiles: ['src/feature-b.ts'],
      nominatedTaskIds: ['T001', 'T002'],
    });
    expect(accepted).toEqual(['T002']);
    expect(rejected).toEqual([
      { taskId: 'T001', reason: expect.stringContaining('predicted writes') },
    ]);
  });

  test('a nomination for a task outside the lane is rejected (lane membership)', () => {
    const { accepted, rejected } = validateLaneNominations({
      laneTaskIds: ['T002'],
      unitsById,
      changedFiles: ['src/other-lane.ts'],
      nominatedTaskIds: ['T001'], // belongs to a sibling lane
    });
    expect(accepted).toEqual([]);
    expect(rejected[0].reason).toContain('not assigned to this lane');
  });

  test('one accepted task never implies siblings: deferred evidence is recorded', () => {
    const lane = ['T001', 'T002', 'T003'];
    const writerClaims = claimCompletedUnits({
      taskIds: lane,
      changed: ['src/feature-b.ts'],
      unitsById,
    });
    expect(writerClaims.nominated).toEqual(['T002']);
    const validated = validateLaneNominations({
      laneTaskIds: lane,
      unitsById,
      changedFiles: ['src/feature-b.ts'],
      nominatedTaskIds: writerClaims.nominated,
      blockers: [],
    });
    expect(validated.accepted).toEqual(['T002']);
    // T001/T003 remain unaccepted ⇒ stay open in canonical tasks.md.
    expect(validated.accepted).not.toContain('T001');
    expect(validated.accepted).not.toContain('T003');
    expect(writerClaims.deferred.map((d: { taskId: string }) => d.taskId).sort()).toEqual([
      'T001',
      'T003',
    ]);
  });
});

describe('task-graph evidence plumbing', () => {
  test('unitsIndexFromGraph + parseTaskGraph expose predictedWrites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-evidence-'));
    try {
      const graphPath = join(dir, 'task-graph.json');
      writeFileSync(
        graphPath,
        JSON.stringify({
          schema: 'foresift/impl-task-graph@1',
          units,
          shards: [{ id: 'core', mode: 'serial', units: ['T001', 'T002', 'T003'] }],
        }),
      );
      const parsed = parseTaskGraph(graphPath);
      expect(parsed).not.toBeNull();
      expect(parsed?.unitsById.get('T002')?.predictedWrites).toContain('src/feature-b.ts');
      // unreadable/missing graph parses to null (writers fall back to zero claims)
      expect(parseTaskGraph(join(dir, 'missing.json'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('taskEvidence distinguishes known-evidence from unknown-unit', () => {
    expect(taskEvidence('T001', unitsById, ['src/feature-a.ts']).evidencable).toBe(true);
    expect(taskEvidence('T001', unitsById, ['src/zzz.ts']).evidencable).toBe(false);
    expect(taskEvidence('NOPE', unitsById, ['src/feature-a.ts']).evidencable).toBe(false);
  });
});
