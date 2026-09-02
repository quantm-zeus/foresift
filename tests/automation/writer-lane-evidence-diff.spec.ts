// Live defect (run 7c98e02e, 2026-09-02): a writer agent is instructed to
// "commit coherent production changes before exit" — and does. The old
// evidence path read ONLY `git status --porcelain` (uncommitted), so a
// lane that committed four real migrations/schema/manifest commits showed a
// CLEAN tree, `dirty=[]`, nominated zero units, and the wave died
// integration-empty ("writer reported zero completed units") despite
// predicting writes that were demonstrably present in base..HEAD.
//
// Law under test: a lane's evidence diff is committed base..HEAD ∪
// uncommitted status. Agent-side commits alone MUST still nominate.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
import {
  laneEvidencePaths,
  claimCompletedUnits,
  parseTaskGraph,
} from '../../scripts/automation/writer-task-evidence.mjs';
import { unitsIndexFromGraph } from '../../scripts/automation/task-completion-evidence.mjs';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lane-evidence-diff-'));
  const run = (cmd: string) => {
    const r = spawnSync(cmd, { shell: true, cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture cmd failed: ${cmd}: ${r.stderr ?? r.stdout}`);
    return (r.stdout ?? '').trim();
  };
  run('git init -q');
  run('git config user.email t@t && git config user.name t');
  mkdirSync(join(root, 'migrations'), { recursive: true });
  writeFileSync(join(root, 'migrations/base.sql'), 'SELECT 1;\n');
  run('git add -A && git commit -qm base');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const graph = {
  schema: 'foresift/impl-task-graph@1',
  units: [
    {
      id: 'T003',
      predictedWrites: ['migrations/g0_trace_0001_trace_schema.sql'],
      productWrites: ['migrations/g0_trace_0001_trace_schema.sql'],
      testWrites: [],
    },
  ],
};

function commitAgentWork(file: string, contents: string) {
  // Simulates the Codex agent: writes the predicted output and COMMITS it —
  // the exact run 7c98e02e core-batch-1 shape (4 commits, clean tree after).
  writeFileSync(join(root, file), contents);
  spawnSync('git add -A && git commit -qm "feat: agent committed its own work"', {
    shell: true,
    cwd: root,
    encoding: 'utf8',
  });
}

const gitSha = (cwd: string) =>
  spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout?.trim() ?? '';

describe('lane evidence diff = committed base..HEAD ∪ uncommitted status', () => {
  test('agent-committed predicted writes still nominate (live 7c98e02e core-batch-1)', () => {
    const before = gitSha(root);
    commitAgentWork('migrations/g0_trace_0001_trace_schema.sql', 'CREATE TABLE trace(id);\n');
    const status =
      spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout ?? '';
    expect(status.trim()).toBe(''); // tree is CLEAN — the old reader saw nothing

    const evidence = laneEvidencePaths({ worktree: root, before });
    expect(evidence).toContain('migrations/g0_trace_0001_trace_schema.sql');

    const parsed = parseTaskGraph(join(root, 'graph.json'));
    expect(parsed).toBeNull(); // no graph file here; use in-memory index instead
    const claims = claimCompletedUnits({
      taskIds: ['T003'],
      changed: evidence,
      unitsById: unitsIndexFromGraph(graph),
      blockers: [],
    });
    expect(claims.nominated).toEqual(['T003']);
    expect(claims.deferred).toEqual([]);
  });

  test('mixed work: committed diff ∪ uncommitted status, deduplicated', () => {
    const before = gitSha(root);
    commitAgentWork('migrations/g0_trace_0001_trace_schema.sql', 'CREATE TABLE trace(id);\n');
    // ALSO leave an uncommitted file behind (agent died mid-second-write).
    writeFileSync(join(root, 'migrations/g0_trace_0002.sql'), 'CREATE TABLE t2(id);\n');
    const evidence = laneEvidencePaths({ worktree: root, before });
    expect(evidence).toContain('migrations/g0_trace_0001_trace_schema.sql');
    expect(evidence).toContain('migrations/g0_trace_0002.sql');
    expect(evidence).toHaveLength(2);
  });

  test('uncommitted-only work: status half carries the evidence (old behavior preserved)', () => {
    const before = gitSha(root);
    writeFileSync(join(root, 'migrations/g0_trace_0001_trace_schema.sql'), 'CREATE TABLE t(id);\n');
    const evidence = laneEvidencePaths({ worktree: root, before });
    expect(evidence).toEqual(['migrations/g0_trace_0001_trace_schema.sql']);
  });

  test('idle lane: no commits, clean tree → empty evidence (fail-closed, never fabricated)', () => {
    const before = gitSha(root);
    expect(laneEvidencePaths({ worktree: root, before })).toEqual([]);
    const claims = claimCompletedUnits({
      taskIds: ['T003'],
      changed: [],
      unitsById: unitsIndexFromGraph(graph),
      blockers: [],
    });
    expect(claims.nominated).toEqual([]);
    expect(claims.deferred[0].reason).toContain('predicted writes');
  });

  test('missing before SHA degrades to status-only (never fabricates a diff)', () => {
    writeFileSync(join(root, 'migrations/g0_trace_0001_trace_schema.sql'), 'CREATE TABLE t(id);\n');
    expect(laneEvidencePaths({ worktree: root, before: null })).toEqual([
      'migrations/g0_trace_0001_trace_schema.sql',
    ]);
    // committed work WITHOUT a resolvable before cannot claim a diff
    commitAgentWork('migrations/other.sql', 'x;\n');
    expect(laneEvidencePaths({ worktree: root, before: null })).toEqual([]);
  });

  test('a clean lane that renamed/moved nothing outside base..HEAD yields exactly the commit paths', () => {
    const before = gitSha(root);
    commitAgentWork('migrations/g0_trace_0001_trace_schema.sql', 'CREATE TABLE trace(id);\n');
    commitAgentWork('migrations/g0_trace_0002_decision_traces.sql', 'CREATE TABLE d(id);\n');
    const head = gitSha(root);
    const viaGit = spawnSync('git', ['diff', '--name-only', `${before}..${head}`], {
      cwd: root,
      encoding: 'utf8',
    })
      .stdout.split('\n')
      .filter(Boolean);
    expect(laneEvidencePaths({ worktree: root, before }).sort()).toEqual(viaGit.sort());
  });
});

describe('writer sources: uncommitted-sweep defined before use (live aa3e8015 ReferenceError)', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  test('every writer defines `dirty` before any `dirty.length` reference', () => {
    for (const rel of [
      'scripts/automation/exec-codex-writer.mjs',
      'scripts/automation/exec-claude-writer.mjs',
      'scripts/automation/claude-lane-core.mjs',
      'scripts/automation/exec-agy-test-writer.mjs',
    ]) {
      const src = read(join(repoRoot, rel));
      const def = src.indexOf('const dirty =');
      const use = src.indexOf('dirty.length');
      expect(def, `${rel} defines dirty`).toBeGreaterThan(-1);
      expect(use, `${rel} uses dirty`).toBeGreaterThan(-1);
      expect(def, `${rel} dirty must precede its first use`).toBeLessThan(use);
    }
  });
});
