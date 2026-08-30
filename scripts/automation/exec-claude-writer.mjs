// Headless Claude implementation-lane executor for CLAUDE_AGY fallback waves
// and HYBRID low-tier lanes (Hyperdrive H2 §2/§10).
//
// ONE ACTUAL CLAUDE PROVIDER INVOCATION = ONE CLAUDE LANE PERMIT. The lane
// permit is acquired immediately before `claude --print` is dispatched and
// released in a finally-equivalent path after the process terminates —
// covering success, failure, timeout, and cancellation alike (spawnSync is
// the single blocking call, so every exit path flows through the release).
// Claude pressure/health is attributed ONLY to the Claude pool (§5/§6): a
// Claude 429 must never throttle Codex or AGY lanes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateLaneOwnership } from './path-ownership.mjs';
import {
  acquireLanePermit,
  releaseLanePermit,
  observeClaudeOutcome,
  resolvePoolStateDir,
} from './provider-pool.mjs';

function fail(message, code = 1) {
  console.error(`claude-writer: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

/** Canonical provider-event mapping for CLAUDE lanes (AIMD §15/§16). */
export function claudeProviderEvent(classification, detail) {
  if (classification === 'SUCCESS') return { healthy: true };
  const text = detail ?? '';
  const retryAfter = /retry[- ]after\D{0,20}(\d{1,5})\s*(s|sec|seconds)?/i.exec(text);
  if (/429|rate.?limit|overloaded|529/i.test(text)) {
    const seconds = retryAfter ? Number(retryAfter[1]) : null;
    return {
      healthy: false,
      retryAfterMs: seconds ? Math.min(Math.max(seconds * 1000, 5_000), 30 * 60_000) : null,
    };
  }
  return { healthy: false, retryAfterMs: null };
}

export function runClaudeWriter(input) {
  for (const field of ['lane', 'brief', 'worktree', 'results-dir'])
    if (!input[field]) throw new Error(`CLAUDE_WRITER_ARGUMENT_MISSING: ${field}`);
  // Lane-permit identity (H2 §2): fail closed on missing identity, accept
  // generation 0 (integer >= 0 — never a falsy-zero rejection).
  if (!input.package) throw new Error('CLAUDE_WRITER_ARGUMENT_MISSING: package/generation');
  if (
    typeof input.generation !== 'string' ||
    !/^\d+$/.test(input.generation.trim()) ||
    !Number.isSafeInteger(Number(input.generation))
  )
    throw new Error(`CLAUDE_WRITER_INVALID_GENERATION: ${String(input.generation)}`);
  const resultDir = input['results-dir'];
  mkdirSync(resultDir, { recursive: true });
  const brief = readFileSync(input.brief, 'utf8');
  const before = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  const prompt = [
    brief,
    '',
    'Execute the assignment now. Work only in the pinned private worktree.',
    'You own product implementation only. Never edit tests, test fixtures,',
    'test helpers, *.test.*, *.spec.*, or __tests__ paths. You may read and run',
    'tests. If a test conflicts with authoritative requirements, do not edit it;',
    'write TEST_DISPUTE evidence under the result artifact directory instead.',
    'Commit coherent production changes before exit.',
  ].join('\n');
  const started = Date.now();
  const stateDir = resolvePoolStateDir();
  const holder = `${input.package}:${Number(input.generation)}:${input.lane}`;
  // Acquire immediately BEFORE the provider invocation (H2 §2). On refusal
  // the provider is NOT dispatched; the refusal is recorded verbatim.
  const permit = acquireLanePermit(stateDir, holder, 'claude', {
    packageId: input.package,
    generation: Number(input.generation),
    laneId: input.lane,
  });
  if (!permit.ok) {
    writeFileSync(
      join(resultDir, 'permit-denied.json'),
      `${JSON.stringify(
        {
          schema: 'foresift/lane-permit-denial@1',
          holder,
          provider: 'claude',
          reason: permit.reason,
          waitMs: permit.waitMs,
        },
        null,
        2,
      )}\n`,
    );
    throw new Error(`CLAUDE_WRITER_PERMIT_DENIED: ${permit.reason}`);
  }
  let run;
  try {
    run = spawnSync(
      'claude',
      [
        '--print',
        '--model',
        input.model ?? 'claude-opus-4-8',
        '--disallowedTools',
        'Bash(git push:*)',
        '--add-dir',
        input.worktree,
      ],
      {
        cwd: input.worktree,
        input: `${prompt}\n`,
        encoding: 'utf8',
        timeout: Number(input['timeout-ms'] ?? 45 * 60_000),
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } finally {
    // Finally-equivalent release immediately AFTER lane termination (H2 §2):
    // success, failure, timeout, and cancellation all flow through here.
    releaseLanePermit(stateDir, holder, 'claude');
  }
  const detail = `${run?.stderr ?? ''}\n${run?.stdout ?? ''}`;
  const classification =
    run?.error?.code === 'ETIMEDOUT'
      ? 'TIMEOUT'
      : run?.status === 0
        ? 'SUCCESS'
        : /429|rate.?limit|overloaded|529/i.test(detail)
          ? 'TRANSIENT_PROVIDER_FAILURE'
          : 'SEMANTIC_OR_PROVIDER_FAILURE';
  // Engine-specific attribution (H2 §5/§6): feed ONLY the Claude pool.
  try {
    observeClaudeOutcome(stateDir, claudeProviderEvent(classification, detail));
  } catch {
    /* attribution is best-effort telemetry; never mask the lane verdict */
  }
  writeFileSync(join(resultDir, 'claude-run.jsonl'), run.stdout ?? '');
  writeFileSync(
    join(resultDir, 'telemetry.json'),
    `${JSON.stringify(
      {
        schema: 'foresift/lane-telemetry@1',
        lane: input.lane,
        engine: 'CLAUDE',
        role: 'implementation',
        model: input.model ?? 'claude-opus-4-8',
        holder,
        wallTimeMs: Date.now() - started,
        outcome: classification,
      },
      null,
      2,
    )}\n`,
  );
  if (classification !== 'SUCCESS')
    throw new Error(`CLAUDE_WRITER_${classification}: ${(run.stderr ?? '').slice(-500)}`);

  const dirty = git(['status', '--porcelain=v1'], input.worktree)
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1));
  const ownership = validateLaneOwnership({
    engine: 'CLAUDE',
    role: 'implementation',
    changedPaths: dirty,
  });
  if (!ownership.ok)
    throw new Error(`${ownership.violationCode}: ${ownership.violatingPaths.join(',')}`);
  if (dirty.length) {
    const add = git(['add', '--all'], input.worktree);
    if (add.status !== 0) throw new Error(`CLAUDE_GIT_ADD_FAILED: ${add.stderr}`);
    const commit = git(
      [
        '-c',
        'user.name=Foresift Claude Writer',
        '-c',
        'user.email=noreply@foresift.local',
        'commit',
        '-m',
        `feat: Claude implementation lane ${input.lane}`,
      ],
      input.worktree,
    );
    if (commit.status !== 0) throw new Error(`CLAUDE_COMMIT_FAILED: ${commit.stderr}`);
  }
  const head = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  const result = {
    schema: 'foresift/writer-result@1',
    shardId: input.lane,
    role: 'implementation',
    engine: 'CLAUDE',
    completed: head === before ? [] : [],
    branch: git(['branch', '--show-current'], input.worktree).stdout.trim(),
    headSha: head,
    testsRun: [],
    testResults: 'reported in Claude transcript; deterministic gates remain authoritative',
    blockers: [],
  };
  writeFileSync(join(resultDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return { ok: true, lane: input.lane, result };
}

if (process.argv[1]?.endsWith('exec-claude-writer.mjs')) {
  try {
    const result = runClaudeWriter(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ ok: true, lane: result.lane, headSha: result.result.headSha }));
  } catch (error) {
    fail(error.message);
  }
}
