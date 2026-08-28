// Headless Antigravity test-author executor. Fresh execution profiles grant
// AGY test-only authority and never route AGY to product implementation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateLaneOwnership } from './path-ownership.mjs';

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

export function runAgyTestWriter(input) {
  for (const field of ['lane', 'brief', 'worktree', 'routing', 'results-dir'])
    if (!input[field]) throw new Error(`AGY_TEST_ARGUMENT_MISSING: ${field}`);
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
  const ndjson = `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n`;
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
  const run = spawnSync('agy', agyArgs, {
    shell: false,
    cwd: input.worktree,
    input: ndjson,
    encoding: 'utf8',
    timeout: Number(input['timeout-ms'] ?? 45 * 60_000),
    maxBuffer: 64 * 1024 * 1024,
  });
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
  const head = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  const changedPaths = git(['diff', '--name-only', `${baseHead}..${head}`], input.worktree)
    .stdout.split('\n')
    .filter(Boolean);
  const ownership = validateLaneOwnership({ engine: 'AGY', role: 'test', changedPaths });
  if (!ownership.ok)
    throw new Error(`${ownership.violationCode}: ${ownership.violatingPaths.join(',')}`);
  const outside = allowedPaths ? changedPaths.filter((path) => !allowedPaths.has(path)) : [];
  if (outside.length) throw new Error(`AGY_TEST_SCOPE_VIOLATION: ${outside.join(',')}`);
  const result = {
    schema: 'foresift/writer-result@1',
    shardId: input.lane,
    role: 'test',
    engine: 'AGY',
    model: route.model,
    reasoning: route.reasoning,
    providerTimeout: route.providerTimeout,
    baseHead,
    completed: (input['task-ids'] ?? '').split(',').filter(Boolean),
    branch: git(['branch', '--show-current'], input.worktree).stdout.trim(),
    headSha: head,
    changedPaths,
    ownership,
    testsRun: Array.isArray(agentResult.testsRun) ? agentResult.testsRun : [],
    testResults: agentResult.testResults ?? 'unknown',
    baselineClassifications: agentResult.baselineClassifications,
    blockers: Array.isArray(agentResult.blockers) ? agentResult.blockers : [],
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
