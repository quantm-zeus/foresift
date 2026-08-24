import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { implementationComplete } from '../../scripts/automation/package-implement-complete.mjs';

// Regression coverage for defect #9 (live run 8061381a, 2026-08-24): the
// implement-phase completeness validator accepted a "complete" verdict over
// an uncommitted working tree. The scoped plan had told the agent to leave
// ALL changes uncommitted (misattributing the constraint to Constitution
// XVII, which actually mandates additive git history — commits included),
// so the run carried a fully implemented, gate-green but entirely
// uncommitted tree to create-pr — whose dirty-tree guard refused, killing
// the workflow at its LAST node after ~62 minutes of spend.
//
// Invariant pinned here: completion requires committed coherence. Partial
// slices may still hold dirty trees across loop iterations (the validator's
// own design comment promises that), so the cleanliness demand applies only
// when every other completion condition is already satisfied.

const PKG = 'g0-clean-tree';

type Cleanup = () => void;
const cleanups: Cleanup[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** Minimal hermetic repo satisfying every completion precondition except the
 * one under test: valid milestone state, scoped artifacts, all tasks checked,
 * no unresolved markers, everything committed on a named branch. */
function buildRepo({ allChecked = true }: { allChecked?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'foresift-impl-complete-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const g = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  mkdirSync(join(dir, 'specs', 'implementation'), { recursive: true });
  mkdirSync(join(dir, 'specs', PKG), { recursive: true });
  writeFileSync(
    join(dir, 'specs', 'implementation', 'roadmap.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      policy: {},
      currentMilestoneId: 'G0',
      milestones: [{ id: 'G0', name: 'g0', dependsOn: [], status: 'ACTIVE' }],
    }),
  );
  writeFileSync(
    join(dir, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      milestoneId: 'G0',
      status: 'ACTIVE',
      packages: [
        {
          id: PKG,
          objective: 'an outcome-oriented objective sentence',
          requirementIds: ['FR-CORE-001'],
          dependencies: [],
          risk: 'HIGH',
          parallelizable: true,
          writeScopes: ['packages/x/**'],
          verificationCommands: ['pnpm test'],
          status: 'PENDING',
        },
        {
          id: `${PKG}-peer`,
          objective: 'another outcome-oriented objective sentence',
          requirementIds: ['FR-CORE-002'],
          dependencies: [],
          risk: 'LOW',
          parallelizable: true,
          writeScopes: ['packages/y/**'],
          verificationCommands: ['pnpm test'],
          status: 'PENDING',
        },
      ],
    }),
  );
  for (const f of ['spec.md', 'plan.md'])
    writeFileSync(join(dir, 'specs', PKG, f), `# ${f}\n\nClean prose without markers.\n`);
  writeFileSync(
    join(dir, 'specs', PKG, 'tasks.md'),
    [
      '# Tasks',
      '',
      '- [x] T101 first coherent unit',
      ...(allChecked ? [] : ['- [ ] T102 second coherent unit']),
    ].join('\n') + '\n',
  );
  g(['add', '-A']);
  g(['commit', '-qm', 'fixture: complete scoped package']);
  return dir;
}

describe('implementation completeness requires a committed tree (defect #9)', () => {
  it('refuses completion over an uncommitted tracked modification and teaches the remediation', () => {
    const dir = buildRepo();
    appendFileSync(join(dir, 'specs', PKG, 'tasks.md'), '\n');
    const r = implementationComplete(PKG, dir);
    expect(r.complete).toBe(false);
    const joined = r.errors.join('\n');
    expect(joined).toMatch(/uncommitted change\(s\)/);
    expect(joined).toContain('create-pr refuses a dirty tree');
    expect(joined).toContain('tasks.md');
  });

  it('refuses completion while newly created files are still untracked', () => {
    const dir = buildRepo();
    mkdirSync(join(dir, 'packages', 'x'), { recursive: true });
    writeFileSync(join(dir, 'packages', 'x', 'new-module.ts'), 'export {};\n');
    const r = implementationComplete(PKG, dir);
    expect(r.complete).toBe(false);
    expect(r.errors.join('\n')).toContain('new-module.ts');
  });

  it('returns complete on a fully committed clean tree', () => {
    const r = implementationComplete(PKG, buildRepo());
    expect(r).toMatchObject({ complete: true });
  });

  it('keeps partial-slice verdicts about remaining tasks, not tree state', () => {
    // Dirty tree + unfinished task: the unchecked-task error dominates; the
    // verdict must stay incomplete either way (fail-closed), but this pins
    // that partial slices are judged by their tasks first.
    const dir = buildRepo({ allChecked: false });
    appendFileSync(join(dir, 'specs', PKG, 'tasks.md'), '\n');
    const r = implementationComplete(PKG, dir);
    expect(r.complete).toBe(false);
    expect(r.errors.join('\n')).toMatch(/still unchecked/);
  });
});
