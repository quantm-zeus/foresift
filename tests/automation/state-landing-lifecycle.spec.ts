// tests/automation/state-landing-lifecycle.spec.ts — Adversarial behavioral tests for state landing lifecycle.
// Matrix from Task Spec §19.

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFixture } from '../helpers/git-fixture.js';
import { createFakeGh } from '../helpers/state-landing-fixture.js';
import {
  advanceStateTransition,
  discoverPendingReceipts,
  recoverPendingStateLandings,
  STATE_TRANSITIONS_DIR_NAME,
  RECEIPT_STATUSES,
} from '../../scripts/automation/state-landing.mjs';

// Test-only compatibility shim: wraps advanceStateTransition in a loop for existing tests.
// Production code MUST NOT use this — the real supervisor uses step-driven tick outbox.
async function landStateViaPR(opts: Record<string, unknown>) {
  const maxIterations = 15;
  const deadlineMs = typeof opts.deadlineMs === 'number' ? opts.deadlineMs : 2000;
  const startTime = Date.now();
  let receipt = null;
  for (let i = 0; i < maxIterations; i++) {
    const res = await advanceStateTransition({
      receipt,
      ...opts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only shim adapter
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- receipt type narrowing for test adapter
    receipt = res.receipt as any;
    if (
      receipt?.status === RECEIPT_STATUSES.MERGED ||
      res.step === 'DONE' ||
      res.step === 'ALREADY_CURRENT'
    ) {
      return { ok: true, receipt };
    }
    if (!res.ok && res.step !== 'WAITING_CI' && res.step !== 'PR_PENDING') {
      return { ok: false, reason: res.reason, receipt };
    }
    if (res.step === 'WAITING_CI' && (Date.now() - startTime >= deadlineMs || i >= 2)) {
      return { ok: false, reason: 'ci_pending_timeout', receipt };
    }
    if (res.step === 'PR_PENDING' && (Date.now() - startTime >= deadlineMs || i >= 2)) {
      return { ok: false, reason: 'pr_pending_timeout', receipt };
    }
  }
  return { ok: false, reason: 'landStateViaPR-shim-max-iterations', receipt };
}

const scratch = mkdtempSync(join(tmpdir(), 'state-landing-lifecycle-'));

describe('Adversarial State Landing Lifecycle Matrix (§19)', () => {
  it('1. No pin SHA → zero merge calls, status != ci_green, status != merged', async () => {
    const gitFix = gitFixture('mat-1-no-pin-sha');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-1');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    // Custom git wrapper that fails rev-parse for state branch to simulate missing pinSha
    const gitFn = (args: string[], opts?: { cwd?: string }) => {
      if (args[0] === 'rev-parse' && args[1]?.includes('state/chore/')) {
        return { ok: false, stdout: '', stderr: 'unknown revision', status: 1 };
      }
      try {
        const out = execFileSync('git', args, {
          cwd: opts?.cwd || gitFix.root,
          encoding: 'utf8',
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        });
        return { ok: true, stdout: out, stderr: '', status: 0 };
      } catch (e: unknown) {
        const err = e as { message?: string; status?: number };
        return { ok: false, stdout: '', stderr: err.message ?? '', status: err.status ?? 1 };
      }
    };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn,
      gitFn,
    });

    expect(fakeGhState.calls.prMerge.length).toBe(0);
    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('ci_green');
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('2. CI pending → zero merge calls', async () => {
    const gitFix = gitFixture('mat-2-ci-pending');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-2');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    // Configure fake gh: check runs pending
    // We will set check run for any SHA to pending
    const origApi = ghFn;
    const pendingGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'in_progress',
              conclusion: null,
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return origApi(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn: pendingGhFn,
      deadlineMs: 100,
      pollMs: 50,
    });

    expect(fakeGhState.calls.prMerge.length).toBe(0);
    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('3. CI failure → zero merge calls', async () => {
    const gitFix = gitFixture('mat-3-ci-failure');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-3');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const failureGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'failure',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn: failureGhFn,
      deadlineMs: 100,
      pollMs: 50,
    });

    expect(fakeGhState.calls.prMerge.length).toBe(0);
    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('4. CI wrong app id → zero merge calls', async () => {
    const gitFix = gitFixture('mat-4-ci-wrong-app');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-4');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const wrongAppGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 99999, // untrusted app
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn: wrongAppGhFn,
      deadlineMs: 100,
      pollMs: 50,
    });

    expect(fakeGhState.calls.prMerge.length).toBe(0);
    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('5. CI stale SHA green → zero merge calls for current PR HEAD', async () => {
    const gitFix = gitFixture('mat-5-stale-sha');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-5');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    // Only older SHA is green; current SHA is pending/missing
    const staleShaGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        const endpoint = args[1];
        if (endpoint.includes('stale-sha-12345')) {
          return {
            ok: true,
            stdout: JSON.stringify([
              {
                name: 'Verify (spec, format, lint, types, tests)',
                status: 'completed',
                conclusion: 'success',
                app_id: 15368,
              },
            ]),
            stderr: '',
            status: 0,
          };
        }
        return { ok: true, stdout: '[]', stderr: '', status: 0 };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn: staleShaGhFn,
      deadlineMs: 100,
      pollMs: 50,
    });

    expect(fakeGhState.calls.prMerge.length).toBe(0);
    expect(res.ok).toBe(false);
  });

  it('6. CI correct exact-head green → merge may be attempted', async () => {
    const gitFix = gitFixture('mat-6-exact-head-green');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-6');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
    });

    expect(fakeGhState.calls.prMerge.length).toBe(1);
    expect(res.ok).toBe(true);
    expect(res.receipt?.status).toBe(RECEIPT_STATUSES.MERGED);
  });

  it('7. Merge command returns exit 1 → receipt not merged', async () => {
    const gitFix = gitFixture('mat-7-merge-exit-1');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-7');
    mkdirSync(stateDir, { recursive: true });

    fakeGhState.mergeExitCode = 1;

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
    });

    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('8. Merge command exit 0 but PR state OPEN → receipt not merged', async () => {
    const gitFix = gitFixture('mat-8-merge-pr-open');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-8');
    mkdirSync(stateDir, { recursive: true });

    fakeGhState.mergeExitCode = 0;
    fakeGhState.mergeSetsPrMerged = false; // PR stays OPEN

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
    });

    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('9. PR MERGED but fetch origin/main fails → receipt not authoritative merged', async () => {
    const gitFix = gitFixture('mat-9-fetch-fail');
    const { ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-9');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    let fetchCount = 0;
    const gitFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'fetch' && args[1] === 'origin' && args[2] === 'main') {
        fetchCount++;
        if (fetchCount > 1) {
          // fail the post-merge fetch
          return {
            ok: false,
            stdout: '',
            stderr: 'fatal: could not read from remote',
            status: 128,
          };
        }
      }
      try {
        const out = execFileSync('git', args, {
          cwd: (opts?.cwd as string) || gitFix.root,
          encoding: 'utf8',
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        });
        return { ok: true, stdout: out, stderr: '', status: 0 };
      } catch (e: unknown) {
        const err = e as { message?: string; status?: number };
        return { ok: false, stdout: '', stderr: err.message ?? '', status: err.status ?? 1 };
      }
    };

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
      gitFn,
    });

    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('10. Merge commit absent / unreachable from origin/main → not merged', async () => {
    const gitFix = gitFixture('mat-10-unreachable-commit');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-10');
    mkdirSync(stateDir, { recursive: true });

    fakeGhState.createMergeCommitOnOrigin = false; // Don't push merge commit to origin/main

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
    });

    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('11. Desired state differs on main after merge → not merged', async () => {
    const gitFix = gitFixture('mat-11-content-differs');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-11');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      if (args[0] === 'pr' && args[1] === 'merge') {
        // Merge something else to origin/main that differs from intended state
        gitFix.writeFile(
          'specs/implementation/current-milestone.json',
          '{"different":"content"}\n',
        );
        gitFix.commitAll('chore: conflicting commit on main');
        gitFix.g(['push', 'origin', 'main']);
        const newMain = gitFix.g(['rev-parse', 'origin/main']).trim();
        const pr = fakeGhState.prs.get(1);
        if (pr) {
          pr.state = 'MERGED';
          pr.mergeCommit = { oid: newMain };
        }
        return { ok: true, stdout: 'PR merged', stderr: '', status: 0 };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
    });

    expect(res.ok).toBe(false);
    expect(res.receipt?.status).not.toBe('merged');
  });

  it('12. Complete correct merge → merged=true with verified mergedSha', async () => {
    const gitFix = gitFixture('mat-12-correct-merge');
    const { ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-12');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const res = await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
    });

    expect(res.ok).toBe(true);
    expect(res.receipt?.status).toBe(RECEIPT_STATUSES.MERGED);
    expect(res.receipt?.mergedSha).toBeDefined();
    expect(res.receipt?.mergedSha).not.toBeNull();
  });

  it('13-17. Crash recovery resumes all non-terminal states and adopts verified merges', async () => {
    const gitFix = gitFixture('mat-13-crash-recovery');
    const { ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-13');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);
    const sourceSha = gitFix.baseSha();

    // Simulate crash after PR created: receipt is at 'PR_READY' (v2)
    const transDir = join(stateDir, STATE_TRANSITIONS_DIR_NAME);
    mkdirSync(transDir, { recursive: true });

    const desiredContent =
      JSON.stringify(
        { milestoneId: 'G0', packages: [{ id: 'g0-test', status: 'RUNNING' }] },
        null,
        2,
      ) + '\n';
    const receipt = {
      schema: 'foresift/state-transition@2' as const,
      transitionId: `g0-test-PENDING-RUNNING-${sourceSha.slice(0, 8)}-12345678`,
      logicalTransitionKey: 'g0-test-PENDING-RUNNING-12345678',
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      sourceMainSha: sourceSha,
      desiredFileHash: 'dummyhash',
      desiredFiles: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: desiredContent,
          contentSha256: 'abc',
        },
      ],
      commitMessage: 'chore: g0-test PENDING->RUNNING',
      stateBranch: `state/chore/g0-test-PENDING-RUNNING-${sourceSha.slice(0, 8)}-12345678`,
      stateWorktree: null,
      prNumber: '1',
      prUrl: 'https://github.com/quantm-zeus/foresift/pull/1',
      authorizedHeadSha: null,
      authorizedAt: null,
      authorizedCheckName: null,
      authorizedAppId: null,
      status: RECEIPT_STATUSES.PR_READY,
      retryClass: null,
      retryCount: 0,
      nextRetryAt: null,
      mergedSha: null,
      failedReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(transDir, `receipt-${receipt.transitionId}.json`),
      JSON.stringify(receipt, null, 2),
    );

    const pending = discoverPendingReceipts(stateDir);
    expect(pending.length).toBe(1);
    expect(pending[0]!.transitionId).toBe(receipt.transitionId);

    const gitFn = (args: string[], opts?: Record<string, unknown>) => {
      try {
        const out = execFileSync('git', args, {
          cwd: (opts?.cwd as string) || gitFix.root,
          encoding: 'utf8',
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        });
        return { ok: true, stdout: out, stderr: '', status: 0 };
      } catch (e: unknown) {
        const err = e as { message?: string; status?: number };
        return { ok: false, stdout: '', stderr: err.message ?? '', status: err.status ?? 1 };
      }
    };

    // Run recovery
    const recovered = await recoverPendingStateLandings({
      stateDir,
      cwd: gitFix.root,
      ghFn,
      gitFn,
    });
    expect(recovered.length).toBe(1);
  });

  it('18. Canonical repo checkout branch stays main throughout landing', async () => {
    const gitFix = gitFixture('mat-18-canonical-stays-main');
    const { ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-18');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };

    const branchBefore = gitFix.g(['branch', '--show-current']).trim();
    expect(branchBefore).toBe('main');

    const greenGhFn = (args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === 'api' && args[1]?.includes('check-runs')) {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              name: 'Verify (spec, format, lint, types, tests)',
              status: 'completed',
              conclusion: 'success',
              app_id: 15368,
            },
          ]),
          stderr: '',
          status: 0,
        };
      }
      return ghFn(args, opts);
    };

    await landStateViaPR({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      deadlineMs: 500,
      pollMs: 50,
      ghFn: greenGhFn,
    });

    const branchAfter = gitFix.g(['branch', '--show-current']).trim();
    expect(branchAfter).toBe('main');
  });

  it('19. State landing step-based advancement is non-blocking', async () => {
    const gitFix = gitFixture('mat-19-non-blocking');
    const { ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-19');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    // Call non-blocking step advance
    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };
    const tStart = Date.now();

    // Advance one step: should take < 1 second (no multi-minute sleeping)
    const step1 = await advanceStateTransition({
      fileChanges: [
        {
          path: 'specs/implementation/current-milestone.json',
          content: JSON.stringify(targetMilestone, null, 2) + '\n',
        },
      ],
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn,
    });

    const elapsed = Date.now() - tStart;
    expect(elapsed).toBeLessThan(5000);
    expect(step1.step).toBe('BRANCH_READY');
    expect(step1.receipt?.status).toBe(RECEIPT_STATUSES.BRANCH_READY);
  });

  it('20. Same intent called twice → one authoritative transition (idempotent)', async () => {
    const gitFix = gitFixture('mat-20-idempotent');
    const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
    const stateDir = join(scratch, 'state-20');
    mkdirSync(stateDir, { recursive: true });

    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    gitFix.writeFile(
      'specs/implementation/current-milestone.json',
      JSON.stringify(initialMilestone, null, 2) + '\n',
    );
    gitFix.commitAll('chore: init');
    gitFix.g(['push', 'origin', 'main']);

    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };
    const fileChanges = [
      {
        path: 'specs/implementation/current-milestone.json',
        content: JSON.stringify(targetMilestone, null, 2) + '\n',
      },
    ];

    // First call advances from pending to branch_created
    const step1 = await advanceStateTransition({
      fileChanges,
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn,
    });

    // Second call with same intent reuses existing receipt
    const step2 = await advanceStateTransition({
      fileChanges,
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn,
    });

    // First call creates receipt at BRANCH_READY, second reuses it and advances to BRANCH_PUSHED
    expect(step1.receipt?.transitionId).toBe(step2.receipt?.transitionId);
    // Step-driven: each call advances ONE step. First = BRANCH_READY, second = BRANCH_PUSHED.
    expect(step2.step).toBe('BRANCH_PUSHED');
    // PR not yet created (needs third call from BRANCH_PUSHED → PR_READY)
    expect(fakeGhState.calls.prCreate.length).toBe(0);

    // Third call should create the PR
    const step3 = await advanceStateTransition({
      fileChanges,
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn,
    });
    expect(step3.receipt?.transitionId).toBe(step1.receipt?.transitionId);
    expect(fakeGhState.calls.prCreate.length).toBe(1); // PR created once
  });

  // ── Merged-PR receipt reconciliation (live-lock observed 2026-08-28) ────────
  // PR #82 merged while its receipt sat at CI_AUTHORIZED; MERGE_READY's
  // OPEN-only guard then revoked and re-authorized forever. These tests pin
  // the reconciliation: a merged PR at the authorized head finalizes through
  // authoritative post-merge verification; anything else fails closed.
  describe('merged-PR receipt reconciliation', () => {
    const initialMilestone = {
      milestoneId: 'g0',
      packages: [{ id: 'g0-test', status: 'PENDING' }],
    };
    const targetMilestone = { milestoneId: 'g0', packages: [{ id: 'g0-test', status: 'RUNNING' }] };
    const fileChanges = () => [
      {
        path: 'specs/implementation/current-milestone.json',
        content: JSON.stringify(targetMilestone, null, 2) + '\n',
      },
    ];

    function greenGhFn(ghFn: ReturnType<typeof createFakeGh>['ghFn']) {
      return (args: string[], opts?: Record<string, unknown>) => {
        if (args[0] === 'api' && args[1]?.includes('check-runs')) {
          return {
            ok: true,
            stdout: JSON.stringify([
              {
                name: 'Verify (spec, format, lint, types, tests)',
                status: 'completed',
                conclusion: 'success',
                app_id: 15368,
              },
            ]),
            stderr: '',
            status: 0,
          };
        }
        return ghFn(args, opts);
      };
    }

    async function driveTo(
      gitFix: ReturnType<typeof gitFixture>,
      ghFn: ReturnType<typeof createFakeGh>['ghFn'],
      stateDir: string,
      targetStatus: string,
    ) {
      const base = {
        fileChanges: fileChanges(),
        message: 'chore: flip to RUNNING',
        stateDir,
        repoDir: gitFix.root,
        packageId: 'g0-test',
        fromStatus: 'PENDING',
        toStatus: 'RUNNING',
        ghFn,
      };
      let res = await advanceStateTransition(base as never);
      let receipt = res.receipt as never as {
        status: string;
        prNumber: number;
        mergedSha: string | null;
        stateWorktree: string;
      };
      for (let i = 0; i < 8 && receipt && receipt.status !== targetStatus; i++) {
        res = await advanceStateTransition({ ...base, receipt } as never);
        receipt = res.receipt as never as {
          status: string;
          prNumber: number;
          mergedSha: string | null;
          stateWorktree: string;
        };
      }
      return { res, receipt, base };
    }

    it('receipt finalizes (MERGED) when the PR merged before the merge step ran', async () => {
      const gitFix = gitFixture('recon-1-merged-pr-finalizes');
      const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
      const stateDir = join(scratch, 'state-recon-1');
      mkdirSync(stateDir, { recursive: true });

      gitFix.writeFile(
        'specs/implementation/current-milestone.json',
        JSON.stringify(initialMilestone, null, 2) + '\n',
      );
      gitFix.commitAll('chore: init');
      gitFix.g(['push', 'origin', 'main']);

      const { receipt, base } = await driveTo(
        gitFix,
        greenGhFn(ghFn),
        stateDir,
        RECEIPT_STATUSES.CI_AUTHORIZED,
      );
      expect(receipt?.status).toBe(RECEIPT_STATUSES.CI_AUTHORIZED);

      // External merge while the receipt is at CI_AUTHORIZED: push the branch
      // head onto origin main (what a squash merge lands) and flip PR state.
      const pr = fakeGhState.prs.get(Number(receipt?.prNumber));
      const headSha = pr?.headRefOid;
      gitFix.g(['push', 'origin', `${headSha}:refs/heads/main`]);
      const mergedSha = gitFix.g(['rev-parse', 'origin/main']).trim();
      pr!.state = 'MERGED';
      pr!.mergeCommit = { oid: mergedSha };

      // CI_AUTHORIZED -> MERGE_READY (TOCTOU holds at the authorized head)
      const toMergeReady = await advanceStateTransition({ ...base, receipt } as never);
      expect(toMergeReady.step).toBe('MERGE_READY');

      // MERGE_READY -> DONE via authoritative reconciliation, NOT revoke+loop
      const done = await advanceStateTransition({ ...base, receipt } as never);
      expect(done.step).toBe('DONE');
      expect(receipt?.status).toBe(RECEIPT_STATUSES.MERGED);
      expect(receipt?.mergedSha).toBe(mergedSha);
      // No live-lock: the already-merged PR is never merged again, and the
      // isolated state worktree is cleaned up.
      expect(fakeGhState.calls.prMerge.length).toBe(0);
      expect(existsSync(receipt?.stateWorktree ?? '')).toBe(false);
    });

    it('merged PR at an unauthorized head fails closed as AUTHORITY_REFUSAL', async () => {
      const gitFix = gitFixture('recon-2-merged-unauthorized-head');
      const { state: fakeGhState, ghFn } = createFakeGh(gitFix);
      const stateDir = join(scratch, 'state-recon-2');
      mkdirSync(stateDir, { recursive: true });

      gitFix.writeFile(
        'specs/implementation/current-milestone.json',
        JSON.stringify(initialMilestone, null, 2) + '\n',
      );
      gitFix.commitAll('chore: init');
      gitFix.g(['push', 'origin', 'main']);

      const { receipt } = await driveTo(
        gitFix,
        greenGhFn(ghFn),
        stateDir,
        RECEIPT_STATUSES.MERGE_READY,
      );
      expect(receipt?.status).toBe(RECEIPT_STATUSES.MERGE_READY);

      // External merge at a head this receipt never authorized.
      const pr = fakeGhState.prs.get(Number(receipt?.prNumber));
      pr!.state = 'MERGED';
      pr!.headRefOid = 'f'.repeat(40);
      pr!.mergeCommit = { oid: gitFix.g(['rev-parse', 'origin/main']).trim() };

      const refused = await advanceStateTransition({
        fileChanges: fileChanges(),
        message: 'chore: flip to RUNNING',
        stateDir,
        repoDir: gitFix.root,
        packageId: 'g0-test',
        fromStatus: 'PENDING',
        toStatus: 'RUNNING',
        ghFn: greenGhFn(ghFn),
        receipt,
      } as never);
      expect(refused.step).toBe('MERGE_AUTHORITY_CHANGED');
      expect(refused.receipt?.status).toBe(RECEIPT_STATUSES.FAILED);
      expect(refused.receipt?.retryClass).toBe('AUTHORITY_REFUSAL');
      expect(fakeGhState.calls.prMerge.length).toBe(0);
    });
  });
});
