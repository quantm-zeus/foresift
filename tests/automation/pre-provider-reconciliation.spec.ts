// Directive 2026-09-06 §4 — deterministic already-satisfied reconciliation
// BEFORE provider acquisition. Live evidence: core-batch-1 on run
// fbbcb1d7fd461c82eaa7c514105e9878 burned 64m35s of writer wall clock on a
// lane whose every predicted output already existed at HEAD with trusted
// package-lineage ancestry (changedFiles=0, SUCCESS, zero product value).
// The §6 already-satisfied audit (PR #190) only runs POST-integration, when
// the provider spend is already sunk.
//
// Laws under test:
//   1. preProviderReconciliation(graph, ctx): every OPEN FILE_OUTPUT unit
//      whose predicted writes all exist at HEAD with trusted-ancestry proof
//      (fileEvidenceAlreadySatisfied) is reconciled → checkbox flipped with
//      an explicit reason recorded; the function returns the per-unit table.
//   2. Fail closed: missing output, no authoring commit, or authorship that
//      does not postdate the trusted base → the unit stays OPEN, is never
//      silently flipped, and the reconciliation records the blocker reason.
//   3. Zero-AI: the pass is pure git/FS arithmetic; one coordinator commit
//      carries all flips (same commit identity integration uses); when the
//      commit fails the write is reverted (no half-flipped dirty state).
//   4. Wire-blindness is forbidden: the wave prep node must invoke the
//      pre-provider pass AFTER the graph is built and BEFORE briefs are
//      emitted (structural yaml proof), and the run's task-graph mirror
//      records the reconciled decisions for telemetry.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { preProviderReconciliation } =
  await import('../../scripts/automation/pre-provider-reconciliation.mjs');

let ROOT: string;

function git(...args: string[]) {
  const r = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}

function exists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

// The reconciler rewrites the REAL package tasks file (specs/<pkg>/tasks.md,
// the same artifact the task-graph builder parses), so every fixture seeds a
// minimal checkbox plan before the pass runs.
function seedTasks(tasks: Array<[string, boolean, string]>): void {
  const dir = join(ROOT, 'specs', 'pkg-x');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'tasks.md');
  const lines = exists(p) ? readFileSync(p, 'utf8').split('\n') : ['# tasks'];
  for (const [id, done, body] of tasks) lines.push(`- [${done ? 'x' : ' '}] ${id} ${body}`);
  writeFileSync(p, lines.join('\n'));
}

function graphUnit(id: string, predictedWrites: string[], extra: Record<string, unknown> = {}) {
  return { id, done: false, evidence: 'FILE_OUTPUT', predictedWrites, ...extra };
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'pre-provider-recon-'));
  mkdirSync(join(ROOT, 'packages'), { recursive: true });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(ROOT, 'seed.txt'), 'seed\n');
  git('add', '.');
  git('commit', '-qm', 'seed');
  git('tag', 'trusted-base'); // graph.bound.mainHeadSha equivalent
  // Every test commits its product fixture AFTER the trusted base; the tag
  // already sits on the seed commit, so nothing extra to pin here.
});

afterEach(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {}
});

describe('preProviderReconciliation: already-satisfied units close BEFORE provider spend', () => {
  test('flips a unit whose predicted writes exist at HEAD authored after the trusted base', () => {
    seedTasks([['T001', false, 'author packages/out.ts']]);
    writeFileSync(join(ROOT, 'packages', 'out.ts'), 'const x = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'feat: author out.ts (trusted package lineage)');

    const graph = {
      units: [graphUnit('T001', ['packages/out.ts'])],
      bound: { mainHeadSha: git('rev-parse', 'trusted-base').out },
    };
    const report = preProviderReconciliation(graph, { root: ROOT, packageId: 'pkg-x' });

    expect(report.reconciled).toEqual(['T001']);
    expect(report.blocked).toEqual([]);
    // checkbox flipped, explicit reason committed
    const tasks = readFileSync(join(ROOT, 'specs', 'pkg-x', 'tasks.md'), 'utf8');
    expect(tasks).toMatch(/- \[x\] T001 /);
    expect(tasks).toContain('NO_OP_ALREADY_SATISFIED');
    const lastCommit = git('log', '-1', '--format=%s').out;
    expect(lastCommit).toContain('pre-provider reconciliation');
  });

  test('fail closed: missing predicted output stays OPEN with the blocker recorded', () => {
    seedTasks([['T002', false, 'author packages/never-written.ts']]);
    const graph = {
      units: [graphUnit('T002', ['packages/never-written.ts'])],
      bound: { mainHeadSha: git('rev-parse', 'trusted-base').out },
    };
    const report = preProviderReconciliation(graph, { root: ROOT, packageId: 'pkg-x' });

    expect(report.reconciled).toEqual([]);
    expect(report.blocked).toHaveLength(1);
    expect(report.blocked[0].taskId).toBe('T002');
    expect(report.blocked[0].reason).toContain('not present at HEAD');
    const tasks = readFileSync(join(ROOT, 'specs', 'pkg-x', 'tasks.md'), 'utf8');
    expect(tasks).toMatch(/- \[ \] T002 /);
  });

  test('fail closed: file exists but was authored BEFORE the trusted base (unrelated-file trap)', () => {
    seedTasks([['T003', false, 'author packages/old.ts']]);
    // the file predates the trusted base tag — no package authorship since
    writeFileSync(join(ROOT, 'packages', 'old.ts'), 'old\n');
    git('add', '.');
    git('commit', '-qm', 'pre-base authorship');

    const graph = {
      units: [graphUnit('T003', ['packages/old.ts'])],
      bound: { mainHeadSha: git('rev-parse', 'HEAD').out },
    };
    const report = preProviderReconciliation(graph, { root: ROOT, packageId: 'pkg-x' });

    expect(report.reconciled).toEqual([]);
    expect(report.blocked[0].reason).toContain('no package authorship');
  });

  test('non-FILE_OUTPUT units are out of scope (their owners own them)', () => {
    seedTasks([['T010', false, 'verify [evidence: VERIFICATION_ONLY]']]);
    writeFileSync(join(ROOT, 'packages', 'v.ts'), 'v\n');
    git('add', '.');
    git('commit', '-qm', 'authored');

    const graph = {
      units: [
        {
          id: 'T010',
          done: false,
          evidence: 'VERIFICATION_ONLY',
          predictedWrites: ['packages/v.ts'],
        },
      ],
      bound: { mainHeadSha: git('rev-parse', 'trusted-base').out },
    };
    const report = preProviderReconciliation(graph, { root: ROOT, packageId: 'pkg-x' });
    expect(report.reconciled).toEqual([]);
    expect(report.blocked).toEqual([]); // not even listed as blocked: out of scope
    expect(report.outOfScope).toEqual(['T010']);
  });

  test('done units are skipped; empty predictedWrites fail closed with a reason', () => {
    seedTasks([
      ['T020', true, 'already done'],
      ['T021', false, 'no writes recorded'],
    ]);
    writeFileSync(join(ROOT, 'packages', 'w.ts'), 'w\n');
    git('add', '.');
    git('commit', '-qm', 'authored');

    const graph = {
      units: [graphUnit('T020', ['packages/w.ts'], { done: true }), graphUnit('T021', [])],
      bound: { mainHeadSha: git('rev-parse', 'trusted-base').out },
    };
    const report = preProviderReconciliation(graph, { root: ROOT, packageId: 'pkg-x' });
    expect(report.reconciled).toEqual([]);
    expect(report.blocked).toHaveLength(1);
    expect(report.blocked[0].taskId).toBe('T021');
    expect(report.blocked[0].reason).toContain('no predicted writes');
  });

  test('mixed wave: satisfied units reconcile, unsatisfied stay open, ONE commit', () => {
    seedTasks([
      ['T030', false, 'author packages/yes.ts'],
      ['T031', false, 'author packages/nope.ts'],
    ]);
    writeFileSync(join(ROOT, 'packages', 'yes.ts'), 'y\n');
    git('add', '.');
    git('commit', '-qm', 'authored yes.ts');

    const graph = {
      units: [graphUnit('T030', ['packages/yes.ts']), graphUnit('T031', ['packages/nope.ts'])],
      bound: { mainHeadSha: git('rev-parse', 'trusted-base').out },
    };
    const report = preProviderReconciliation(graph, { root: ROOT, packageId: 'pkg-x' });
    expect(report.reconciled).toEqual(['T030']);
    expect(report.blocked).toHaveLength(1);
    // exactly ONE coordinator commit for the whole pass — the product fixture
    // commit + the single reconciliation commit.
    const commits = git('log', '--oneline', '--format=%s', 'trusted-base..HEAD')
      .out.split('\n')
      .filter((s) => s.includes('pre-provider reconciliation'));
    expect(commits).toHaveLength(1);
  });
});

describe('production wiring: wave prep runs the pass before ANY provider can be acquired', () => {
  test('sharded-wave prep invokes pre-provider-reconciliation between graph build and brief build', () => {
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
    const prepStart = yaml.indexOf('  - id: prep');
    const prepEnd = yaml.indexOf('\n  - id: brief-serial-1', prepStart);
    const prep = yaml.slice(prepStart, prepEnd);
    expect(prep).toContain('pre-provider-reconciliation.mjs');
    const graphBuild = prep.indexOf('build-implementation-task-graph.mjs');
    const reconciler = prep.indexOf('pre-provider-reconciliation.mjs');
    const briefBuild = prep.indexOf('build-writer-briefs.mjs');
    // provider acquisition ordering law: graph → reconcile → briefs
    expect(graphBuild).toBeGreaterThan(-1);
    expect(reconciler).toBeGreaterThan(graphBuild);
    expect(briefBuild).toBeGreaterThan(reconciler);
    // the pass must also run before writer admission (the next provider gate)
    const admission = prep.indexOf('check-writer-admission.mjs');
    expect(admission).toBeGreaterThan(reconciler);
  });

  test('the reconciler records a machine-readable report the wave can mirror for telemetry', () => {
    seedTasks([['T040', false, 'author packages/z.ts']]);
    writeFileSync(join(ROOT, 'packages', 'z.ts'), 'z\n');
    git('add', '.');
    git('commit', '-qm', 'authored');
    const graph = {
      units: [graphUnit('T040', ['packages/z.ts'])],
      bound: { mainHeadSha: git('rev-parse', 'trusted-base').out },
    };
    preProviderReconciliation(graph, {
      root: ROOT,
      packageId: 'pkg-x',
      reportPath: join(ROOT, 'reconciliation-report.json'),
    });
    const persisted = JSON.parse(readFileSync(join(ROOT, 'reconciliation-report.json'), 'utf8'));
    expect(persisted.schema).toBe('foresift/pre-provider-reconciliation@1');
    expect(persisted.reconciled).toEqual(['T040']);
    expect(persisted.atHead).toBe(git('rev-parse', 'HEAD').out);
  });
});
