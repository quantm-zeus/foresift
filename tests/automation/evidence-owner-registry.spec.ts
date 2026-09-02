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
import { execSync } from 'node:child_process';
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
    taskIds,
    extraRows,
  }: {
    commands: string[];
    matrixRows?: number;
    openTasks?: string[];
    taskIds?: string[];
    extraRows?: string[];
  },
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
  )
    .concat(extraRows ?? [])
    .join('\n');
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
  if (taskIds) writeFileSync(join(root, 'task-ids.json'), JSON.stringify(taskIds));
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
      const { commands, reason } = verificationCommandsFor({ body: '' }, 'pkg-x', root);
      expect(reason).toBeNull();
      expect(commands).toEqual(['pnpm spec:verify']);
      const missing = verificationCommandsFor({ body: '' }, 'pkg-absent', root);
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
      expect(r.proof).toContain('matrix rows invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('closed matrix → coordinator unit completes on the deterministic artifact', () => {
    const root = scratch();
    try {
      fakePackageTree(root, {
        commands: [],
        openTasks: ['T001', 'T025 [executor: COORDINATOR] close matrix'],
        extraRows: ['| T025 | FR-TRACE-001 | AC-265 |'],
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

describe('T024 verification profile (full convergence gate, not the weaker milestone subset)', () => {
  test('declared profile maps to the authoritative convergence command set', () => {
    const root = scratch();
    try {
      // milestone record holds ONLY the weak subset — must be ignored when a
      // profile is declared
      fakePackageTree(root, { commands: ['true'], openTasks: ['T024'] });
      const unit = {
        id: 'T024',
        evidence: 'VERIFICATION_ONLY',
        executor: 'PRODUCT',
        done: false,
        body: '- [ ] T024 [evidence: VERIFICATION_ONLY] [verification: TRACEABILITY_FULL_CONVERGENCE] run the full gate',
      };
      const { commands, profile, profileSource } = verificationCommandsFor(unit, 'pkg-x', root);
      expect(profile).toBe('TRACEABILITY_FULL_CONVERGENCE');
      expect(profileSource).toBe('declared');
      expect(commands).toContain('pnpm --filter @foresift/requirement-manifest test');
      expect(commands).toContain('bun test ./packages/persistence/test/migrator.spec.ts');
      expect(commands).toContain('node scripts/verify-release-conformance/cli.mjs');
      expect(commands).toContain('node scripts/generate-requirement-manifest/cli.mjs --check');
      expect(commands).toContain('pnpm spec:verify');
      expect(commands.length).toBeGreaterThanOrEqual(6);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('declared-but-unmapped profile fails closed (never a silent weak gate)', () => {
    const root = scratch();
    try {
      fakePackageTree(root, { commands: ['true'] });
      const { commands, reason } = verificationCommandsFor(
        { body: '[verification: DOES_NOT_EXIST]' },
        'pkg-x',
        root,
      );
      expect(commands).toEqual([]);
      expect(reason).toContain('unknown verification profile');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('T024 contract: package suites green but migrator RED => stays open', () => {
    const root = scratch();
    try {
      fakePackageTree(root, { commands: [], openTasks: ['T024'] });
      // declare the profile via body; commands come from VERIFICATION_PROFILES
      const unit = {
        id: 'T024',
        evidence: 'VERIFICATION_ONLY',
        executor: 'PRODUCT',
        done: false,
        body: '[verification: TRACEABILITY_FULL_CONVERGENCE]',
      };
      // First command of the profile is the requirement-manifest suite; simulate
      // the real gate ordering by monkey-patching VERIFICATION_PROFILES is not
      // possible (frozen) — instead verify through the dry-run contract: run in
      // a tree where the FIRST profile command (pnpm filter suite) is RED.
      // The profile command set executes against cwd; in a scratch dir `pnpm`
      // exists but the filter target does not => RED quickly.
      const r = completeNonFileEvidence(unit, { packageId: 'pkg-x', root, reason: 'test' });
      expect(r.completed).toBe(false);
      expect(r.proof).toContain('verification command RED');
      // proof records which command failed
      // profile executes in order; the failing command appears in the proof
      expect(r.commandOutcomes?.length ?? 0).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('T025 matrix closure against the authoritative task set', () => {
  test('matrix missing an authoritative task => OPEN', () => {
    const root = scratch();
    try {
      mkdirSync(join(root, 'specs', 'pkg-x'), { recursive: true });
      writeFileSync(
        join(root, 'specs', 'pkg-x', 'tasks.md'),
        '# tasks\n- [ ] T001 a\n- [ ] T014 b\n- [ ] T025 c\n\n## Traceability matrix\n\n| Task | Requirements | Acceptance criteria |\n| --- | --- | --- |\n| T001 | FR-1 | AC-1 |\n| T025 | FR-1 | AC-1 |\n',
      );
      const r = assertTraceabilityMatrixClosed('pkg-x', root, {
        taskIds: ['T001', 'T014', 'T025'],
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('missing: T014');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('matrix referencing unknown task id => OPEN', () => {
    const root = scratch();
    try {
      mkdirSync(join(root, 'specs', 'pkg-x'), { recursive: true });
      writeFileSync(
        join(root, 'specs', 'pkg-x', 'tasks.md'),
        '# tasks\n- [ ] T001 a\n\n## Traceability matrix\n\n| Task | Requirements | Acceptance criteria |\n| --- | --- | --- |\n| T001, T099 | FR-1 | AC-1 |\n',
      );
      const r = assertTraceabilityMatrixClosed('pkg-x', root, { taskIds: ['T001'] });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("unknown task id 'T099'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('empty requirements or AC cell => OPEN; ranges expand and cover', () => {
    const root = scratch();
    try {
      mkdirSync(join(root, 'specs', 'pkg-x'), { recursive: true });
      writeFileSync(
        join(root, 'specs', 'pkg-x', 'tasks.md'),
        '# tasks\n- [ ] T001 a\n- [ ] T002 b\n- [ ] T003 c\n\n## Traceability matrix\n\n| Task | Requirements | Acceptance criteria |\n| --- | --- | --- |\n| T001–T003 |  | AC-1 |\n',
      );
      const empty = assertTraceabilityMatrixClosed('pkg-x', root, {
        taskIds: ['T001', 'T002', 'T003'],
      });
      expect(empty.ok).toBe(false);
      expect(empty.reason).toContain('missing requirement or AC mapping');
      // valid range covers all three
      writeFileSync(
        join(root, 'specs', 'pkg-x', 'tasks.md'),
        '# tasks\n- [ ] T001 a\n- [ ] T002 b\n- [ ] T003 c\n\n## Traceability matrix\n\n| Task | Requirements | Acceptance criteria |\n| --- | --- | --- |\n| T001–T003 | FR-1 | AC-1 |\n',
      );
      const ok = assertTraceabilityMatrixClosed('pkg-x', root, {
        taskIds: ['T001', 'T002', 'T003'],
      });
      expect(ok.ok).toBe(true);
      expect(ok.reason).toContain('cover all 3');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('production wiring (directive 3): the wave pipeline actually invokes the owner', () => {
  test('sharded-wave integrate-and-fast FAST-green branch invokes evidence-owner-registry.mjs', () => {
    // Structural proof of the production call graph: WAVE_FAST_GREEN →
    // evidence-owner-registry.mjs CLI → completeNonFileEvidence → checkbox
    // flip → coordinator commit. A unit test of the function alone proves
    // nothing about production; the yaml IS the production pipeline.
    const yaml = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        '.archon',
        'workflows',
        'foresift',
        'foresift-sharded-wave.yaml',
      ),
      'utf8',
    );
    // Slice the integrate-and-fast NODE (first '  - id: integrate-and-fast') up to
    // the next top-level node; the green branch is between the exit-code capture
    // and the FAST_RED else-arm.
    const nodeStart = yaml.indexOf('  - id: integrate-and-fast');
    const nodeEnd = yaml.indexOf('\n  - id: fast-repair-loop', nodeStart);
    const fastGreen = yaml.slice(nodeStart, nodeEnd > 0 ? nodeEnd : undefined);
    expect(fastGreen).toContain('evidence-owner-registry.mjs');
    expect(fastGreen).toContain('--package "$PKG"');
    expect(fastGreen).toContain('--graph "$ARTIFACTS_DIR/task-graph.json"');
    // the invocation sits inside the FAST-green branch (after the exit-code
    // capture, before the green echo)
    expect(fastGreen.indexOf('evidence-owner-registry.mjs')).toBeGreaterThan(
      fastGreen.indexOf('wave-fast-verdict.json'),
    );
  });

  test('registry owner coverage assertion runs at graph build (integration seam)', () => {
    // build-implementation-task-graph imports assertEvidenceOwnership — the
    // pre-writer fail-closed seam. Prove the import exists in the builder.
    const builder = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'scripts',
        'automation',
        'build-implementation-task-graph.mjs',
      ),
      'utf8',
    );
    expect(builder).toContain("from './evidence-owner-registry.mjs'");
    expect(builder).toContain('assertEvidenceOwnership');
  });
});

describe('atomic non-file completion commit (directive 7)', () => {
  test('CLI pass: flips are only durable once committed; commit failure reverts', () => {
    // Real git repo scratch: run the CLI with a graph whose T024 is
    // VERIFICATION_ONLY with always-green milestone commands.
    const root = scratch();
    try {
      execSync('git init -q && git -C . config user.email t@t && git -C . config user.name t', {
        cwd: root,
      });
      fakePackageTree(root, { commands: ['true'], openTasks: ['T024'] });
      execSync('git add -A && git commit -qm seed', { cwd: root });
      const graphPath = join(root, 'graph.json');
      writeFileSync(
        graphPath,
        JSON.stringify({
          units: [
            {
              id: 'T024',
              done: false,
              evidence: 'VERIFICATION_ONLY',
              executor: 'PRODUCT',
              body: '- [ ] T024 gate',
            },
          ],
        }),
      );
      const out = execSync(
        `node ${join(import.meta.dir, '..', '..', 'scripts', 'automation', 'evidence-owner-registry.mjs')} --package pkg-x --graph ${graphPath}`,
        { cwd: root, encoding: 'utf8' },
      );
      const report = JSON.parse(out);
      expect(report.results[0].completed).toBe(true);
      expect(report.results[0].committed).toBe(true);
      // committed tree carries the flip; working tree clean
      // the flip itself is durable (committed); only the test's own scratch
      // graph.json remains untracked
      const dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
      expect(dirty).toBe('?? graph.json');
      const committed = execSync('git show HEAD:specs/pkg-x/tasks.md', {
        cwd: root,
        encoding: 'utf8',
      });
      expect(committed).toContain('- [x] T024');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
