import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { type MilestoneState, packageEligible } from '../../scripts/automation/schema.mjs';
import {
  loadCommittedMilestone,
  selectionView,
} from '../../scripts/automation/foresift-autopilot.mjs';

// Regression coverage for defect #11 (live run ce3e0354, 2026-08-24): the
// supervisor selected g0-security-perimeter for launch using the WORKING
// TREE's milestone state, which already held the freshly written but NOT YET
// COMMITTED `g0-contracts-data-truth -> PROVEN` chore flip (state chores
// commit via the queue-deferred git chain). Archon materialized the new run
// worktree from COMMITTED main, where the dependency was still RUNNING — its
// deterministic preflight refused (`dependency … is not PROVEN`), recovery
// resumes re-ran in the same stale baseline, and the fatal pause latched.
//
// Invariant pinned here: launch decisions read the COMMITTED milestone state
// (HEAD) — the only baseline a fresh run worktree can inherit. Uncommitted
// flips defer selection by one tick instead of launching against invisible
// state. Writes keep flowing through the file lineage.

type Cleanup = () => void;
const cleanups: Cleanup[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const FOUNDATION = 'fix11-foundation';
const DEPENDENT = 'fix11-dependent';

type MilestoneDoc = MilestoneState;

function milestone(foundationStatus: string): MilestoneDoc {
  const base = {
    id: '',
    objective: 'an outcome-oriented objective sentence',
    requirementIds: ['FR-CORE-001'],
    dependencies: [] as string[],
    risk: 'HIGH',
    parallelizable: false,
    writeScopes: ['packages/x/**'],
    verificationCommands: ['pnpm test'],
  };
  return {
    schemaVersion: '1.0.0',
    milestoneId: 'G0',
    status: 'ACTIVE',
    packages: [
      { ...base, id: FOUNDATION, status: foundationStatus },
      {
        ...base,
        id: DEPENDENT,
        status: 'PENDING',
        dependencies: [FOUNDATION],
      },
    ],
  };
}

/** Hermetic repo whose HEAD carries `foundationStatus`; the working tree is
 * then edited to PROVEN WITHOUT committing (the queued-chore window). */
function buildRepo(headFoundationStatus: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'foresift-select-view-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const g = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  mkdirSync(join(dir, 'specs', 'implementation'), { recursive: true });
  writeFileSync(join(dir, 'specs', 'implementation', 'roadmap.json'), '{}\n');
  writeFileSync(
    join(dir, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify(milestone(headFoundationStatus), null, 2) + '\n',
  );
  g(['add', '-A']);
  g(['commit', '-qm', 'fixture: committed baseline']);
  // The uncommitted chore-flip the supervisor would have just written.
  writeFileSync(
    join(dir, 'specs', 'implementation', 'current-milestone.json'),
    JSON.stringify(milestone('PROVEN'), null, 2) + '\n',
  );
  return dir;
}

describe('launch decisions use the committed milestone view (defect #11)', () => {
  it('reads HEAD, not the working tree holding an uncommitted chore flip', () => {
    const dir = buildRepo('RUNNING');
    const committed = loadCommittedMilestone(dir) as MilestoneDoc | null;
    expect(committed).not.toBeNull();
    expect(committed?.packages[0]?.status).toBe('RUNNING');
  });

  it('defers the dependent launch while the PROVEN flip is uncommitted', () => {
    const dir = buildRepo('RUNNING');
    const committed = loadCommittedMilestone(dir);
    const view = selectionView(milestone('PROVEN'), committed);
    // Selection proceeds only against the committed view…
    expect(view.why).toBe('ok');
    const ms = view.ms as MilestoneDoc;
    const pkg = ms.packages.find((p) => p.id === DEPENDENT);
    if (!pkg) throw new Error('dependent missing from committed view');
    // …where the dependency is NOT proven, so the launch is refused — exactly
    // what preflight inside a fresh worktree would have said.
    expect(packageEligible(ms, pkg)).toEqual({
      eligible: false,
      reason: `dependency ${FOUNDATION} is not PROVEN`,
    });
  });

  it('allows the launch once the chore commit lands (next-tick behavior)', () => {
    const dir = buildRepo('RUNNING');
    const g = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    g(['add', 'specs/implementation']);
    g(['commit', '-qm', 'chore(autopilot): G0/fix11-foundation -> PROVEN']);
    const committed = loadCommittedMilestone(dir);
    const view = selectionView(milestone('PROVEN'), committed);
    expect(view.why).toBe('ok');
    const ms2 = view.ms as MilestoneDoc;
    const pkg2 = ms2.packages.find((p) => p.id === DEPENDENT);
    if (!pkg2) throw new Error('dependent missing from committed view');
    expect(packageEligible(ms2, pkg2)).toEqual({ eligible: true, reason: 'ok' });
  });

  it('fails closed when no committed milestone state exists', () => {
    const bare = mkdtempSync(join(tmpdir(), 'foresift-select-empty-'));
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }));
    execFileSync('git', ['-C', bare, 'init', '-q'], { stdio: 'pipe' });
    const view = selectionView(milestone('PROVEN'), loadCommittedMilestone(bare));
    expect(view.ms).toBeNull();
    expect(view.why).toBe('committed_state_unreadable');
  });

  it('fails closed when the committed milestone state is invalid', () => {
    const dir = buildRepo('RUNNING');
    const g = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    // Commit a milestone with a single package (schema requires 2–8) directly
    // at HEAD while keeping a valid-looking working tree.
    writeFileSync(
      join(dir, 'specs', 'implementation', 'current-milestone.json'),
      JSON.stringify({ milestoneId: 'G0', status: 'ACTIVE', packages: [] }, null, 2) + '\n',
    );
    g(['add', 'specs/implementation']);
    g(['commit', '-qm', 'fixture: invalid committed state']);
    const view = selectionView(milestone('PROVEN'), loadCommittedMilestone(dir));
    expect(view.ms).toBeNull();
    expect(view.why).toContain('committed_state_invalid');
  });
});
