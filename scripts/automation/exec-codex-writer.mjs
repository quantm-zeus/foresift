// Headless Codex implementation-lane executor for fresh CODEX_AGY waves.
// The logical Foresift tier is always `standard`; Codex CLI 0.149.1 maps that
// to the supported wire value `default` (standard pricing/performance).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCodexExecArgs, CODEX_SERVICE_TIER } from './codex-routing.mjs';
import { validateLaneOwnership } from './path-ownership.mjs';
import {
  claimCompletedUnits,
  laneEvidencePaths,
  parseTaskGraph,
  requireTaskGraphForCompletionEvidence,
} from './writer-task-evidence.mjs';
import { executeHandoffToClaude, isQuotaHandoffReason } from './engine-handoff.mjs';
import { runClaudeLaneCore } from './claude-lane-core.mjs';
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
  // Pressure tokens are anchored (review finding 12 analog): incidental
  // "429"/"quota" substrings inside the model transcript (diff hunks, echoed
  // logs) must not latch quota states — require word-shaped or provider-
  // phrased tokens. The pool's bounded EXHAUSTED latch (finding 3) bounds the
  // blast radius even for a false positive.
  if (/\b(?:HTTP\s*)?429\b|\brate.?limit\b|\b503\b|\boverloaded\b/i.test(text))
    return { event: 'near_limit' };
  if (/\busage.?limit\b|\bquota\b|\bexhaust(?:ed|ion)\b|\busage limit reached\b/i.test(text))
    return { event: 'exhausted' };
  return { event: 'unknown' };
}

/**
 * Lane-permit generation identity (P0 review finding): generation is valid
 * iff it is an integer >= 0. Generation 0 is a REAL generation — legacy and
 * non-@g launches fall back to it — so a falsy check here wrongly rejected
 * every gen-0 writer. Refuses undefined/null/NaN/negative/non-integer.
 */
export function validateGeneration(generation) {
  if (
    typeof generation !== 'string' ||
    !/^\d+$/.test(generation.trim()) ||
    !Number.isSafeInteger(Number(generation))
  )
    throw new Error(`CODEX_WRITER_INVALID_GENERATION: ${String(generation)}`);
  return Number(generation);
}

export function runCodexWriter(input) {
  for (const field of ['lane', 'brief', 'worktree', 'routing', 'results-dir'])
    if (!input[field]) throw new Error(`CODEX_WRITER_ARGUMENT_MISSING: ${field}`);
  // Lane-permit identity (H2 §2): ONE Codex process = ONE permit, keyed to
  // packageId:generation:laneId. Missing identity fails closed — an
  // unattributable writer may not consume a provider permit. Generation 0
  // is accepted (validateGeneration enforces integer >= 0).
  if (!input.package) throw new Error('CODEX_WRITER_ARGUMENT_MISSING: package/generation');
  const routing = JSON.parse(readFileSync(input.routing, 'utf8'));
  const route = codexRouteForLane(routing, input.lane);
  // P0 hardening: the evidence protocol needs the task graph BEFORE any
  // provider spend (live 89c4b2b9 — 40m of green writer work died at
  // integration because the wiring omitted --task-graph). Fail closed before
  // permit acquisition; nothing below runs without a valid evidence graph.
  requireTaskGraphForCompletionEvidence({
    graphPath: input['task-graph'],
    taskIds: route.taskIds,
    engine: 'CODEX',
    lane: input.lane,
  });
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
  const generation = validateGeneration(input.generation ?? '');
  const holder = `${input.package}:${generation}:${input.lane}`;
  // Acquire immediately BEFORE the provider invocation (H2 §2). On refusal
  // the provider is NOT dispatched; the refusal is recorded verbatim.
  // Identity opts (review finding 7): the durable holder record must carry
  // package/generation/lane/run truth, not nulls — run-truth reconciliation
  // can only decide holders it can identify.
  const permit = acquireLanePermit(stateDir, holder, 'codex', {
    packageId: input.package,
    generation,
    laneId: input.lane,
    runId: input['run-id'] ?? process.env.FORESIFT_RUN_ID ?? null,
  });
  if (!permit.ok) {
    writeFileSync(
      join(resultDir, 'permit-denied.json'),
      `${JSON.stringify({ schema: 'foresift/lane-permit-denial@1', holder, provider: 'codex', reason: permit.reason, waitMs: permit.waitMs }, null, 2)}\n`,
    );
    // H3 P0-4 engine handoff: TRUE quota exhaustion (latch) or an unavailable
    // selected model hands the SAME logical lane to Claude; transient
    // contention (POOL_AT_LIMIT / PROVIDER_BACKOFF) waits via the workflow's
    // normal retry instead. The handoff releases codex ownership (none was
    // ever held on a denied acquire), acquires the Claude permit under the
    // SAME holder identity, and executes the identical brief/worktree —
    // no duplicate generation, no dual owner, no duplicate commits.
    if (isQuotaHandoffReason(permit.reason) && input['allow-engine-handoff'] !== 'false') {
      const handoffTaskIds = route.taskIds;
      return executeHandoffToClaude({
        stateDir,
        holder,
        packageId: input.package,
        generation,
        laneId: input.lane,
        runId: input['run-id'] ?? process.env.FORESIFT_RUN_ID ?? null,
        resultDir,
        releaseCodex: false, // a denied acquisition never held a codex permit
        executeWithClaude: () =>
          runClaudeLaneCore({
            lane: input.lane,
            briefPath: input.brief,
            worktree: input.worktree,
            resultsDir: resultDir,
            packageId: input.package,
            generation,
            runId: input['run-id'] ?? process.env.FORESIFT_RUN_ID ?? null,
            taskIds: handoffTaskIds,
            taskGraphPath: input['task-graph'] ?? null,
            stateDir,
            holder,
            handedOffFrom: 'CODEX',
            timeoutMs: input['timeout-ms'],
          }),
      });
    }
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

  // Lane evidence diff (live 7c98e02e): committed work counts — status alone
  // saw a clean tree after the agent's own commits and nominated nothing.
  const evidencePaths = laneEvidencePaths({ worktree: input.worktree, before });
  const dirty = git(['status', '--porcelain=v1'], input.worktree)
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1));
  const ownership = validateLaneOwnership({
    engine: 'CODEX',
    role: 'implementation',
    changedPaths: evidencePaths,
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
  // Evidence-backed completion (H3 P0-1): the old invariant — ANY commit ⇒
  // EVERY route.taskIds complete — is removed. Nominations require
  // predicted-write evidence in this lane's actual diff (committed ∪
  // uncommitted); everything else is reported deferred and stays OPEN at the
  // coordinator.
  const graphPath = input['task-graph'];
  let evidence = { graph: null, unitsById: null };
  if (graphPath) {
    const parsed = parseTaskGraph(graphPath);
    if (parsed) evidence = parsed;
  }
  const claims = claimCompletedUnits({
    taskIds: route.taskIds,
    changed: evidencePaths,
    unitsById: evidence.unitsById,
    blockers: [],
  });
  const producedDiff = head !== before && evidencePaths.length > 0;
  const result = {
    schema: 'foresift/writer-result@1',
    shardId: input.lane,
    role: 'implementation',
    engine: 'CODEX',
    // Evidence-backed nominations (H3 P0-1): only predicted-write-proven ids;
    // an empty diff or a missing task graph nominates nothing (fail-closed).
    completed: producedDiff ? claims.nominated : [],
    deferredUnits: producedDiff
      ? claims.deferred
      : route.taskIds.map((taskId) => ({ taskId, reason: 'lane produced no diff' })),
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
