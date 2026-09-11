#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_POLICY_FILE = join(
  import.meta.dirname,
  '..',
  '..',
  'config',
  'foresift-test-runtime.json',
);

function chunks(items, size) {
  const out = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

// OOM containment (Incident A, 2026-09-10): a bare `bun test <dir>` in a
// maintainer pane hit 9.55 GiB anon RSS and the kernel OOM-killed the host
// path — the pane's MemoryHigh=6G/MemoryMax=8G SHOULD have contained it but
// never applied. Root cause (journal-proven): tmux requests a TRANSIENT
// per-pane scope (`tmux-spawn-<uuid>.scope`, Slice=app.slice,
// MemoryMax=infinity) for every child pane, so pane processes are SIBLINGS
// of the tmux service unit, never members of it — the oom-containment.conf
// limits bind only the tmux SERVER (~6MB), never pane children. Containment
// therefore belongs on the COMMAND, not the shell: every coordinator group
// runs inside its own `systemd-run --user --scope` with the pane-law bounds
// below, wherever the invoking shell happens to live. Full suites run ONLY
// through the coordinator (CLAUDE.md test runtime contract), so this covers
// every sanctioned heavy invocation. Bounds mirror the pane law exactly —
// never higher (do NOT raise limits to "fix" pressure).
export const TEST_MEMORY_HIGH_DEFAULT = '6G';
export const TEST_MEMORY_MAX_DEFAULT = '8G';

export function testMemoryBounds(policy = {}, env = process.env) {
  return {
    high: env.FORESIFT_TEST_MEMORY_HIGH ?? policy.testMemoryHigh ?? TEST_MEMORY_HIGH_DEFAULT,
    max: env.FORESIFT_TEST_MEMORY_MAX ?? policy.testMemoryMax ?? TEST_MEMORY_MAX_DEFAULT,
  };
}

/**
 * Is a bounded user scope available on this host? (linux + systemd-run +
 * reachable user bus.) Probed once per coordinator run; callers fall back to
 * a direct spawn with a loud advisory when false (CI/macOS without a user
 * bus keep working, unbounded).
 */
export function systemdUserScopeAvailable(run = spawnSync) {
  try {
    const r = run('systemd-run', ['--user', '--scope', '--quiet', 'true'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Build the group command: bounded systemd-run scope when available, else
 * the bare bun invocation. Pure function of its inputs (hermetic tests pin
 * the shape without touching systemd).
 */
export function buildGroupCommand({ bun, args, bounds, scoped, unit }) {
  if (!scoped) return { command: [bun, ...args], scoped: false, unit: null };
  return {
    command: [
      'systemd-run',
      '--user',
      '--scope',
      '--quiet',
      `--unit=${unit}`,
      '-p',
      `MemoryHigh=${bounds.high}`,
      '-p',
      `MemoryMax=${bounds.max}`,
      '--',
      bun,
      ...args,
    ],
    scoped: true,
    unit,
  };
}

export function buildBunTestPlan(manifest, policy, requestedPaths = null, workloads = null) {
  const requested = requestedPaths ? new Set(requestedPaths) : null;
  const allowedWorkloads = workloads ? new Set(workloads) : null;
  const entries = manifest.files.filter(
    (entry) =>
      (!requested || requested.has(entry.path)) &&
      (!allowedWorkloads || allowedWorkloads.has(entry.workload)) &&
      ['MIGRATED', 'VERIFIED'].includes(entry.state),
  );
  const missing =
    requestedPaths?.filter((path) => !entries.some((entry) => entry.path === path)) ?? [];
  if (missing.length) throw new Error(`BUN_TEST_UNMIGRATED_REQUEST: ${missing.join(',')}`);
  const pure = entries.filter((entry) => entry.workload === 'PURE').map((entry) => entry.path);
  // PROCESS groups: pack by descending manifest-declared weight, then split
  // round-robin so the heaviest files never share one group (live 2026-09-01,
  // five process-7 GROUP TIMEOUTs on 2-core CI runners: the two heaviest spec
  // files — v2-throughput + v3-generations, ~84 tests — packed into ONE group
  // that starved at 17m while lighter groups finished in minutes; locally the
  // same pair runs in ~13s). The manifest's weight hint (optional `weight`,
  // default 1) spreads heavy files across groups deterministically — same
  // files, same grouping, every run.
  const processFiles = entries
    .filter((entry) => entry.workload === 'PROCESS')
    .sort((a, b) => Number(b.weight ?? 1) - Number(a.weight ?? 1) || a.path.localeCompare(b.path))
    .map((entry) => entry.path);
  const pglite = entries
    .filter((entry) => entry.workload === 'DATABASE_PGLITE')
    .map((entry) => entry.path);
  const meta = entries.filter((entry) => entry.workload === 'META_GATE').map((entry) => entry.path);
  const processGroups = Array.from({ length: Math.ceil(processFiles.length / 2) }, () => []);
  processFiles.forEach((path, index) => processGroups[index % processGroups.length].push(path));
  return [
    ...chunks(pure, 50).map((files, index) => ({
      id: `pure-${index + 1}`,
      workload: 'PURE',
      files,
      fileWorkers: policy.bunPureFileWorkers ?? 2,
      testConcurrency: policy.bunPureTestConcurrency ?? 8,
    })),
    ...processGroups.map((files, index) => ({
      id: `process-${index + 1}`,
      workload: 'PROCESS',
      files,
      fileWorkers: 1,
      testConcurrency: 1,
    })),
    ...chunks(pglite, 10).map((files, index) => ({
      id: `pglite-${index + 1}`,
      workload: 'DATABASE_PGLITE',
      files,
      fileWorkers: policy.bunHeavyFileWorkers ?? 1,
      testConcurrency: policy.bunHeavyTestConcurrency ?? 1,
    })),
    ...chunks(meta, 5).map((files, index) => ({
      id: `meta-${index + 1}`,
      workload: 'META_GATE',
      files,
      fileWorkers: 1,
      testConcurrency: 1,
    })),
  ];
}

export function bunTestArgs(group, policy) {
  return [
    'test',
    '--no-orphans',
    '--isolate',
    `--parallel=${group.fileWorkers}`,
    `--max-concurrency=${group.testConcurrency}`,
    `--timeout=${policy.testTimeoutMs}`,
    ...group.files,
  ];
}

function bunCounts(output) {
  const value = String(output ?? '');
  const count = (label) => {
    const matches = [...value.matchAll(new RegExp(`(?:^|\\n)\\s*(\\d+) ${label}\\b`, 'g'))];
    return matches.length ? Number(matches.at(-1)[1]) : 0;
  };
  return { passed: count('pass'), failed: count('fail'), skipped: count('skip') };
}

export function runBunTestPlan({ root, plan, policy, bun = 'bun', spawn = null }) {
  const started = Date.now();
  const results = [];
  // Memory-bounded scopes (Incident A): probe ONCE — every group inherits
  // the verdict, so the run log shows exactly one scoping decision.
  const doSpawn = spawn ?? ((cmd, cmdArgs, opts) => spawnSync(cmd, cmdArgs, opts));
  const bounds = testMemoryBounds(policy);
  const scoped = systemdUserScopeAvailable(doSpawn);
  if (!scoped)
    console.error(
      '[coordinator] no systemd user scope on this host: groups run WITHOUT memory bounds (direct spawn)',
    );
  // Per-group hard wall clock. A Bun per-test timeout cannot bound a Bun
  // process that never exits (wedged child, open handle, stdin/stdout pipe
  // stall — observed live in CI 2026-08-29 where a group produced zero bytes
  // for 23 minutes). Default scales with the largest group workload; the
  // policy file may pin bunGroupTimeoutMs.
  const policyTimeoutMs = Number(policy?.bunGroupTimeoutMs ?? 0);
  for (const group of plan) {
    const groupStarted = Date.now();
    // Emit group identity BEFORE spawning so a CI log always shows exactly
    // where execution stopped, even when the group process produces nothing.
    console.log(
      `[coordinator] START ${group.id} (${group.workload}) files=${group.files.length}: ${group.files.join(', ')}`,
    );
    const args = bunTestArgs(group, policy);
    // NO /usr/bin/time wrapper. It existed only to collect peak-RSS/CPU
    // evidence, but under concurrent coordinator load GNU time -v provably
    // corrupts the wrapped bun run's outcome: bun 1.4.0 exits 1 with
    // "0 fail" summaries (reproduced 2026-08-30 at ~2/6 coordinator runs,
    // both locally and in CI run 33325019718) and on CI the same wrapper
    // coincided with a group producing ZERO bytes for 17m before the group
    // timeout fired (process-7, run 33325019718). Without the wrapper the
    // identical coordinator loop is clean 6/6. The evidence fields are kept
    // in the schema and report null.
    const timeoutMs = policyTimeoutMs || 15 * 60_000 + group.files.length * 60_000;
    // Incident A: the group runs inside a bounded user scope (MemoryHigh/
    // MemoryMax from policy/env, pane-law defaults) wherever the invoking
    // shell lives — tmux-spawn scopes escape the tmux service's limits, so
    // the bound travels WITH the command. The unit name pins the coordinator
    // PID so concurrent coordinators never collide on one transient scope.
    // detached+process-group SIGTERM still reaches the whole tree: systemd-run
    // does not re-group its scoped child, so the timeout kill below terminates
    // bun workers exactly as before (the scope then drains and is collected).
    const scope = buildGroupCommand({
      bun,
      args,
      bounds,
      scoped,
      unit: `foresift-test-${group.id}-${process.pid}`,
    });
    const [cmd, ...cmdArgs] = scope.command;
    const result = doSpawn(cmd, cmdArgs, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMs,
      // SIGTERM the direct child; detached+POSIX kill delivers to the whole
      // process tree (bun workers) via the process group, so a wedged group
      // cannot outlive its timeout.
      detached: process.platform !== 'win32',
      killSignal: 'SIGTERM',
      env: { ...process.env, FORESIFT_TEST_COORDINATOR: '1' },
    });
    if (result.signal) {
      console.error(
        `\n[coordinator] GROUP TIMEOUT: ${group.id} (${group.workload}) exceeded ${Math.round(timeoutMs / 60_000)}m — killed via ${result.signal}.`,
      );
    }
    const evidence = {
      ...group,
      command: scope.command,
      memoryScoped: scope.scoped,
      memoryBounds: scope.scoped ? { ...bounds } : null,
      memoryUnit: scope.unit,
      status: result.status,
      signal: result.signal ?? null,
      timedOut: Boolean(result.signal),
      wallTimeMs: Date.now() - groupStarted,
      // /usr/bin/time -v was removed (see spawn comment): no wrapper output to
      // parse, so these report null. The group timeout still bounds the wall.
      peakRssBytes: null,
      cpuSeconds: null,
      counts: bunCounts(`${result.stdout ?? ''}\n${result.stderr ?? ''}`),
      stdoutTail: (result.stdout ?? '').slice(-4000),
      stderrTail: (result.stderr ?? '').slice(-4000),
    };
    results.push(evidence);
    if (result.status !== 0 || result.signal) {
      console.error(
        `\n[coordinator] FAILED GROUP: ${group.id} (${group.workload}) - files (${group.files.length}):`,
      );
      for (const f of group.files) console.error(`  - ${f}`);
      if (evidence.stdoutTail) console.error(`STDOUT TAIL:\n${evidence.stdoutTail}`);
      if (evidence.stderrTail) console.error(`STDERR TAIL:\n${evidence.stderrTail}`);
      return {
        ok: false,
        wallTimeMs: Date.now() - started,
        peakRssBytes: Math.max(0, ...results.map((entry) => entry.peakRssBytes ?? 0)),
        cpuSeconds: results.reduce((sum, entry) => sum + (entry.cpuSeconds ?? 0), 0),
        counts: results.reduce(
          (all, entry) => ({
            passed: all.passed + entry.counts.passed,
            failed: all.failed + entry.counts.failed,
            skipped: all.skipped + entry.counts.skipped,
          }),
          { passed: 0, failed: 0, skipped: 0 },
        ),
        results,
      };
    }
  }
  return {
    ok: true,
    wallTimeMs: Date.now() - started,
    peakRssBytes: Math.max(0, ...results.map((entry) => entry.peakRssBytes ?? 0)),
    cpuSeconds: results.reduce((sum, entry) => sum + (entry.cpuSeconds ?? 0), 0),
    counts: results.reduce(
      (all, entry) => ({
        passed: all.passed + entry.counts.passed,
        failed: all.failed + entry.counts.failed,
        skipped: all.skipped + entry.counts.skipped,
      }),
      { passed: 0, failed: 0, skipped: 0 },
    ),
    results,
  };
}

function cli() {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = value('--root') ?? process.cwd();
  const manifest = JSON.parse(readFileSync(value('--manifest'), 'utf8'));
  const policy = JSON.parse(readFileSync(value('--policy') ?? DEFAULT_POLICY_FILE, 'utf8'));
  const requestedPaths = value('--files')?.split(',').filter(Boolean) ?? null;
  const workloads = value('--workload')?.split(',').filter(Boolean) ?? null;
  const plan = buildBunTestPlan(manifest, policy, requestedPaths, workloads);
  if (argv.includes('--plan-only')) {
    process.stdout.write(JSON.stringify({ plan }, null, 2) + '\n');
    return;
  }
  const evidence = runBunTestPlan({ root, plan, policy, bun: value('--bun') ?? 'bun' });
  const out = value('--out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ ok: evidence.ok, groups: plan.length }) + '\n');
  process.exitCode = evidence.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('bun-test-coordinator.mjs')) cli();
