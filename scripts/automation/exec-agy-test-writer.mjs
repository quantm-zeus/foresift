// Headless Antigravity test-author executor. Fresh execution profiles grant
// AGY test-only authority and never route AGY to product implementation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyOwnedPath, validateLaneOwnership } from './path-ownership.mjs';
import { acquireLanePermit, releaseLanePermit, resolvePoolStateDir } from './provider-pool.mjs';
import { claimCompletedUnits, parseTaskGraph } from './writer-task-evidence.mjs';

function fail(message) {
  console.error(`agy-test-writer: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++)
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

export const ALLOWED_BASELINE_CLASSIFICATIONS = Object.freeze([
  'NEW_BEHAVIOR_RED',
  'REGRESSION_RED',
  'NEGATIVE_RED',
  'CHARACTERIZATION_GREEN',
  'REFACTOR_GUARD_GREEN',
]);

/**
 * Validate the test-author's baseline report. The report contract names the
 * item key `classification`, but the model observably writes the equivalent
 * `baseline` key (run 265f6fe1 shipped valid classifications as
 * {"file","baseline"} and was rejected purely on shape). Both spellings and
 * bare strings are accepted; the value set is still validated strictly.
 */
export function validateBaselineClassifications(items) {
  const allowed = new Set(ALLOWED_BASELINE_CLASSIFICATIONS);
  const ok =
    Array.isArray(items) &&
    items.length > 0 &&
    items.every((item) => {
      const classification =
        typeof item === 'string'
          ? item
          : typeof item?.classification === 'string'
            ? item.classification
            : item?.baseline;
      return allowed.has(classification);
    });
  if (!ok) throw new Error('AGY_TEST_BASELINE_CLASSIFICATION_INVALID');
  return true;
}

export function validateGeneration(generation) {
  if (
    typeof generation !== 'string' ||
    !/^\d+$/.test(generation.trim()) ||
    !Number.isSafeInteger(Number(generation))
  )
    throw new Error(`AGY_TEST_INVALID_GENERATION: ${String(generation)}`);
  return Number(generation);
}

export function runAgyTestWriter(input) {
  for (const field of ['lane', 'brief', 'worktree', 'routing', 'results-dir'])
    if (!input[field]) throw new Error(`AGY_TEST_ARGUMENT_MISSING: ${field}`);
  // Lane-permit identity (H2 §2): ONE AGY process = ONE permit, keyed to
  // packageId:generation:laneId. Missing identity fails closed. Generation
  // 0 is accepted (validateGeneration enforces integer >= 0).
  if (!input.package) throw new Error('AGY_TEST_ARGUMENT_MISSING: package/generation');
  if (!existsSync(input.brief)) throw new Error(`AGY_TEST_BRIEF_MISSING: ${input.brief}`);
  if (!existsSync(input.routing)) throw new Error(`AGY_TEST_ROUTING_MISSING: ${input.routing}`);
  const routing = JSON.parse(readFileSync(input.routing, 'utf8'));
  const route = routing.lanes?.find(
    (candidate) => candidate.lane === input.lane && candidate.role === 'test',
  );
  if (route?.engine !== 'AGY') throw new Error(`AGY_TEST_ROUTE_INVALID: ${input.lane}`);
  for (const field of ['model', 'reasoning', 'providerTimeout'])
    if (typeof route[field] !== 'string' || !route[field])
      throw new Error(`AGY_TEST_ROUTE_INVALID: ${input.lane}.${field}`);
  const resultDir = input['results-dir'];
  mkdirSync(resultDir, { recursive: true });
  const baseHead = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  const allowedPaths = input['allowed-paths']
    ? new Set(JSON.parse(readFileSync(input['allowed-paths'], 'utf8')))
    : null;
  const prompt = [
    readFileSync(input.brief, 'utf8'),
    '',
    `Execute this test-author brief now inside ${input.worktree}.`,
    'Use absolute paths rooted at that worktree. You are the sole task-owned',
    'test author. Never edit product implementation. Write tests/fixtures/test',
    'helpers only, run targeted baseline checks, classify each baseline, commit',
    'your test-only changes, and do not attempt to make product code pass.',
    `Write a minimal JSON report to ${join(resultDir, 'agent-result.json')} with`,
    '{"baselineClassifications":[...],"testsRun":[...],"testResults":"...","blockers":[...]}.',
    'Each baselineClassifications item MUST be exactly',
    '{"file":"<repo-relative spec path>","classification":"<one of NEW_BEHAVIOR_RED|REGRESSION_RED|NEGATIVE_RED|CHARACTERIZATION_GREEN|REFACTOR_GUARD_GREEN>"}.',
  ].join('\n');
  const started = Date.now();
  const agyArgs = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--disable-slash-commands',
    '--dangerously-skip-permissions',
    '--model',
    route.model,
    '--effort',
    route.reasoning,
    '--print-timeout',
    route.providerTimeout,
  ];
  const runAgy = (promptText) => {
    const stateDir = resolvePoolStateDir();
    // Normalized holder identity (review finding 8): validateGeneration
    // returns the integer, so `pkg@g07` and `pkg@g7` map to ONE holder.
    const generation = validateGeneration(input.generation ?? '');
    const holder = `${input.package}:${generation}:${input.lane}`;
    // Acquire immediately BEFORE the AGY invocation (H2 §2); on refusal the
    // provider is NOT dispatched. Released in the finally below. Identity
    // opts (review finding 7) keep the durable record run-truth-bearing.
    const permit = acquireLanePermit(stateDir, holder, 'agy', {
      packageId: input.package,
      generation,
      laneId: input.lane,
      runId: input['run-id'] ?? process.env.FORESIFT_RUN_ID ?? null,
    });
    if (!permit.ok) {
      writeFileSync(
        join(resultDir, 'permit-denied.json'),
        `${JSON.stringify({ schema: 'foresift/lane-permit-denial@1', holder, provider: 'agy', reason: permit.reason, waitMs: permit.waitMs }, null, 2)}\n`,
      );
      throw new Error(`AGY_TEST_PERMIT_DENIED: ${permit.reason}`);
    }
    try {
      return spawnSync('agy', agyArgs, {
        shell: false,
        cwd: input.worktree,
        input: `${JSON.stringify({ event: 'user', message: { role: 'user', content: promptText } })}\n`,
        encoding: 'utf8',
        timeout: Number(input['timeout-ms'] ?? 45 * 60_000),
        maxBuffer: 64 * 1024 * 1024,
      });
    } finally {
      releaseLanePermit(stateDir, holder, 'agy');
    }
  };
  const run = runAgy(prompt);
  writeFileSync(join(resultDir, 'agy-run.jsonl'), run.stdout ?? '');
  if (run.error) throw new Error(`AGY_TEST_SPAWN_FAILED: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`AGY_TEST_FAILED: ${(run.stderr ?? '').slice(-500)}`);
  const agentResultPath = join(resultDir, 'agent-result.json');
  if (!existsSync(agentResultPath)) throw new Error('AGY_TEST_RESULT_CONTRACT_MISSING');
  const agentResult = JSON.parse(readFileSync(agentResultPath, 'utf8'));
  validateBaselineClassifications(agentResult.baselineClassifications);
  const dirty = git(['status', '--porcelain=v1'], input.worktree)
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1));
  if (dirty.length) {
    git(['add', '--all'], input.worktree);
    const commit = git(
      [
        '-c',
        'user.name=Foresift AGY Test Author',
        '-c',
        'user.email=noreply@foresift.local',
        'commit',
        '-m',
        `test: AGY test-author lane ${input.lane}`,
      ],
      input.worktree,
    );
    if (commit.status !== 0) throw new Error(`AGY_TEST_COMMIT_FAILED: ${commit.stderr}`);
  }
  let head = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  let changedPaths = git(['diff', '--name-only', `${baseHead}..${head}`], input.worktree)
    .stdout.split('\n')
    .filter(Boolean);
  const ownership = validateLaneOwnership({ engine: 'AGY', role: 'test', changedPaths });
  if (!ownership.ok)
    throw new Error(`${ownership.violationCode}: ${ownership.violatingPaths.join(',')}`);
  const outside = allowedPaths ? changedPaths.filter((path) => !allowedPaths.has(path)) : [];
  if (outside.length) throw new Error(`AGY_TEST_SCOPE_VIOLATION: ${outside.join(',')}`);

  // ── type-repair pass (bounded: exactly one) ──────────────────────────────────
  // The lane's own output must compile: test files that fail `pnpm typecheck`
  // fail every downstream fast gate, and the only legal repairer of AGY-owned
  // test files is AGY itself (Codex repairs are product-owned). Re-invoke the
  // same agent with the filtered error list, restricted to files this lane
  // changed. (Observed live: run e01370f3's AGY lane shipped type-broken test
  // fixtures; no repair path existed for them.)
  const typecheckErrorsFor = (_paths, cwd) => {
    const r = spawnSync('pnpm', ['typecheck'], {
      cwd,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    // The lane owns the TEST surface, not just its own diff: type errors in
    // test files committed by EARLIER waves have no other legal repairer, and
    // they fail every downstream fast gate exactly like this lane's own.
    // Product-code type errors stay out of AGY's reach (Codex repairs or
    // TEST_DISPUTE own those).
    return [...out.matchAll(/^([^\s(]+)\(\d+,\d+\): error TS[^\n]*/gm)]
      .map((m) => m[0])
      .filter((line) => classifyOwnedPath(line.split('(')[0]) === 'TEST');
  };
  let typeErrors = typecheckErrorsFor(changedPaths, input.worktree);
  const typeRepair = { attempted: false, remaining: typeErrors };
  if (typeErrors.length) {
    typeRepair.attempted = true;
    const repairPrompt = [
      prompt,
      '',
      'TYPE REPAIR PASS. Your committed test-author changes introduced TypeScript',
      'errors. Fix ONLY these errors, ONLY inside the files you authored:',
      ...typeErrors.map((line) => `  ${line}`),
      '',
      'Do not edit product implementation. Do not weaken test intent to dodge a',
      'type error — fix the fixture/helper/type usage. Re-run the affected suites,',
      `commit the fixes, and rewrite ${join(resultDir, 'agent-result.json')} with`,
      'the same JSON contract as before.',
    ].join('\n');
    const repairRun = runAgy(repairPrompt);
    writeFileSync(join(resultDir, 'agy-run-type-repair.jsonl'), repairRun.stdout ?? '');
    if (repairRun.error)
      throw new Error(`AGY_TEST_REPAIR_SPAWN_FAILED: ${repairRun.error.message}`);
    if (repairRun.status !== 0)
      throw new Error(`AGY_TEST_REPAIR_FAILED: ${(repairRun.stderr ?? '').slice(-500)}`);
    const dirty2 = git(['status', '--porcelain=v1'], input.worktree)
      .stdout.split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).split(' -> ').at(-1));
    // Commit ONLY ownership-clean paths: tooling side effects (pnpm may touch
    // node_modules metadata or the lockfile during typecheck) must not be
    // swallowed into the AGY authorship commit.
    const commitable2 = dirty2.filter(
      (p) => validateLaneOwnership({ engine: 'AGY', role: 'test', changedPaths: [p] }).ok,
    );
    if (commitable2.length) {
      git(['add', '--', ...commitable2], input.worktree);
      const commit2 = git(
        [
          '-c',
          'user.name=Foresift AGY Test Author',
          '-c',
          'user.email=noreply@foresift.local',
          'commit',
          '-m',
          `test: AGY test-author type repair ${input.lane}`,
        ],
        input.worktree,
      );
      if (commit2.status !== 0) throw new Error(`AGY_TEST_REPAIR_COMMIT_FAILED: ${commit2.stderr}`);
    }
    head = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
    changedPaths = git(['diff', '--name-only', `${baseHead}..${head}`], input.worktree)
      .stdout.split('\n')
      .filter(Boolean);
    const ownership2 = validateLaneOwnership({ engine: 'AGY', role: 'test', changedPaths });
    if (!ownership2.ok)
      throw new Error(`${ownership2.violationCode}: ${ownership2.violatingPaths.join(',')}`);
    const outside2 = allowedPaths ? changedPaths.filter((path) => !allowedPaths.has(path)) : [];
    if (outside2.length) throw new Error(`AGY_TEST_SCOPE_VIOLATION: ${outside2.join(',')}`);
    typeErrors = typecheckErrorsFor(changedPaths, input.worktree);
    if (typeErrors.length)
      throw new Error(
        `AGY_TEST_TYPECHECK_FAILED: ${typeErrors.slice(0, 10).join(' | ').slice(0, 800)}`,
      );
    typeRepair.remaining = [];
  }
  // Evidence-backed completion (H3 P0-1): the AGY test author previously
  // claimed EVERY --task-ids unconditionally. Nominations now require
  // predicted-write evidence in the lane's own diff; the writer's declared
  // blockers keep their tasks OPEN.
  const assigned = (input['task-ids'] ?? '').split(',').filter(Boolean);
  let evidence = { graph: null, unitsById: null };
  if (input['task-graph']) {
    const parsed = parseTaskGraph(input['task-graph']);
    if (parsed) evidence = parsed;
  }
  const writerBlockers = Array.isArray(agentResult.blockers) ? agentResult.blockers : [];
  const claims = claimCompletedUnits({
    taskIds: assigned,
    changed: changedPaths,
    unitsById: evidence.unitsById,
    blockers: writerBlockers,
  });
  const result = {
    schema: 'foresift/writer-result@1',
    shardId: input.lane,
    role: 'test',
    engine: 'AGY',
    model: route.model,
    reasoning: route.reasoning,
    providerTimeout: route.providerTimeout,
    baseHead,
    // Evidence-backed nominations (H3 P0-1): diff-proven ids only; an empty
    // diff or a missing task graph nominates nothing (fail-closed).
    completed: changedPaths.length > 0 ? claims.nominated : [],
    deferredUnits:
      changedPaths.length > 0
        ? claims.deferred
        : assigned.map((taskId) => ({ taskId, reason: 'lane produced no diff' })),
    branch: git(['branch', '--show-current'], input.worktree).stdout.trim(),
    headSha: head,
    changedPaths,
    ownership,
    testsRun: Array.isArray(agentResult.testsRun) ? agentResult.testsRun : [],
    testResults: agentResult.testResults ?? 'unknown',
    baselineClassifications: agentResult.baselineClassifications,
    blockers: writerBlockers,
    typeRepair,
  };
  writeFileSync(join(resultDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    join(resultDir, 'telemetry.json'),
    `${JSON.stringify(
      {
        schema: 'foresift/lane-telemetry@1',
        lane: input.lane,
        engine: 'AGY',
        role: 'test',
        model: route.model,
        reasoning: route.reasoning,
        providerTimeout: route.providerTimeout,
        wallTimeMs: Date.now() - started,
        outcome: 'SUCCESS',
      },
      null,
      2,
    )}\n`,
  );
  return result;
}

if (process.argv[1]?.endsWith('exec-agy-test-writer.mjs')) {
  try {
    const result = runAgyTestWriter(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ ok: true, lane: result.shardId, headSha: result.headSha }));
  } catch (error) {
    fail(error.message);
  }
}
