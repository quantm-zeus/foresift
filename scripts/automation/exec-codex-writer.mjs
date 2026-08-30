// Headless Codex implementation-lane executor for fresh CODEX_AGY waves.
// The logical Foresift tier is always `standard`; Codex CLI 0.149.1 maps that
// to the supported wire value `default` (standard pricing/performance).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCodexExecArgs, CODEX_SERVICE_TIER } from './codex-routing.mjs';
import { validateLaneOwnership } from './path-ownership.mjs';
import {
  acquireLanePermit,
  releaseLanePermit,
  observeCodexOutcome,
  resolvePoolStateDir,
} from './provider-pool.mjs';

function fail(message, code = 1) {
  console.error(`codex-writer: ${message}`);
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

export function codexRouteForLane(routing, lane) {
  const route = (routing.lanes ?? []).find((candidate) => candidate.lane === lane);
  if (!route || route.role !== 'implementation' || route.engine !== 'CODEX')
    throw new Error(`CODEX_ROUTE_MISSING: ${lane}`);
  if (route.serviceTier !== CODEX_SERVICE_TIER)
    throw new Error(`INVALID_CODEX_SERVICE_TIER: ${String(route.serviceTier)}`);
  return route;
}

export function classifyCodexExit(result) {
  if (result?.error?.code === 'ETIMEDOUT') return 'TIMEOUT';
  if (result?.status === 0) return 'SUCCESS';
  const detail = `${result?.stderr ?? ''}\n${result?.stdout ?? ''}`;
  if (/429|rate.?limit|temporar|connection|timeout|unavailable/i.test(detail))
    return 'TRANSIENT_PROVIDER_FAILURE';
  return 'SEMANTIC_OR_PROVIDER_FAILURE';
}

/**
 * Engine-specific provider attribution (H2 §5/§6): map the lane outcome onto
 * the CODEX pool ONLY — never onto Claude (a Codex 429 must not throttle
 * Claude lanes). `exhausted` with a sane reset time latches RESET_WAIT so the
 * scheduler can reroute compatible lanes to Claude; generic transient failure
 * maps to UNKNOWN (probe before trusting).
 */
export function codexProviderEvent(classification, detail) {
  if (classification === 'SUCCESS') return { event: 'healthy' };
  const text = detail ?? '';
  const resetMatch = /resets? (?:at|in)[^.\n]{0,80}?(\d{10,13})/.exec(text);
  if (resetMatch) {
    const resetAt = Number(resetMatch[1]);
    return { event: 'exhausted', resetAt: resetAt < 1e12 ? resetAt * 1000 : resetAt };
  }
  if (/usage.?limit|quota|exhaust/i.test(text)) return { event: 'exhausted' };
  if (/429|rate.?limit|503|overloaded/i.test(text)) return { event: 'near_limit' };
  return { event: 'unknown' };
}

export function runCodexWriter(input) {
  for (const field of ['lane', 'brief', 'worktree', 'routing', 'results-dir'])
    if (!input[field]) throw new Error(`CODEX_WRITER_ARGUMENT_MISSING: ${field}`);
  // Lane-permit identity (H2 §2): ONE Codex process = ONE permit, keyed to
  // packageId:generation:laneId. Missing identity fails closed — an
  // unattributable writer may not consume a provider permit.
  if (!input.package || !input.generation)
    throw new Error('CODEX_WRITER_ARGUMENT_MISSING: package/generation');
  const routing = JSON.parse(readFileSync(input.routing, 'utf8'));
  const route = codexRouteForLane(routing, input.lane);
  const brief = readFileSync(input.brief, 'utf8');
  const resultDir = input['results-dir'];
  mkdirSync(resultDir, { recursive: true });
  const before = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  const prompt = [
    brief,
    '',
    'Execute the assignment now. Work only in the pinned private worktree.',
    'You own product implementation only. Never edit tests, test fixtures,',
    'test helpers, *.test.*, *.spec.*, or __tests__ paths. You may read and run',
    'tests. If a test conflicts with authoritative requirements, do not edit it;',
    'write TEST_DISPUTE evidence under the result artifact directory instead.',
    'Use non-interactive tools. Commit coherent production changes before exit.',
  ].join('\n');
  const command = buildCodexExecArgs(route, { worktree: input.worktree });
  const started = Date.now();
  const stateDir = resolvePoolStateDir();
  const holder = `${input.package}:${input.generation}:${input.lane}`;
  // Acquire immediately BEFORE the provider invocation (H2 §2). On refusal
  // the provider is NOT dispatched; the refusal is recorded verbatim.
  const permit = acquireLanePermit(stateDir, holder, 'codex');
  if (!permit.ok) {
    writeFileSync(
      join(resultDir, 'permit-denied.json'),
      `${JSON.stringify({ schema: 'foresift/lane-permit-denial@1', holder, provider: 'codex', reason: permit.reason, waitMs: permit.waitMs }, null, 2)}\n`,
    );
    throw new Error(`CODEX_WRITER_PERMIT_DENIED: ${permit.reason}`);
  }
  let run;
  try {
    run = spawnSync(command[0], command.slice(1), {
      cwd: input.worktree,
      input: `${prompt}\n`,
      encoding: 'utf8',
      timeout: Number(input['timeout-ms'] ?? 45 * 60_000),
      maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    // Finally-equivalent release immediately AFTER lane termination (H2 §2).
    releaseLanePermit(stateDir, holder, 'codex');
  }
  const classification = classifyCodexExit(run);
  // Engine-specific attribution (H2 §5/§6): healthy outcomes feed the Codex
  // quota machine; failures feed ONLY the Codex pool. Claude is untouched.
  try {
    const event = codexProviderEvent(classification, `${run?.stderr ?? ''}\n${run?.stdout ?? ''}`);
    observeCodexOutcome(stateDir, event);
  } catch {
    /* attribution is best-effort telemetry; never mask the lane verdict */
  }
  writeFileSync(join(resultDir, 'codex-run.jsonl'), run.stdout ?? '');
  writeFileSync(
    join(resultDir, 'telemetry.json'),
    `${JSON.stringify(
      {
        schema: 'foresift/lane-telemetry@1',
        profile: routing.executionProfile,
        lane: input.lane,
        implementationEngine: 'CODEX',
        testEngine: routing.testEngine,
        model: route.model,
        reasoning: route.reasoning,
        serviceTier: CODEX_SERVICE_TIER,
        attempt: route.attempt ?? 1,
        wallTimeMs: Date.now() - started,
        outcome: classification,
      },
      null,
      2,
    )}\n`,
  );
  if (classification !== 'SUCCESS')
    throw new Error(`CODEX_WRITER_${classification}: ${(run.stderr ?? '').slice(-500)}`);

  const dirty = git(['status', '--porcelain=v1'], input.worktree)
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1));
  const ownership = validateLaneOwnership({
    engine: 'CODEX',
    role: 'implementation',
    changedPaths: dirty,
  });
  if (!ownership.ok)
    throw new Error(`${ownership.violationCode}: ${ownership.violatingPaths.join(',')}`);
  if (dirty.length) {
    const add = git(['add', '--all'], input.worktree);
    if (add.status !== 0) throw new Error(`CODEX_GIT_ADD_FAILED: ${add.stderr}`);
    const commit = git(
      [
        '-c',
        'user.name=Foresift Codex Writer',
        '-c',
        'user.email=noreply@foresift.local',
        'commit',
        '-m',
        `feat: Codex implementation lane ${input.lane}`,
      ],
      input.worktree,
    );
    if (commit.status !== 0) throw new Error(`CODEX_COMMIT_FAILED: ${commit.stderr}`);
  }
  const head = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  const result = {
    schema: 'foresift/writer-result@1',
    shardId: input.lane,
    role: 'implementation',
    engine: 'CODEX',
    completed: head === before ? [] : route.taskIds,
    branch: git(['branch', '--show-current'], input.worktree).stdout.trim(),
    headSha: head,
    testsRun: [],
    testResults: 'reported in Codex event log; deterministic gates remain authoritative',
    blockers: [],
  };
  writeFileSync(join(resultDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return { ok: true, route, result };
}

if (process.argv[1]?.endsWith('exec-codex-writer.mjs')) {
  try {
    const result = runCodexWriter(parseArgs(process.argv.slice(2)));
    console.log(
      JSON.stringify({
        ok: true,
        lane: result.route.lane,
        model: result.route.model,
        reasoning: result.route.reasoning,
        serviceTier: result.route.serviceTier,
        headSha: result.result.headSha,
      }),
    );
  } catch (error) {
    fail(error.message);
  }
}
