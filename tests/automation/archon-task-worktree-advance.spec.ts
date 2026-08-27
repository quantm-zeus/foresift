import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  advanceArchonTaskWorktree,
  archonTaskBranchName,
  findArchonTaskWorktree,
} from '../../scripts/automation/foresift-autopilot.mjs';

// Regression coverage for defect #11b (live run ce3e0354, 2026-08-24): archon
// materializes a run worktree fresh at main's tip ONLY at first creation and
// then REUSES it for every later run of the same task. A package relaunched
// afterwards preflights against the CREATION-time main — for
// g0-security-perimeter that baseline predated the dependency's PROVEN chore
// forever, so every fresh restart refused deterministically even though main
// was fine. The defect-#6/#7 machinery keyed on the LAUNCH branch, but these
// worktrees hold archon-internal `archon/task-*` branches and were invisible.
//
// Invariants pinned here: launch prep discovers the task worktree by archon's
// naming convention; advances it to origin/main only as a strict fast-forward
// over a clean tree; never touches diverged or dirty state; no-ops when
// already current; null when nothing is registered.

type Cleanup = () => void;
const cleanups: Cleanup[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const BRANCH = 'foresift/g0-security-perimeter';
const TASK_BRANCH = archonTaskBranchName(BRANCH);

/** A parent repo plus a registered archon-style task worktree whose branch
 * sits at `baseMain` (stale) while parent main has advanced. */
function buildFixture(): { parent: string; wt: string } {
  const dir = mkdtempSync(join(tmpdir(), 'foresift-task-wt-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const g = (args: string[], cwd = dir) =>
    execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'marker.txt'), 'base\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'base']);
  const base = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // Advance parent main past the worktree base (the committed PROVEN chore),
  // published to a bare origin so `fetch origin main` resolves like production.
  writeFileSync(join(dir, 'marker.txt'), 'chore\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'chore(autopilot): G0/dep -> PROVEN']);
  const bare = join(dir, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', bare], { stdio: 'pipe' });
  g(['remote', 'add', 'origin', bare]);
  g(['push', '-q', 'origin', 'main']);
  // Archon-shaped reused worktree: under /.archon/workspaces/, branch named
  // archon/task-<launch branch>, pinned at the stale base.
  const wt = join(dir, '.archon', 'workspaces', 'quantm-zeus', 'worktrees', 'archon');
  mkdirSync(wt, { recursive: true });
  g(['worktree', 'add', '-b', TASK_BRANCH, join(wt, TASK_BRANCH), base]);
  return { parent: dir, wt: join(wt, TASK_BRANCH) };
}

function rev(repo: string, ref: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim();
}

describe('archon task-worktree advance before fresh launches (defect #11b)', () => {
  it('names task branches by folding launch-branch slashes into dashes', () => {
    expect(TASK_BRANCH).toBe('archon/task-foresift-g0-security-perimeter');
    expect(archonTaskBranchName('foresift/milestone-planning')).toBe(
      'archon/task-foresift-milestone-planning',
    );
  });

  it('discovers the reused worktree by branch name and path convention', () => {
    const { parent, wt } = buildFixture();
    expect(findArchonTaskWorktree(BRANCH, parent)).toEqual({ path: wt });
    expect(findArchonTaskWorktree('foresift/never-launched', parent)).toBeNull();
  });

  it('fast-forwards a stale clean worktree to current main', () => {
    const { parent, wt } = buildFixture();
    const mainTip = rev(parent, 'main');
    const res = advanceArchonTaskWorktree(BRANCH, parent) as { ok?: boolean };
    expect(res.ok).toBe(true);
    expect(rev(wt, 'HEAD')).toBe(mainTip);
    expect(readMarker(wt)).toBe('chore\n'); // the PROVEN chore is now visible in the run tree
    // Second call is a designed no-op.
    const again = advanceArchonTaskWorktree(BRANCH, parent) as { skipped?: string };
    expect(again.skipped).toBe('current');
  });

  it('refuses to advance a dirty worktree (fail-closed)', () => {
    const { parent, wt } = buildFixture();
    writeFileSync(join(wt, 'scratch.txt'), 'dead-run residue\n');
    const res = advanceArchonTaskWorktree(BRANCH, parent) as { skipped?: string };
    expect(res.skipped).toBe('dirty');
    expect(rev(wt, 'HEAD')).not.toBe(rev(parent, 'main'));
  });

  it('refuses to advance over unique commits (possibly real product work)', () => {
    const { parent, wt } = buildFixture();
    const g = (args: string[]) => execFileSync('git', ['-C', wt, ...args], { stdio: 'pipe' });
    writeFileSync(join(wt, 'product.txt'), 'crashed-run commit\n');
    g(['add', '-A']);
    g(['commit', '-qm', 'wip: crashed mid-run product work']);
    const res = advanceArchonTaskWorktree(BRANCH, parent) as { skipped?: string };
    expect(res.skipped).toBe('diverged');
    expect(rev(wt, 'HEAD')).not.toBe(rev(parent, 'main'));
  });

  it('returns null for a repo with no registered task worktree (first launch)', () => {
    const bare = mkdtempSync(join(tmpdir(), 'foresift-task-none-'));
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }));
    const g = (args: string[]) => execFileSync('git', ['-C', bare, ...args], { stdio: 'pipe' });
    g(['init', '-q']);
    g(['config', 'user.email', 't@t']);
    g(['config', 'user.name', 't']);
    writeFileSync(join(bare, 'x'), 'x\n');
    g(['add', '-A']);
    g(['commit', '-qm', 'base']);
    expect(advanceArchonTaskWorktree(BRANCH, bare)).toBeNull();
  });
});

function readMarker(worktree: string): string {
  return readFileSync(join(worktree, 'marker.txt'), 'utf8');
}
