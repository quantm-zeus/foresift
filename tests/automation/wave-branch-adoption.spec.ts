// WAVE BRANCH ADOPTION — continuation-law unit coverage.
//
// The wave's worktrees start FRESH AT MAIN's tip (probe-proven archon
// behavior); the branch-adoption node restores the package's pushed
// implementation baseline BEFORE prep pins its integration base. These tests
// exercise the real module against real git fixtures:
//
//   · unparseable launch message ⇒ REFUSED (fail closed)
//   · absent origin branch       ⇒ FRESH_FROM_MAIN no-op (today's shape)
//   · present + main-contained   ⇒ ADOPTED_SEED at the pushed tip
//   · present but stale vs main  ⇒ ADOPTED_WITH_MAIN_ABSORBED (merge --no-ff,
//                                  pushed back; conflict/push failure ⇒ REFUSED)
//   · dirty worktree             ⇒ REFUSED (never clobber uncommitted work)
//   · generation-aware naming    ⇒ pkg@g2 adopts foresift/<pkg>-g2, never g0
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';

// The adoption core spawns plain `git` inheriting this process's env; give it
// a commit identity so merge commits (main-absorption) can be created.
process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || 't';
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || 't';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || 't@t';
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || 't@t';
import { disposeGitFixtureBase, gitFixture, type GitFixture } from '../helpers/git-fixture.js';
import { waveAdoptLaunchBranch } from '../../scripts/automation/wave-branch-adoption.mjs';

const PKG = 'pkg-alpha';

afterAll(() => {
  disposeGitFixtureBase();
});

interface World {
  fx: GitFixture;
  /** Run the adoption core against the fixture worktree. */
  adopt: (message: string) => ReturnType<typeof waveAdoptLaunchBranch>;
  sha: (ref: string) => string;
  write: (rel: string, body: string) => void;
  commit: (msg: string) => void;
}

function makeWorld(name: string): World {
  const fx = gitFixture(name);
  fx.writeFile('specs/implementation/current-milestone.json', '{}\n');
  fx.commitAll('fixture base');
  fx.g(['push', '-q', 'origin', 'main']);
  return {
    fx,
    adopt: (message) => waveAdoptLaunchBranch({ message, repoRoot: fx.root }),
    sha: (ref) =>
      execFileSync('git', ['-C', fx.root, 'rev-parse', ref], { encoding: 'utf8' }).trim(),
    write: (rel, body) => fx.writeFile(rel, body),
    commit: (msg) => fx.commitAll(msg),
  };
}

function pushPackageBranch(w: World, branch: string, commits: number) {
  w.fx.g(['switch', '-q', '-c', branch]);
  for (let i = 1; i <= commits; i++) {
    w.write(`packages/a/src/slice-${i}.ts`, `export const slice${i} = ${i};\n`);
    w.commit(`feat(a): durable slice ${i}`);
  }
  const tip = w.sha('HEAD');
  w.fx.g(['push', '-q', 'origin', branch]);
  w.fx.g(['switch', '-q', 'main']);
  return tip;
}

describe('wave-branch-adoption', () => {
  it('refuses an unparseable launch message instead of guessing a branch', () => {
    const w = makeWorld('adopt-unparseable');
    // parseGenerationMessage is deliberately lenient about plausible ids
    // (covered by the FRESH_FROM_MAIN test); ONLY an empty message refuses.
    const v = w.adopt('');
    expect(v.mode).toBe('REFUSED');
    expect(v.adopted).toBe(false);
    expect(v.detail).toMatch(/unparseable/);
  });

  it('absent origin branch ⇒ FRESH_FROM_MAIN no-op (the pre-handoff shape is untouched)', () => {
    const w = makeWorld('adopt-fresh');
    const before = w.sha('HEAD');
    const v = w.adopt(PKG);
    expect(v).toMatchObject({ adopted: false, mode: 'FRESH_FROM_MAIN', branch: `foresift/${PKG}` });
    // The worktree was not moved.
    expect(w.sha('HEAD')).toBe(before);
  });

  it('pushed branch contained in main ⇒ ADOPTED_SEED exactly at the pushed tip (gen-0 naming)', () => {
    const w = makeWorld('adopt-seed');
    const tip = pushPackageBranch(w, `foresift/${PKG}`, 2);
    const v = w.adopt(PKG);
    expect(v).toMatchObject({
      adopted: true,
      mode: 'ADOPTED_SEED',
      branch: `foresift/${PKG}`,
      head: tip,
    });
    expect(w.sha('HEAD')).toBe(tip);
  });

  it('generation-aware: pkg@g2 resolves foresift/pkg-g2 and ignores the gen-0 ref entirely', () => {
    const w = makeWorld('adopt-gen2');
    pushPackageBranch(w, `foresift/${PKG}`, 1); // decoy gen-0 branch
    const tip2 = pushPackageBranch(w, `foresift/${PKG}-g2`, 3);
    const v = w.adopt(`${PKG}@g2`);
    expect(v).toMatchObject({
      adopted: true,
      mode: 'ADOPTED_SEED',
      branch: `foresift/${PKG}-g2`,
      head: tip2,
    });
    expect(w.sha('HEAD')).toBe(tip2);
  });

  it('stale branch behind current main ⇒ main absorbed via merge --no-ff and pushed back', () => {
    const w = makeWorld('adopt-absorb');
    const oldTip = pushPackageBranch(w, `foresift/${PKG}`, 2);
    // Main advances past the branch tip.
    w.write('packages/shared/late.ts', 'export const late = true;\n');
    w.commit('feat(shared): landed on main after the branch stalled');
    w.fx.g(['push', '-q', 'origin', 'main']);
    const newMain = w.sha('main');

    const v = w.adopt(PKG);
    expect(v).toMatchObject({
      adopted: true,
      mode: 'ADOPTED_WITH_MAIN_ABSORBED',
      branch: `foresift/${PKG}`,
    });
    expect((v as { mergedMain?: string }).mergedMain).toBe(newMain.slice(0, 10));
    // The adopted HEAD carries BOTH the old slices and current main.
    const contains = (a: string) => {
      try {
        execFileSync('git', ['-C', w.fx.root, 'merge-base', '--is-ancestor', a, 'HEAD']);
        return true;
      } catch {
        return false;
      }
    };
    expect(w.sha('HEAD')).not.toBe(oldTip);
    expect(contains(newMain)).toBe(true);
    expect(contains(oldTip)).toBe(true);
    // And the merged tip was pushed back to origin.
    expect(w.sha(`origin/foresift/${PKG}`)).toBe(w.sha('HEAD'));
  });

  it('conflicting stale branch ⇒ REFUSED with the worktree left clean (fail-closed replay)', () => {
    const w = makeWorld('adopt-conflict');
    pushPackageBranch(w, `foresift/${PKG}`, 1);
    // Same path, different content on main → merge conflict.
    w.fx.g(['switch', '-q', `foresift/${PKG}`]);
    w.write('packages/a/src/slice-1.ts', 'export const slice1 = "rewritten";\n');
    w.commit('feat(a): divergent rewrite');
    w.fx.g(['push', '-q', 'origin', `foresift/${PKG}`]);
    w.fx.g(['switch', '-q', 'main']);
    w.write('packages/a/src/slice-1.ts', 'export const slice1 = "main-wins";\n');
    w.commit('feat(a): conflicting main change');
    w.fx.g(['push', '-q', 'origin', 'main']);

    const v = w.adopt(PKG);
    expect(v.mode).toBe('REFUSED');
    expect(String(v.detail)).toMatch(/absorbing it failed|conflict/i);
    // No leftover MERGE_HEAD: a supervisor replay starts from a clean state.
    expect(
      execFileSync('git', ['-C', w.fx.root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
    ).toBe('');
  });

  it('dirty run worktree ⇒ REFUSED before any checkout (never clobber uncommitted work)', () => {
    const w = makeWorld('adopt-dirty');
    pushPackageBranch(w, `foresift/${PKG}`, 1);
    writeFileSync(join(w.fx.root, 'uncommitted.txt'), 'precious\n');
    const v = w.adopt(PKG);
    expect(v.mode).toBe('REFUSED');
    expect(String(v.detail)).toMatch(/dirty|uncommitted/i);
  });
});
