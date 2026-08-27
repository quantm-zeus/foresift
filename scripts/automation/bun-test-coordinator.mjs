#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const processFiles = entries
    .filter((entry) => entry.workload === 'PROCESS')
    .map((entry) => entry.path);
  const pglite = entries
    .filter((entry) => entry.workload === 'DATABASE_PGLITE')
    .map((entry) => entry.path);
  const meta = entries.filter((entry) => entry.workload === 'META_GATE').map((entry) => entry.path);
  return [
    ...chunks(pure, 50).map((files, index) => ({
      id: `pure-${index + 1}`,
      workload: 'PURE',
      files,
      fileWorkers: policy.bunPureFileWorkers ?? 2,
      testConcurrency: policy.bunPureTestConcurrency ?? 8,
    })),
    ...chunks(processFiles, 6).map((files, index) => ({
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

function maxRss(stderr) {
  const match = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(stderr ?? '');
  return match ? Number(match[1]) * 1024 : null;
}

function cpuSeconds(stderr) {
  const user = /User time \(seconds\):\s*([\d.]+)/.exec(stderr ?? '');
  const system = /System time \(seconds\):\s*([\d.]+)/.exec(stderr ?? '');
  return user && system ? Number(user[1]) + Number(system[1]) : null;
}

function bunCounts(output) {
  const value = String(output ?? '');
  const count = (label) => {
    const matches = [...value.matchAll(new RegExp(`(?:^|\\n)\\s*(\\d+) ${label}\\b`, 'g'))];
    return matches.length ? Number(matches.at(-1)[1]) : 0;
  };
  return { passed: count('pass'), failed: count('fail'), skipped: count('skip') };
}

export function runBunTestPlan({ root, plan, policy, bun = 'bun' }) {
  const started = Date.now();
  const results = [];
  for (const group of plan) {
    const groupStarted = Date.now();
    const args = bunTestArgs(group, policy);
    const timed = existsSync('/usr/bin/time');
    const command = timed ? '/usr/bin/time' : bun;
    const commandArgs = timed ? ['-v', bun, ...args] : args;
    const result = spawnSync(command, commandArgs, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, FORESIFT_TEST_COORDINATOR: '1' },
    });
    const evidence = {
      ...group,
      command: [bun, ...args],
      status: result.status,
      wallTimeMs: Date.now() - groupStarted,
      peakRssBytes: maxRss(result.stderr),
      cpuSeconds: cpuSeconds(result.stderr),
      counts: bunCounts(`${result.stdout ?? ''}\n${result.stderr ?? ''}`),
      stdoutTail: (result.stdout ?? '').slice(-4000),
      stderrTail: (result.stderr ?? '').slice(-4000),
    };
    results.push(evidence);
    if (result.status !== 0) {
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
