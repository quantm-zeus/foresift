// Per-group hang containment (coordinator) + workspace cycle removal.
//
// CI 2026-08-29: two consecutive `Tests (Process & Meta-Gate Workloads)`
// attempts at merged-main 84023fa produced ZERO coordinator output for 23+
// minutes (bun group never exited; the coordinator had no per-group bound and
// printed nothing before a group completed). Not locally reproducible across
// fresh clones, 2-CPU affinity, CI env vars, and bogus-credential environments
// — containment and diagnosability are the correct engineering response:
//
//   1. The coordinator logs group identity BEFORE spawning each group, so a
//      CI log always shows exactly where execution stopped.
//   2. Every group runs under a bounded process timeout (default
//      15min + 1min/file; policy override via bunGroupTimeoutMs). A Bun
//      per-test timeout cannot bound a wedged Bun process; spawnSync's
//      timeout + detached process group kill terminates the whole tree
//      (bun workers).
//   3. GHA test-process-meta carries timeout-minutes: 45 as the final layer.
//
// Also removes the genuine packages/persistence <-> packages/object-store
// workspace dependency cycle (introduced during the Bun migration era, not by
// #90): object-store's only src usage of @foresift/persistence is
// `import type { DatabaseEngine }`, so the edge moves to devDependencies.
// pnpm warns "cyclic workspace dependencies" on every invocation and its
// modules-dir management is the most plausible wedging primitive for a
// runner-state-dependent stall; the cycle was never a runtime requirement.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBunTestPlan,
  buildGroupCommand,
  runBunTestPlan,
  systemdUserScopeAvailable,
  testMemoryBounds,
  TEST_MEMORY_HIGH_DEFAULT,
  TEST_MEMORY_MAX_DEFAULT,
} from '../../scripts/automation/bun-test-coordinator.mjs';

const REPO = process.cwd();

describe('test-runtime hang containment', () => {
  it('coordinator logs group identity before spawning each group', () => {
    const src = readFileSync(join(REPO, 'scripts/automation/bun-test-coordinator.mjs'), 'utf8');
    expect(src).toContain('`[coordinator] START ${group.id} (${group.workload})');
    // The START log must precede the group spawn in the loop body
    // (spawn seam is doSpawn since the Incident A memory-scope wrap).
    expect(src.indexOf('[coordinator] START')).toBeLessThan(src.indexOf('doSpawn(cmd, cmdArgs, {'));
  });

  it('the coordinator never wraps groups in /usr/bin/time (flaky-exit root cause)', () => {
    // GNU time -v under concurrent coordinator load provably flips bun 1.4.0
    // runs to exit 1 with "0 fail" summaries and coincided with the CI
    // process-7 group producing zero bytes for 17m (run 33325019718). The
    // wrapper is removed; evidence fields report null and the group timeout
    // still bounds the wall.
    const src = readFileSync(join(REPO, 'scripts/automation/bun-test-coordinator.mjs'), 'utf8');
    expect(src).not.toContain("existsSync('/usr/bin/time')");
    // Spawn seam is doSpawn since the Incident A memory-scope wrap: the
    // group command is either bare bun (unscoped fallback) or the
    // systemd-run scope built by buildGroupCommand — never a time wrapper.
    expect(src).toContain('doSpawn(cmd, cmdArgs, {');
    expect(src).toContain('buildGroupCommand({');
    expect(src).toContain('peakRssBytes: null');
    expect(src).toContain('cpuSeconds: null');
  });

  it('every group spawn is bounded by a process timeout that kills the tree', () => {
    const src = readFileSync(join(REPO, 'scripts/automation/bun-test-coordinator.mjs'), 'utf8');
    expect(src).toContain('timeout: timeoutMs');
    // detached => POSIX process-group kill reaches bun workers, not only the
    // direct child.
    expect(src).toContain("detached: process.platform !== 'win32'");
    expect(src).toContain('killSignal:');
    // The timeout default scales with group size and is policy-overridable.
    expect(src).toContain('bunGroupTimeoutMs');
    expect(src).toContain('15 * 60_000 + group.files.length * 60_000');
  });

  it('a timed-out group fails the run closed (signal => FAILED GROUP path)', () => {
    const src = readFileSync(join(REPO, 'scripts/automation/bun-test-coordinator.mjs'), 'utf8');
    expect(src).toContain('if (result.status !== 0 || result.signal)');
    expect(src).toContain('GROUP TIMEOUT');
    expect(src).toMatch(/timedOut: Boolean\(result\.signal\)/);
  });

  it('CI bounds the Process/Meta job itself (timeout-minutes)', () => {
    const yaml = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
    const job = yaml.slice(yaml.indexOf('  test-process-meta:'), yaml.indexOf('  test-pglite:'));
    expect(job).toContain('timeout-minutes: 45');
  });

  describe('test-runtime memory containment (Incident A, 2026-09-10)', () => {
    // Kernel OOM killed a bare `bun test <dir>` at 9.55 GiB anon RSS in a
    // tmux-spawn scope: tmux requests a TRANSIENT per-pane scope
    // (Slice=app.slice, MemoryMax=infinity) for every child pane, so panes are
    // SIBLINGS of the tmux service unit — the oom-containment.conf limits bind
    // only the tmux SERVER, never pane children. Containment therefore travels
    // WITH the command: every coordinator group runs in a bounded
    // `systemd-run --user --scope`, wherever the invoking shell lives.
    it('memory bounds default to the pane law and never exceed it', () => {
      expect(TEST_MEMORY_HIGH_DEFAULT).toBe('6G');
      expect(TEST_MEMORY_MAX_DEFAULT).toBe('8G');
      expect(testMemoryBounds()).toEqual({ high: '6G', max: '8G' });
      expect(testMemoryBounds({ testMemoryHigh: '4G', testMemoryMax: '5G' })).toEqual({
        high: '4G',
        max: '5G',
      });
      expect(
        testMemoryBounds({}, { FORESIFT_TEST_MEMORY_HIGH: '3G', FORESIFT_TEST_MEMORY_MAX: '4G' }),
      ).toEqual({ high: '3G', max: '4G' });
    });

    it('policy file pins the pane-law bounds (config evidence)', () => {
      const policy = JSON.parse(
        readFileSync(join(REPO, 'config', 'foresift-test-runtime.json'), 'utf8'),
      );
      expect(policy.testMemoryHigh).toBe('6G');
      expect(policy.testMemoryMax).toBe('8G');
    });

    it('unscoped command is the bare bun invocation (no wrapper)', () => {
      const { command, scoped, unit } = buildGroupCommand({
        bun: 'bun',
        args: ['test', 'a.spec.ts'],
        bounds: { high: '6G', max: '8G' },
        scoped: false,
        unit: 'foresift-test-x-1',
      });
      expect(scoped).toBe(false);
      expect(unit).toBeNull();
      expect(command).toEqual(['bun', 'test', 'a.spec.ts']);
    });

    it('scoped command wraps bun in a bounded user scope with a pinned unit', () => {
      const { command, scoped, unit } = buildGroupCommand({
        bun: 'bun',
        args: ['test', '--isolate', 'a.spec.ts'],
        bounds: { high: '6G', max: '8G' },
        scoped: true,
        unit: 'foresift-test-process-1-4242',
      });
      expect(scoped).toBe(true);
      expect(unit).toBe('foresift-test-process-1-4242');
      expect(command.slice(0, 8)).toEqual([
        'systemd-run',
        '--user',
        '--scope',
        '--quiet',
        '--unit=foresift-test-process-1-4242',
        '-p',
        'MemoryHigh=6G',
        '-p',
      ]);
      expect(command).toContain('MemoryMax=8G');
      expect(command).toContain('--');
      expect(command.slice(-3)).toEqual(['test', '--isolate', 'a.spec.ts']);
      expect(command[command.indexOf('--') + 1]).toBe('bun');
    });

    it('concurrency stays bounded per workload (no unbounded fan-out)', () => {
      const manifest = {
        schema: 'foresift/bun-migration-manifest@1',
        files: [
          { path: 'a.spec.ts', workload: 'PURE', state: 'MIGRATED' },
          { path: 'b.spec.ts', workload: 'PURE', state: 'MIGRATED' },
          { path: 'c.spec.ts', workload: 'PROCESS', state: 'MIGRATED' },
          { path: 'd.spec.ts', workload: 'DATABASE_PGLITE', state: 'MIGRATED' },
          { path: 'e.spec.ts', workload: 'META_GATE', state: 'MIGRATED' },
        ],
      };
      const plan = buildBunTestPlan(manifest, {});
      for (const g of plan) {
        if (g.workload === 'PURE') {
          expect(g.fileWorkers).toBeLessThanOrEqual(2);
          expect(g.testConcurrency).toBeLessThanOrEqual(8);
        } else {
          expect(g.fileWorkers).toBe(1);
          expect(g.testConcurrency).toBe(1);
        }
      }
    });

    it('runBunTestPlan scopes every group when the user bus is available', () => {
      const calls: Array<{ cmd: string; args: string[] }> = [];
      const fakeSpawn = (cmd: string, args: string[], _opts?: unknown) => {
        calls.push({ cmd, args });
        if (cmd === 'systemd-run' && args.includes('true'))
          return { status: 0, stdout: '', stderr: '' };
        return { status: 0, signal: null, stdout: '1 pass\n0 fail\n', stderr: '' };
      };
      const plan = [
        {
          id: 'process-1',
          workload: 'PROCESS',
          files: ['tests/x/a.spec.ts'],
          fileWorkers: 1,
          testConcurrency: 1,
        },
      ];
      const evidence = runBunTestPlan({
        root: REPO,
        plan,
        policy: {},
        bun: 'bun',
        spawn: fakeSpawn,
      });
      expect(evidence.ok).toBe(true);
      // first call is the scope probe; the group itself runs scoped.
      expect(calls[0].cmd).toBe('systemd-run');
      expect(calls[1].cmd).toBe('systemd-run');
      expect(calls[1].args).toContain('--scope');
      expect(calls[1].args).toContain('MemoryMax=8G');
      expect(calls[1].args).toContain('bun');
      const group = (
        evidence.results as Array<{
          memoryScoped: boolean;
          memoryBounds: unknown;
          command: string[];
        }>
      )[0];
      expect(group.memoryScoped).toBe(true);
      expect(group.memoryBounds).toEqual({ high: '6G', max: '8G' });
      expect(group.command[0]).toBe('systemd-run');
    });

    it('runBunTestPlan degrades to a direct spawn (loudly unscoped) without a user bus', () => {
      const calls: Array<{ cmd: string; args: string[] }> = [];
      const fakeSpawn = (cmd: string, args: string[], _opts?: unknown) => {
        calls.push({ cmd, args });
        // no user bus: the scope probe fails, group spawns run direct.
        if (cmd === 'systemd-run' && args.includes('true'))
          return { status: 1, stdout: '', stderr: '' };
        return { status: 0, signal: null, stdout: '1 pass\n0 fail\n', stderr: '' };
      };
      const plan = [
        {
          id: 'process-1',
          workload: 'PROCESS',
          files: ['tests/x/a.spec.ts'],
          fileWorkers: 1,
          testConcurrency: 1,
        },
      ];
      const errors: string[] = [];
      const origError = console.error;
      console.error = (...a: unknown[]) => {
        errors.push(a.map(String).join(' '));
      };
      try {
        const evidence = runBunTestPlan({
          root: REPO,
          plan,
          policy: {},
          bun: 'bun',
          spawn: fakeSpawn,
        });
        expect(evidence.ok).toBe(true);
        // probe failed (status 1) → direct bun spawn, evidence marked unscoped.
        expect(calls[1].cmd).toBe('bun');
        const group = (
          evidence.results as Array<{
            memoryScoped: boolean;
            memoryBounds: unknown;
            command: string[];
          }>
        )[0];
        expect(group.memoryScoped).toBe(false);
        expect(group.memoryBounds).toBeNull();
        expect(group.command[0]).toBe('bun');
        expect(errors.join('\n')).toContain('WITHOUT memory bounds');
      } finally {
        console.error = origError;
      }
    });

    it('systemdUserScopeAvailable is false when the probe fails or throws', () => {
      expect(systemdUserScopeAvailable(() => ({ status: 1 }))).toBe(false);
      expect(
        systemdUserScopeAvailable(() => {
          throw new Error('no bus');
        }),
      ).toBe(false);
      expect(systemdUserScopeAvailable(() => ({ status: 0 }))).toBe(true);
    });

    it('the coordinator spawn path always travels through buildGroupCommand', () => {
      const src = readFileSync(join(REPO, 'scripts/automation/bun-test-coordinator.mjs'), 'utf8');
      expect(src).toContain('buildGroupCommand({');
      expect(src).toContain('systemdUserScopeAvailable(doSpawn)');
    });
  });

  it('the workspace has no cyclic package dependency (persistence <-> object-store)', () => {
    const persistence = JSON.parse(
      readFileSync(join(REPO, 'packages/persistence/package.json'), 'utf8'),
    );
    const objectStore = JSON.parse(
      readFileSync(join(REPO, 'packages/object-store/package.json'), 'utf8'),
    );
    // object-store's runtime deps must not reach back into persistence: its
    // only use is an `import type`, served by devDependencies.
    const osRuntime = JSON.stringify(objectStore.dependencies ?? {});
    expect(osRuntime).not.toContain('@foresift/persistence');
    expect(JSON.stringify(objectStore.devDependencies ?? {})).toContain('@foresift/persistence');
    // The reverse edge stays a devDependency too (test-only usage).
    expect(JSON.stringify(persistence.dependencies ?? {})).not.toContain('@foresift/object-store');
  });
});
