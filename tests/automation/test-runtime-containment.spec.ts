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
//      (bun workers + any /usr/bin/time wrapper).
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

const REPO = process.cwd();

describe('test-runtime hang containment', () => {
  it('coordinator logs group identity before spawning each group', () => {
    const src = readFileSync(join(REPO, 'scripts/automation/bun-test-coordinator.mjs'), 'utf8');
    expect(src).toContain('`[coordinator] START ${group.id} (${group.workload})');
    // The START log must precede the spawnSync in the loop body.
    expect(src.indexOf('[coordinator] START')).toBeLessThan(src.indexOf('spawnSync(command'));
  });

  it('every group spawn is bounded by a process timeout that kills the tree', () => {
    const src = readFileSync(join(REPO, 'scripts/automation/bun-test-coordinator.mjs'), 'utf8');
    expect(src).toContain('timeout: timeoutMs');
    // detached => POSIX process-group kill reaches bun workers and the time
    // wrapper, not only the direct child.
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
