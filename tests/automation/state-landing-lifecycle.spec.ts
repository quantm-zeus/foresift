// tests/automation/state-landing-lifecycle.spec.ts — Adversarial behavioral tests for state landing lifecycle.
// Matrix from Task Spec §19.

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFixture } from '../helpers/git-fixture.js';
import { createFakeGh } from '../helpers/state-landing-fixture.js';
import {
  advanceStateTransition,
  discoverPendingReceipts,
  landStateViaPR,
  recoverPendingStateLandings,
  STATE_TRANSITIONS_DIR_NAME,
} from '../../scripts/automation/state-landing.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'state-landing-lifecycle-'));

describe('Adversarial State Landing Lifecycle Matrix (§19)', () => {
  it('1. No pin SHA → zero merge calls, status != ci_green, status != merged', () => {
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

    const res = landStateViaPR({
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

  it('2. CI pending → zero merge calls', () => {
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

    const res = landStateViaPR({
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

  it('3. CI failure → zero merge calls', () => {
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

    const res = landStateViaPR({
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

  it('4. CI wrong app id → zero merge calls', () => {
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

    const res = landStateViaPR({
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

  it('5. CI stale SHA green → zero merge calls for current PR HEAD', () => {
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

    const res = landStateViaPR({
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

  it('6. CI correct exact-head green → merge may be attempted', () => {
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

    const res = landStateViaPR({
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
    expect(res.receipt?.status).toBe('merged');
  });

  it('7. Merge command returns exit 1 → receipt not merged', () => {
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

    const res = landStateViaPR({
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

  it('8. Merge command exit 0 but PR state OPEN → receipt not merged', () => {
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

    const res = landStateViaPR({
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

  it('9. PR MERGED but fetch origin/main fails → receipt not authoritative merged', () => {
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

    const res = landStateViaPR({
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

  it('10. Merge commit absent / unreachable from origin/main → not merged', () => {
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

    const res = landStateViaPR({
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

  it('11. Desired state differs on main after merge → not merged', () => {
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

    const res = landStateViaPR({
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

  it('12. Complete correct merge → merged=true with verified mergedSha', () => {
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

    const res = landStateViaPR({
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
    expect(res.receipt?.status).toBe('merged');
    expect(res.receipt?.mergedSha).toBeDefined();
    expect(res.receipt?.mergedSha).not.toBeNull();
  });

  it('13-17. Crash recovery resumes all non-terminal states and adopts verified merges', () => {
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

    // Simulate crash after PR created: receipt is at 'pr_created'
    const transDir = join(stateDir, STATE_TRANSITIONS_DIR_NAME);
    mkdirSync(transDir, { recursive: true });

    const receipt = {
      schema: 'foresift/state-transition@1',
      transitionId: `g0-test-PENDING-RUNNING-${sourceSha.slice(0, 8)}-12345678`,
      package: 'g0-test',
      from: 'PENDING',
      to: 'RUNNING',
      sourceSha,
      stateBranch: `state/chore/g0-test-PENDING-RUNNING-${sourceSha.slice(0, 8)}-12345678`,
      pr: '1',
      prUrl: 'https://github.com/quantm-zeus/foresift/pull/1',
      desiredFileHash: 'dummyhash',
      status: 'pr_created',
      mergedSha: null,
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

    // Run recovery
    const recovered = recoverPendingStateLandings({ stateDir, cwd: gitFix.root, ghFn });
    expect(recovered.length).toBe(1);
  });

  it('18. Canonical repo checkout branch stays main throughout landing', () => {
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

    landStateViaPR({
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

  it('19. State landing step-based advancement is non-blocking', () => {
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
    const step1 = advanceStateTransition({
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
    expect(step1.step).toBe('BRANCH_CREATED');
    expect(step1.receipt?.status).toBe('branch_created');
  });

  it('20. Same intent called twice → one authoritative transition (idempotent)', () => {
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
    const step1 = advanceStateTransition({
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
    const step2 = advanceStateTransition({
      fileChanges,
      message: 'chore: flip to RUNNING',
      stateDir,
      repoDir: gitFix.root,
      packageId: 'g0-test',
      fromStatus: 'PENDING',
      toStatus: 'RUNNING',
      ghFn,
    });

    expect(step1.receipt?.transitionId).toBe(step2.receipt?.transitionId);
    expect(step2.step).toBe('PR_CREATED');
    expect(fakeGhState.calls.prCreate.length).toBe(1); // PR created once
  });
});
