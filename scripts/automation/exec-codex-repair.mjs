// Bounded CODEX_AGY FAST repair. Repairs occur in a private worktree, enforce
// product-only ownership, then merge additively into the canonical run branch.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCodexExecArgs, CODEX_SERVICE_TIER, escalateCodexRoute } from './codex-routing.mjs';
import { validateLaneOwnership } from './path-ownership.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++)
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function fail(message) {
  console.error(`codex-repair: ${message}`);
  process.exit(1);
}

export function runCodexRepair(input) {
  for (const field of ['canonical', 'artifacts', 'routing', 'package'])
    if (!input[field]) throw new Error(`CODEX_REPAIR_ARGUMENT_MISSING: ${field}`);
  const routing = JSON.parse(readFileSync(input.routing, 'utf8'));
  if (routing.executionProfile !== 'CODEX_AGY') throw new Error('CODEX_REPAIR_PROFILE_MISMATCH');
  const ranked = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const candidates = (routing.lanes ?? []).filter(
    (lane) => lane.role === 'implementation' && lane.engine === 'CODEX',
  );
  if (!candidates.length) throw new Error('CODEX_REPAIR_ROUTE_MISSING');
  let route = candidates.sort(
    (a, b) => (ranked[b.complexityTier] ?? 0) - (ranked[a.complexityTier] ?? 0),
  )[0];
  if (route.complexityTier !== 'HIGH') route = escalateCodexRoute(route);
  if (route.serviceTier !== CODEX_SERVICE_TIER) throw new Error('INVALID_CODEX_SERVICE_TIER');

  const base = git(['rev-parse', 'HEAD'], input.canonical).stdout.trim();
  const token = `${basename(input.artifacts)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-8)}-${Date.now()}`;
  const branch = `foresift/wave-repair/${base.slice(0, 10)}-${token}`;
  const worktree = join(input.artifacts, 'wt', `repair-${token}`);
  mkdirSync(join(input.artifacts, 'repair'), { recursive: true });
  const addWt = git(['worktree', 'add', '-b', branch, worktree, base], input.canonical);
  if (addWt.status !== 0) throw new Error(`CODEX_REPAIR_WORKTREE_FAILED: ${addWt.stderr}`);
  const logFile = join(input.artifacts, 'wave-fast.log');
  const logTail = (() => {
    try {
      return readFileSync(logFile, 'utf8').split('\n').slice(-120).join('\n');
    } catch {
      return '(FAST log unavailable)';
    }
  })();
  const prompt = [
    `Repair the Foresift TRUE FAST failure for package ${input.package}.`,
    `Pinned repair base: ${base}. Work only inside ${worktree}.`,
    'Modify product implementation only. Never edit tests, fixtures, test-only',
    'helpers, *.test.*, *.spec.*, or __tests__. Read tests and FAST evidence to',
    'diagnose. Make the smallest semantic repair and commit it. Do not run FULL.',
    '',
    'FAST LOG TAIL:',
    logTail,
  ].join('\n');
  const command = buildCodexExecArgs(route, { worktree });
  const started = Date.now();
  const run = spawnSync(command[0], command.slice(1), {
    cwd: worktree,
    input: `${prompt}\n`,
    encoding: 'utf8',
    timeout: Number(input['timeout-ms'] ?? 30 * 60_000),
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(input.artifacts, 'repair', `${token}.jsonl`), run.stdout ?? '');
  if (run.error || run.status !== 0)
    throw new Error(`CODEX_REPAIR_FAILED: ${run.error?.message ?? (run.stderr ?? '').slice(-500)}`);
  const dirty = git(['status', '--porcelain=v1'], worktree)
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
    git(['add', '--all'], worktree);
    const commit = git(
      [
        '-c',
        'user.name=Foresift Codex Repair',
        '-c',
        'user.email=noreply@foresift.local',
        'commit',
        '-m',
        `fix(${input.package}): bounded Codex FAST repair`,
      ],
      worktree,
    );
    if (commit.status !== 0) throw new Error(`CODEX_REPAIR_COMMIT_FAILED: ${commit.stderr}`);
  }
  const head = git(['rev-parse', 'HEAD'], worktree).stdout.trim();
  const changed = git(['diff', '--name-only', `${base}..${head}`], worktree)
    .stdout.split('\n')
    .filter(Boolean);
  const finalOwnership = validateLaneOwnership({
    engine: 'CODEX',
    role: 'implementation',
    changedPaths: changed,
  });
  if (!finalOwnership.ok)
    throw new Error(`${finalOwnership.violationCode}: ${finalOwnership.violatingPaths.join(',')}`);
  if (head !== base) {
    const merge = git(
      ['merge', '--no-ff', '-m', `wave repair integration: ${token}`, branch],
      input.canonical,
    );
    if (merge.status !== 0) {
      git(['merge', '--abort'], input.canonical);
      throw new Error(`CODEX_REPAIR_INTEGRATION_FAILED: ${merge.stderr}`);
    }
  }
  writeFileSync(
    join(input.artifacts, 'repair', `${token}.json`),
    `${JSON.stringify(
      {
        schema: 'foresift/codex-repair@1',
        profile: 'CODEX_AGY',
        package: input.package,
        baseHead: base,
        repairHead: head,
        model: route.model,
        reasoning: route.reasoning,
        serviceTier: CODEX_SERVICE_TIER,
        wallTimeMs: Date.now() - started,
        changedPaths: changed,
        integrated: head !== base,
      },
      null,
      2,
    )}\n`,
  );
  if (head !== base) {
    git(['worktree', 'remove', worktree], input.canonical);
    git(['branch', '-d', branch], input.canonical);
  }
  return { model: route.model, reasoning: route.reasoning, serviceTier: route.serviceTier, head };
}

if (process.argv[1]?.endsWith('exec-codex-repair.mjs')) {
  try {
    console.log(JSON.stringify({ ok: true, ...runCodexRepair(parseArgs(process.argv.slice(2))) }));
  } catch (error) {
    fail(error.message);
  }
}
