// Bounded CODEX_AGY FAST repair. Repairs occur in a private worktree, enforce
// product-only ownership, then merge additively into the canonical run branch.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCodexExecArgs, CODEX_SERVICE_TIER, escalateCodexRoute } from './codex-routing.mjs';
import { validateLaneOwnership } from './path-ownership.mjs';
import { codexProviderEvent, validateGeneration } from './exec-codex-writer.mjs';
import {
  acquireLanePermit,
  releaseLanePermit,
  observeCodexOutcome,
  resolvePoolStateDir,
} from './provider-pool.mjs';

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

// Test-only waves (all remaining units owned by the AGY lane) carry no
// implementation lane in the routing artifact. The repair must still run —
// synthesize a deterministic HIGH repair route instead of failing closed
// with CODEX_REPAIR_ROUTE_MISSING (observed live on run e01370f3). Repairs
// are sensitive by nature: gpt-5.6-sol / medium / standard tier.
export function selectRepairRoute(routing) {
  const ranked = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const candidates = (routing.lanes ?? []).filter(
    (lane) => lane.role === 'implementation' && lane.engine === 'CODEX',
  );
  if (candidates.length) {
    let route = candidates.sort(
      (a, b) => (ranked[b.complexityTier] ?? 0) - (ranked[a.complexityTier] ?? 0),
    )[0];
    // H3 P2-9: repair dispatch on a non-HIGH route is the ONE bounded
    // evidence-driven escalation to Sol/high. An already-escalated route
    // (escalation >= 1) stays at its current model/reasoning — the escalation
    // budget is spent, retry without a second burn.
    if (route.complexityTier !== 'HIGH') {
      try {
        route = escalateCodexRoute(route);
      } catch (error) {
        if (!/CODEX_ESCALATION_BUDGET_EXHAUSTED/.test(String(error?.message ?? error))) throw error;
      }
    }
    return route;
  }
  return {
    lane: 'repair',
    role: 'implementation',
    engine: 'CODEX',
    complexityTier: 'HIGH',
    model: 'gpt-5.6-sol',
    reasoning: 'medium',
    serviceTier: CODEX_SERVICE_TIER,
    cliServiceTier: 'default',
    synthesizedForLaneLessWave: true,
  };
}

export function runCodexRepair(input) {
  for (const field of ['canonical', 'artifacts', 'routing', 'package'])
    if (!input[field]) throw new Error(`CODEX_REPAIR_ARGUMENT_MISSING: ${field}`);
  const routing = JSON.parse(readFileSync(input.routing, 'utf8'));
  // HYBRID_AGY waves route their implementation lanes to CODEX exactly like
  // CODEX_AGY waves (codex-routing classifyCodexLane), so the engine-specific
  // repairer is the same Codex tool. Runs 165799b9/5579a4c7 (2026-08-30) died
  // deterministically in fast-repair-loop: the workflow's repair nodes are
  // when-gated to CODEX_AGY/CLAUDE_AGY only, so a HYBRID_AGY wave with a red
  // FAST had NO repair lane and the loop exhausted in milliseconds.
  if (!['CODEX_AGY', 'HYBRID_AGY'].includes(routing.executionProfile))
    throw new Error('CODEX_REPAIR_PROFILE_MISMATCH');
  const repairDir = join(input.artifacts, 'repair');
  mkdirSync(repairDir, { recursive: true });
  const priorRepairs = readdirSync(repairDir).filter((name) => name.endsWith('.json')).length;
  if (priorRepairs >= 2) throw new Error('CODEX_REPAIR_EXHAUSTED');
  const route = selectRepairRoute(routing);
  if (route.serviceTier !== CODEX_SERVICE_TIER) throw new Error('INVALID_CODEX_SERVICE_TIER');

  const base = git(['rev-parse', 'HEAD'], input.canonical).stdout.trim();
  // Permit BEFORE the worktree (review finding 6): acquiring after
  // `git worktree add` meant every permit-denied repair attempt still
  // orphaned a worktree + branch. The provider is never dispatched on
  // denial, so nothing but the permit decides whether the repair proceeds.
  const stateDir = resolvePoolStateDir();
  const generation = validateGeneration(String(input.generation ?? 0));
  const holder = `${input.package}:${generation}:repair`;
  const permit = acquireLanePermit(stateDir, holder, 'codex', {
    packageId: input.package,
    generation,
    laneId: 'repair',
    runId: input['run-id'] ?? process.env.FORESIFT_RUN_ID ?? null,
  });
  if (!permit.ok) throw new Error(`CODEX_REPAIR_PERMIT_DENIED: ${permit.reason}`);
  const token = `${basename(input.artifacts)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-8)}-${Date.now()}`;
  const branch = `foresift/wave-repair/${base.slice(0, 10)}-${token}`;
  const worktree = join(input.artifacts, 'wt', `repair-${token}`);
  const addWt = git(['worktree', 'add', '-b', branch, worktree, base], input.canonical);
  if (addWt.status !== 0) {
    releaseLanePermit(stateDir, holder, 'codex');
    throw new Error(`CODEX_REPAIR_WORKTREE_FAILED: ${addWt.stderr}`);
  }
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
  let run;
  try {
    run = spawnSync(command[0], command.slice(1), {
      cwd: worktree,
      input: `${prompt}\n`,
      encoding: 'utf8',
      timeout: Number(input['timeout-ms'] ?? 30 * 60_000),
      maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    // Finally-equivalent release: success, failure, timeout, and cancellation
    // all flow through here (worktree/branch cleanup below is success-path).
    releaseLanePermit(stateDir, holder, 'codex');
  }
  // Engine-specific attribution (H2 §5/§6): the repair outcome feeds ONLY
  // the Codex pool — same canonical event mapping as the writers.
  try {
    const detail = `${run?.stderr ?? ''}\n${run?.stdout ?? ''}`;
    const classification =
      run?.error?.code === 'ETIMEDOUT'
        ? 'TIMEOUT'
        : run?.status === 0
          ? 'SUCCESS'
          : /429|rate.?limit|usage.?limit|quota|exhaust|overload/i.test(detail)
            ? 'TRANSIENT_PROVIDER_FAILURE'
            : 'SEMANTIC_OR_PROVIDER_FAILURE';
    observeCodexOutcome(stateDir, codexProviderEvent(classification, detail));
  } catch {
    /* attribution is best-effort telemetry; never mask the repair verdict */
  }
  writeFileSync(join(repairDir, `${token}.jsonl`), run.stdout ?? '');
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
    join(repairDir, `${token}.json`),
    `${JSON.stringify(
      {
        schema: 'foresift/codex-repair@1',
        profile: routing.executionProfile,
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
  git(['worktree', 'remove', worktree], input.canonical);
  git(['branch', '-d', branch], input.canonical);
  return { model: route.model, reasoning: route.reasoning, serviceTier: route.serviceTier, head };
}

if (process.argv[1]?.endsWith('exec-codex-repair.mjs')) {
  try {
    console.log(JSON.stringify({ ok: true, ...runCodexRepair(parseArgs(process.argv.slice(2))) }));
  } catch (error) {
    fail(error.message);
  }
}
