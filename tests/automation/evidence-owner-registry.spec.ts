// Evidence-owner registry regressions (G0 final correctness delta, directive
// 4): PRD law — EVERY OPEN TASK HAS A REAL DETERMINISTIC COMPLETION OWNER.
// #147 gave T024/T025 non-file evidence kinds; metadata alone completes
// nothing. These tests prove:
//   - the registry covers every non-file kind in the kinds vocabulary;
//   - an open task declaring an owner-less kind FAILS graph build closed;
//   - VERIFICATION_ONLY: RED commands → task stays open; GREEN → completes;
//   - COORDINATOR_ARTIFACT: refuses non-coordinator units; completes a
//     coordinator unit only on the deterministic matrix assertion;
//   - NO_OP_ALREADY_SATISFIED: refuses silent completion.
// Zero AI: every assertion is deterministic command + checkbox arithmetic.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertEvidenceOwnership,
  assertTraceabilityMatrixClosed,
  completeNonFileEvidence,
  evidenceOwnerRegistry,
  verificationCommandsFor,
} from '../../scripts/automation/evidence-owner-registry.mjs';
import { TASK_EVIDENCE_KINDS } from '../../scripts/automation/task-metadata.mjs';

const FILE_TRUTH_KINDS = new Set(['FILE_OUTPUT', 'TEST_PROOF', 'SHARED_SURFACE_OUTPUT']);

function scratch() {
  return mkdtempSync(join(tmpdir(), 'evidence-owner-'));
}

function fakePackageTree(
  root: string,
  {
    commands,
    matrixRows = 1,
    openTasks = ['T025'],
  }: { commands: string[]; matrixRows?: number; openTasks?: string[] },
) {
  mkdirSync(join(root, 'specs', 'pkg-x'), { recursive: true });
  mkdirSync(join(root, 'specs', 'implementation'), { recursive: true });
  writeFileSync(
    join(root, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify({
      packages: [{ id: 'pkg-x', verificationCommands: commands }],
    }),
  );
  const rows = Array.from(
    { length: matrixRows },
    (_, i) => `| T00${i + 1}–T00${i + 1} | FR-TRACE-001 | AC-265 |`,
  ).join('\n');
  const checkboxes = openTasks
    .map(
      (t) =>
        `- [ ] ${t}${t.startsWith('T') && !t.includes(' ') ? ' [evidence: VERIFICATION_ONLY] body' : ''}`,
    )
    .join('\n');
  writeFileSync(
    join(root, 'specs', 'pkg-x', 'tasks.md'),
    `# tasks\n${checkboxes}\n\n## Traceability matrix\n\n| Task | Requirements | Acceptance criteria |\n| --- | --- | --- |\n${rows}\n`,
  );
}

describe('evidence-owner registry coverage (fail closed at graph build)', () => {
  test('every non-file evidence kind in the vocabulary has a registered owner', () => {
    for (const kind of TASK_EVIDENCE_KINDS) {
      if (FILE_TRUTH_KINDS.has(kind)) continue; // lane-diff protocol owns these
      expect(evidenceOwnerRegistry[kind]).toBeTruthy();
    }
    // the vocabulary itself is closed: no unknown kind can sneak past the
    // graph-build assertion
    expect(() =>
      assertEvidenceOwnership({
        units: [{ id: 'T001', done: false, evidence: 'TELEPATHY', executor: 'PRODUCT' }],
      }),
    ).toThrow(/unknown evidence kind/);
  });

  test('open task with an owner-less kind fails graph build closed', () => {
    // simulate a registry that lacks COORDINATOR_ARTIFACT coverage
    expect(() =>
      assertEvidenceOwnership(
        {
          units: [
            { id: 'T025', done: false, evidence: 'COORDINATOR_ARTIFACT', executor: 'COORDINATOR' },
          ],
        },
        { evidenceKinds: ['VERIFICATION_ONLY'] },
      ),
    ).toThrow(/EVIDENCE_OWNER_MISSING.*T025.*no registered runtime consumer/);
  });

  test('closed tasks never trip the assertion; FILE_OUTPUT needs no owner', () => {
    const r = assertEvidenceOwnership({
      units: [
        { id: 'T001', done: true, evidence: 'TELEPATHY', executor: 'PRODUCT' }, // done: skipped
        { id: 'T002', done: false, evidence: 'FILE_OUTPUT', executor: 'PRODUCT' },
        { id: 'T003', done: false, evidence: null, executor: 'PRODUCT' }, // implicit default
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(2);
  });

  test('COORDINATOR_ARTIFACT requires coordinator ownership', () => {
    expect(() =>
      assertEvidenceOwnership({
        units: [{ id: 'T025', done: false, evidence: 'COORDINATOR_ARTIFACT', executor: 'PRODUCT' }],
      }),
    ).toThrow(/EVIDENCE_OWNER_MISSING.*requires \[executor: COORDINATOR\]/);
  });
});

describe('VERIFICATION_ONLY completion owner (T024 class)', () => {
  test('RED verification command → task stays open, proof records the failure', () => {
    const root = scratch();
    try {
      fakePackageTree(root, { commands: ['pnpm spec:verify', 'false'], openTasks: ['T024'] });
      const unit = { id: 'T024', evidence: 'VERIFICATION_ONLY', executor: 'PRODUCT', done: false };
      const r = completeNonFileEvidence(unit, { packageId: 'pkg-x', root, reason: 'test' });
      expect(r.completed).toBe(false);
      expect(r.proof).toContain('verification command RED');
      const tasks = readFileSync(join(root, 'specs', 'pkg-x', 'tasks.md'), 'utf8');
      expect(tasks).toContain('- [ ] T024');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('GREEN verification commands at the canonical HEAD → completes deterministically', () => {
    const root = scratch();
    try {
      fakePackageTree(root, {
        commands: ['true', 'test -f specs/pkg-x/tasks.md'],
        openTasks: ['T024'],
      });
      const unit = { id: 'T024', evidence: 'VERIFICATION_ONLY', executor: 'PRODUCT', done: false };
      const r = completeNonFileEvidence(unit, { packageId: 'pkg-x', root, reason: 'test' });
      expect(r.completed).toBe(true);
      expect(r.proof).toContain('2 verification commands GREEN');
      // atHead is best-effort identity: a scratch tmpdir has no git HEAD, so
      // accept empty (non-repo) OR a full 40-hex sha (canonical checkout).
      expect(r.atHead === '' || /^[0-9a-f]{40}$/.test(r.atHead)).toBe(true);
      const tasks = readFileSync(join(root, 'specs', 'pkg-x', 'tasks.md'), 'utf8');
      expect(tasks).toContain('- [x] T024');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('no derivable verification commands → stays open (never fabricated)', () => {
    const root = scratch();
    try {
      mkdirSync(join(root, 'specs', 'pkg-x'), { recursive: true });
      writeFileSync(join(root, 'specs', 'pkg-x', 'tasks.md'), '- [ ] T024 body\n');
      const unit = { id: 'T024', evidence: 'VERIFICATION_ONLY', executor: 'PRODUCT', done: false };
      const r = completeNonFileEvidence(unit, { packageId: 'pkg-x', root, reason: 'test' });
      expect(r.completed).toBe(false);
      expect(r.proof).toContain('no verification commands');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('verificationCommandsFor reads the authoritative milestone record', () => {
    const root = scratch();
    try {
      fakePackageTree(root, { commands: ['pnpm spec:verify'] });
      const { commands, reason } = verificationCommandsFor('pkg-x', root);
      expect(reason).toBeNull();
      expect(commands).toEqual(['pnpm spec:verify']);
      const missing = verificationCommandsFor('pkg-absent', root);
      expect(missing.commands).toEqual([]);
      expect(missing.reason).toContain('not in milestone');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('COORDINATOR_ARTIFACT completion owner (T025 class)', () => {
  test('non-coordinator unit → refusal (no owner can act on it)', () => {
    const root = scratch();
    try {
      fakePackageTree(root, { commands: [] });
      const unit = {
        id: 'T025',
        evidence: 'COORDINATOR_ARTIFACT',
        executor: 'PRODUCT',
        done: false,
      };
      const r = completeNonFileEvidence(unit, { packageId: 'pkg-x', root, reason: 'test' });
      expect(r.completed).toBe(false);
      expect(r.proof).toContain('refusing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('incomplete matrix assertion → coordinator unit stays open', () => {
    const root = scratch();
    try {
      // matrix row with an empty requirement mapping
      fakePackageTree(root, { commands: [] });
      writeFileSync(
        join(root, 'specs', 'pkg-x', 'tasks.md'),
        '- [ ] T025 [executor: COORDINATOR] close matrix\n\n## Traceability matrix\n\n| Task | Requirements | Acceptance criteria |\n| --- | --- | --- |\n| T001–T003 |  | AC-265 |\n',
      );
      const unit = {
        id: 'T025',
        evidence: 'COORDINATOR_ARTIFACT',
        executor: 'COORDINATOR',
        done: false,
      };
      const r = completeNonFileEvidence(unit, { packageId: 'pkg-x', root, reason: 'test' });
      expect(r.completed).toBe(false);
      expect(r.proof).toContain('matrix rows unmapped');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('closed matrix → coordinator unit completes on the deterministic artifact', () => {
    const root = scratch();
    try {
      fakePackageTree(root, {
        commands: [],
        openTasks: ['T025 [executor: COORDINATOR] close matrix'],
      });
      const unit = {
        id: 'T025',
        evidence: 'COORDINATOR_ARTIFACT',
        executor: 'COORDINATOR',
        done: false,
      };
      const r = completeNonFileEvidence(unit, { packageId: 'pkg-x', root, reason: 'test' });
      expect(r.completed).toBe(true);
      expect(r.proof).toContain('traceability matrix closed');
      const tasks = readFileSync(join(root, 'specs', 'pkg-x', 'tasks.md'), 'utf8');
      expect(tasks).toContain('- [x] T025');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('assertTraceabilityMatrixClosed: no matrix section → not closed', () => {
    const root = scratch();
    try {
      mkdirSync(join(root, 'specs', 'pkg-x'), { recursive: true });
      writeFileSync(join(root, 'specs', 'pkg-x', 'tasks.md'), '# tasks\n- [ ] T025 body\n');
      const r = assertTraceabilityMatrixClosed('pkg-x', root);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('no task rows');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('NO_OP_ALREADY_SATISFIED completion owner', () => {
  test('silent completion refused; explicit reason completes', () => {
    const root = scratch();
    try {
      fakePackageTree(root, { commands: [], openTasks: ['T030'] });
      const unit = {
        id: 'T030',
        evidence: 'NO_OP_ALREADY_SATISFIED',
        executor: 'PRODUCT',
        done: false,
      };
      const silent = completeNonFileEvidence(unit, { packageId: 'pkg-x', root });
      expect(silent.completed).toBe(false);
      expect(silent.proof).toContain('explicit reason required');
      const withReason = completeNonFileEvidence(unit, {
        packageId: 'pkg-x',
        root,
        reason: 'deliverable already satisfied by landed sibling',
      });
      expect(withReason.completed).toBe(true);
      expect(readFileSync(join(root, 'specs', 'pkg-x', 'tasks.md'), 'utf8')).toContain(
        '- [x] T030',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
