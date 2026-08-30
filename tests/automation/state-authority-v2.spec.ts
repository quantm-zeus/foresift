import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
  test('§A: CANONICAL STATE - verify canonical file unchanged until merge verified', async () => {
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
    const res = await advanceStateTransition({
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
  test('§B: NON-BLOCKING - WAITING_CI returns immediately (< 100ms)', async () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    let res = await advanceStateTransition({
      fileChanges,
      message: 'chore',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    // BRANCH_READY
    res = await advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    });
    // BRANCH_PUSHED
    res = await advanceStateTransition({
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
      const iterRes = await advanceStateTransition({
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
  test('§C: CI HEAD TOCTOU - drops authorization if head changes', async () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    let res = await advanceStateTransition({
      fileChanges,
      message: 'chore',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    }); // BRANCH_READY
    res = await advanceStateTransition({
      receipt: res.receipt!,
      fileChanges: [],
      message: '',
      stateDir,
      repoDir: fix.root,
      ghFn: fakeGh.ghFn,
      gitFn: makeGitFn(fix),
    }); // BRANCH_PUSHED
    res = await advanceStateTransition({
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

    res = await advanceStateTransition({
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
    res = await advanceStateTransition({
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
  test('§D: RECOVERY - REQUESTED to BRANCH_READY', async () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    const res = await advanceStateTransition({
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
    const res2 = await advanceStateTransition({
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
  test('§E: TRANSITION ID STABILITY - same fileChanges gives same PR after main advances', async () => {
    fix.writeFile('specs/implementation/current-milestone.json', '{}');
    fix.commitAll('init');
    fix.g(['push', 'origin', 'main']);
    const fileChanges = [
      { path: 'specs/implementation/current-milestone.json', content: '{"a": 1}' },
    ];

    const res1 = await advanceStateTransition({
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

    const res2 = await advanceStateTransition({
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
  test('§F: STRONG LAUNCH MATCHING - reconcileLaunchIntentsOnStartup', async () => {
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
  test('§G: PRODUCTION INCIDENT ROUTING', async () => {
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
  test('§H: ACTUAL REPAIR CONSUMER - execute and ownership violation', async () => {
    const branch = 'foresift/task-pkg-repair';
    fix.g(['checkout', '-b', branch]);
    fix.writeFile('packages/core/src/service.ts', 'export const a = 1;');
    fix.commitAll('initial failed commit');
    const failedHeadSha = fix.g(['rev-parse', 'HEAD']).trim();
    fix.g(['push', '-u', 'origin', branch]);
    fix.g(['checkout', 'main']);

    let invoked = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock with all fields
    const req: any = {
      requestId: 'req1',
      engine: 'CODEX',
      incidentId: '1',
      failedHeadSha,
      route: 'CODEX_IMPLEMENTATION_REPAIR',
      status: 'PENDING',
      schema: 'foresift/repair-request@1',
      packageId: 'pkg-repair',
      prNumber: 1,
      baseSha: failedHeadSha,
      branch,
      worktreeDir: null,
      executionProfile: 'CODEX_AGY',
      failedFiles: ['packages/core/src/service.ts'],
      prChangedFiles: ['packages/core/src/service.ts'],
      allowedWritePaths: ['packages/**'],
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
        // Write to a test file (ownership violation for CODEX) and commit
        const testFile = join(req.worktreeDir, 'tests', 'bad.spec.ts');
        mkdirSync(join(req.worktreeDir, 'tests'), { recursive: true });
        writeFileSync(testFile, 'test');
        execFileSync('git', ['add', 'tests/bad.spec.ts'], { cwd: req.worktreeDir });
        execFileSync(
          'git',
          ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'bad test commit'],
          { cwd: req.worktreeDir },
        );
      },
    });
    expect(invoked).toBe(1);
    expect(req.status).toBe('ENGINE_INVOKED');

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

  test('§H2: ACTUAL REPAIR CONSUMER - successful full lifecycle', async () => {
    const branch = 'foresift/task-pkg-good';
    fix.g(['checkout', '-b', branch]);
    fix.writeFile('packages/core/src/service.ts', 'export const a = 1;');
    fix.commitAll('failed commit');
    const failedHeadSha = fix.g(['rev-parse', 'HEAD']).trim();
    fix.g(['push', '-u', 'origin', branch]);
    fix.g(['checkout', 'main']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock with all fields
    const req: any = {
      requestId: 'req2',
      engine: 'CODEX',
      incidentId: '2',
      failedHeadSha,
      route: 'CODEX_IMPLEMENTATION_REPAIR',
      status: 'PENDING',
      schema: 'foresift/repair-request@1',
      packageId: 'pkg-good',
      prNumber: 2,
      baseSha: failedHeadSha,
      branch,
      worktreeDir: null,
      executionProfile: 'CODEX_AGY',
      failedFiles: ['packages/core/src/service.ts'],
      prChangedFiles: ['packages/core/src/service.ts'],
      allowedWritePaths: ['packages/**'],
      attemptCount: 1,
      newHeadSha: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistRepairRequest(stateDir, req);

    // PENDING -> WORKTREE_READY
    let res = await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
    });
    expect(res.action).toBe('prepared-worktree');
    expect(req.status).toBe('WORKTREE_READY');

    // WORKTREE_READY -> ENGINE_INVOKED
    res = await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
      executorFn: async () => {
        writeFileSync(join(req.worktreeDir, 'packages/core/src/service.ts'), 'export const a = 2;');
        execFileSync('git', ['add', 'packages/core/src/service.ts'], { cwd: req.worktreeDir });
        execFileSync(
          'git',
          ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'fix(core): valid fix'],
          { cwd: req.worktreeDir },
        );
      },
    });
    expect(res.action).toBe('invoked-engine');
    expect(req.status).toBe('ENGINE_INVOKED');

    // ENGINE_INVOKED -> OWNERSHIP_VERIFIED
    res = await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
    });
    expect(res.action).toBe('verified-ownership');
    expect(req.status).toBe('OWNERSHIP_VERIFIED');

    // OWNERSHIP_VERIFIED -> COMMITTED
    res = await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
    });
    expect(res.action).toBe('committed');
    expect(req.status).toBe('COMMITTED');

    // COMMITTED -> PUSHED
    res = await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
    });
    expect(res.action).toBe('pushed');
    expect(req.status).toBe('PUSHED');

    // PUSHED -> COMPLETE
    res = await advanceRepairRequest({
      request: req,
      stateDir,
      repoDir: fix.root,
      log: logSpy,
    });
    expect(res.action).toBe('completed');
    expect(req.status).toBe('COMPLETE');
  });

  // I. DEEP STATE CLASSIFIER
  test('§I: DEEP STATE CLASSIFIER - compareMilestoneJsonSemantic', async () => {
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
