import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitFixture, type GitFixture } from '../helpers/git-fixture.js';
import { createFakeGh } from '../helpers/state-landing-fixture.js';

import { advanceStateTransition, readReceipt } from '../../scripts/automation/state-landing.mjs';
import { compareMilestoneJsonSemantic } from '../../scripts/automation/classify-ci-diff.mjs';
import {
  createLaunchIntent,
  reconcileLaunchIntentsOnStartup,
} from '../../scripts/automation/launch-intent.mjs';
import { captureCiIncident } from '../../scripts/automation/ci-authority.mjs';
import {
  advanceRepairRequest,
  persistRepairRequest,
} from '../../scripts/automation/ci-repair-executor.mjs';

const makeGitFn = (fix: GitFixture) => (args: string[], opts?: { cwd?: string }) => {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', args, { cwd: opts?.cwd || fix.root, encoding: 'utf8' }).trim(),
      stderr: '',
      status: 0,
    };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      ok: false,
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
      status: err.status ?? 1,
    };
  }
};

describe('State Authority V2 Core Correctness', () => {
  let fix: GitFixture;
  let fakeGh: ReturnType<typeof createFakeGh>;
  let stateDir: string;
  let logSpy: (msg: string) => void;

  beforeEach(() => {
    fix = gitFixture(`state-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fakeGh = createFakeGh(fix);
    stateDir = mkdtempSync(join(tmpdir(), 'foresift-state-'));
    logSpy = () => {};
    // Ensure base origin is ready
    fix.writeFile('base.txt', 'base');
    fix.commitAll('base');
    fix.g(['push', 'origin', 'main']);
  });

  afterEach(() => {
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {}
  });

  // A. CANONICAL STATE
  test('§A: CANONICAL STATE - verify canonical file unchanged until merge verified', () => {
    fix.writeFile('specs/implementation/current-milestone.json', JSON.stringify({ packages: [] }));
    fix.commitAll('init ms');
    fix.g(['push', 'origin', 'main']);

    const fileChanges = [
      {
        path: 'specs/implementation/current-milestone.json',
        content: JSON.stringify({ packages: [{ id: '1' }] }),
      },
    ];

    // REQUESTED -> BRANCH_READY
    const res = advanceStateTransition({
      fileChanges,
      message: 'chore: transition',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
      log: logSpy,
    });

    expect(res.step).toBe('BRANCH_READY');

    // verify canonical file unchanged in working dir
    const canonical = readFileSync(
      join(fix.root, 'specs/implementation/current-milestone.json'),
      'utf8',
    );
    expect(canonical).toBe(JSON.stringify({ packages: [] }));

    // origin/main unchanged
    const showOrigin = fix.g(['show', 'origin/main:specs/implementation/current-milestone.json']);
    expect(showOrigin.trim()).toBe(JSON.stringify({ packages: [] }));
  });

  // B. NON-BLOCKING
  test('§B: NON-BLOCKING - WAITING_CI returns immediately (< 100ms)', () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    let res = advanceStateTransition({
      fileChanges,
      message: 'chore',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    // BRANCH_READY
    res = advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    // BRANCH_PUSHED
    res = advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    // PR_READY

    const start = performance.now();
    for (let i = 0; i < 5; i++) {
      const iterRes = advanceStateTransition({
        receipt: res.receipt!,
        fileChanges: [],
        message: '',
        stateDir,
        repoDir: fix.root,
        ghFn: fakeGh.ghFn,
        gitFn: makeGitFn(fix),
      });
      expect(iterRes.step).toBe('WAITING_CI');
    }
    const end = performance.now();
    expect(end - start).toBeLessThan(100);
  });

  // C. CI HEAD TOCTOU
  test('§C: CI HEAD TOCTOU - drops authorization if head changes', () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    let res = advanceStateTransition({
      fileChanges,
      message: 'chore',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    }); // BRANCH_READY
    res = advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    }); // BRANCH_PUSHED
    res = advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    }); // PR_READY

    // Simulate CI GREEN on branch A
    const prNum = res.receipt!.prNumber;
    const pr = fakeGh.state.prs.get(Number(prNum));
    fakeGh.state.checkRuns.set(pr!.headRefOid, [
      {
        name: 'Verify (spec, format, lint, types, tests)',
        status: 'completed',
        conclusion: 'success',
        app_id: 15368,
      },
    ]);

    res = advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    expect(res.step).toBe('CI_AUTHORIZED');

    // Simulate branch changing to HEAD=B
    pr!.headRefOid = 'NEW_SHA_B';

    // Try to advance to MERGE_READY
    res = advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    expect(res.step).toBe('HEAD_CHANGED');
    expect(res.receipt!.authorizedHeadSha).toBeNull();
    expect(fakeGh.state.calls.prMerge.length).toBe(0);
  });

  // D. RECOVERY
  test('§D: RECOVERY - REQUESTED to BRANCH_READY', () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    const res = advanceStateTransition({
      fileChanges,
      message: 'chore',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });

    expect(res.step).toBe('BRANCH_READY');
    expect(res.receipt!.desiredFiles.length).toBeGreaterThan(0);
    expect(res.receipt!.status).toBe('BRANCH_READY');

    // D2: BRANCH_READY to BRANCH_PUSHED
    const recovered = readReceipt(stateDir, res.receipt!.transitionId);
    const res2 = advanceStateTransition({
      receipt: recovered!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    expect(res2.step).toBe('BRANCH_PUSHED');
    expect(res2.receipt!.desiredFiles.length).toBeGreaterThan(0);
  });

  // E. TRANSITION ID STABILITY
  test('§E: TRANSITION ID STABILITY - same fileChanges gives same PR after main advances', () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    const res1 = advanceStateTransition({
      fileChanges,
      message: 'chore',
      packageId: 'pkg',
      fromStatus: 'A',
      toStatus: 'B',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });

    // Advance main
    fix.writeFile('unrelated.txt', '1');
    fix.commitAll('unrelated');
    fix.g(['push', 'origin', 'main']);

    const res2 = advanceStateTransition({
      fileChanges,
      message: 'chore',
      packageId: 'pkg',
      fromStatus: 'A',
      toStatus: 'B',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });

    expect(res2.receipt!.transitionId).toBe(res1.receipt!.transitionId);
  });

  // F. STRONG LAUNCH MATCHING
  test('§F: STRONG LAUNCH MATCHING - reconcileLaunchIntentsOnStartup', () => {
    createLaunchIntent(stateDir, {
      packageId: 'P1',
      workflow: 'WF',
      branch: 'b',
      sourceSha: 'sha',
    });
    createLaunchIntent(stateDir, {
      packageId: 'P2',
      workflow: 'WF',
      branch: 'b',
      sourceSha: 'sha',
    });

    const archonRuns = [
      {
        id: 'runX',
        workflow_name: 'WF',
        user_message: 'P1',
        status: 'running',
        working_path: 'task-foresift-P1',
        started_at: new Date().toISOString(),
      },
    ];

    const { adopted, dangling } = reconcileLaunchIntentsOnStartup(stateDir, {
      archonRuns,
      log: logSpy,
    });

    expect(adopted.some((i) => i.packageId === 'P1')).toBe(true);
    expect(adopted.some((i) => i.packageId === 'P2')).toBe(false);
    expect(dangling.some((i) => i.packageId === 'P2')).toBe(true);
  });

  // G. PRODUCTION INCIDENT ROUTING
  test('§G: PRODUCTION INCIDENT ROUTING', () => {
    const cap1 = captureCiIncident({
      sha: '111',
      checkName: 'Check',
      requiredAppId: 1,
      prChangedFiles: ['packages/p/src/f.ts', 'tests/f.spec.ts'],
      cwd: fix.root,
      stateDir,
      ghFn: (args) => {
        const cmd = args.join(' ');
        if (cmd.includes('check-runs'))
          return {
            ok: true,
            stdout: JSON.stringify([
              { name: 'Check', app_id: 1, status: 'completed', conclusion: 'failure' },
            ]),
          };
        if (cmd.includes('run list'))
          return { ok: true, stdout: JSON.stringify([{ databaseId: 123, url: 'http' }]) };
        if (cmd.includes('--log-failed'))
          return { ok: true, stdout: 'FAILED GROUP\n[tests/f.spec.ts]\nat tests/f.spec.ts:1:1' };
        return { ok: true, stdout: '' };
      },
    });
    expect(cap1?.capsule.repairRoute.route).toBe('TEST_DISPUTE');

    const cap2 = captureCiIncident({
      sha: '222',
      checkName: 'Check',
      requiredAppId: 1,
      prChangedFiles: ['tests/f.spec.ts'],
      cwd: fix.root,
      stateDir,
      ghFn: (args) => {
        const cmd = args.join(' ');
        if (cmd.includes('check-runs'))
          return {
            ok: true,
            stdout: JSON.stringify([
              { name: 'Check', app_id: 1, status: 'completed', conclusion: 'failure' },
            ]),
          };
        if (cmd.includes('run list'))
          return { ok: true, stdout: JSON.stringify([{ databaseId: 123, url: 'http' }]) };
        if (cmd.includes('--log-failed'))
          return { ok: true, stdout: 'FAILED GROUP\n[tests/f.spec.ts]\nat tests/f.spec.ts:1:1' };
        return { ok: true, stdout: '' };
      },
    });
    expect(cap2?.capsule.repairRoute.route).toBe('AGY_TEST_REPAIR');
  });

  // H. ACTUAL REPAIR CONSUMER
  test('§H: ACTUAL REPAIR CONSUMER - execute and ownership', async () => {
    let invoked = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock with all fields
    const req: any = {
      requestId: 'req1',
      engine: 'CODEX',
      incidentId: '1',
      failedHeadSha: 'sha',
      route: 'CODEX_IMPLEMENTATION_REPAIR',
      status: 'PENDING',
      schema: 'foresift/repair-request@1',
      packageId: '1',
      prNumber: 1,
      baseSha: 'base',
      branch: 'branch',
      worktreeDir: 'dir',
      executionProfile: 'CODEX_AGY',
      failedFiles: [],
      prChangedFiles: [],
      allowedWritePaths: [],
      attemptCount: 1,
      newHeadSha: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistRepairRequest(stateDir, req);

    await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
      executorFn: async () => {
        invoked++;
      },
    });
    expect(req.status).toBe('WORKTREE_READY');

    await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
      executorFn: async () => {
        invoked++;
      },
    });
    expect(invoked).toBe(1);
    expect(req.status).toBe('ENGINE_INVOKED');

    // Track a file so it shows in diff
    fix.writeFile('tests/bad.spec.ts', 'base');
    fix.commitAll('base');

    // Simulate unstaged diff with test files for CODEX (which should fail ownership check)
    fix.writeFile('tests/bad.spec.ts', 'modified');

    const res = await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
      executorFn: async () => {},
    });
    expect(res.action).toBe('failed-ownership');
    expect(req.status).toBe('FAILED');
  });

  // I. DEEP STATE CLASSIFIER
  test('§I: DEEP STATE CLASSIFIER - compareMilestoneJsonSemantic', () => {
    const before = {
      schemaVersion: '1.0.0',
      packages: [{ id: '1', status: 'PENDING', generation: 0 }],
    };

    const a1 = {
      schemaVersion: '1.0.0',
      packages: [{ id: '1', status: 'RUNNING', generation: 0 }],
    };
    expect(compareMilestoneJsonSemantic(before, a1).ok).toBe(true);

    const a2 = {
      schemaVersion: '1.0.0',
      packages: [{ id: '1', status: 'PENDING', generation: 1 }],
    };
    expect(compareMilestoneJsonSemantic(before, a2).ok).toBe(true);

    const a3 = {
      schemaVersion: '2.0.0',
      packages: [{ id: '1', status: 'PENDING', generation: 0 }],
    };
    expect(compareMilestoneJsonSemantic(before, a3).ok).toBe(false);

    const a4 = {
      schemaVersion: '1.0.0',
      top: 1,
      packages: [{ id: '1', status: 'PENDING', generation: 0 }],
    };
    expect(compareMilestoneJsonSemantic(before, a4).ok).toBe(false);

    const a5 = {
      schemaVersion: '1.0.0',
      packages: [{ id: '1', status: 'UNKNOWN', generation: 0 }],
    };
    expect(compareMilestoneJsonSemantic(before, a5).ok).toBe(false);
  });

  // J. F1 UNBOUND SYMBOL
  test('§J: F1 UNBOUND SYMBOL - import foresift-autopilot.mjs successfully', async () => {
    const mod = await import('../../scripts/automation/foresift-autopilot.mjs');
    expect(mod).toBeDefined();
    const content = readFileSync(
      join(import.meta.dir, '../../scripts/automation/foresift-autopilot.mjs'),
      'utf8',
    );
    const match = content.match(/function persistMilestoneState\s*\([^)]*\)\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const funcBody = match?.[1] ?? '';
    expect(funcBody.includes('validateDirectMainPushWhitelist')).toBe(false);
  });
});
