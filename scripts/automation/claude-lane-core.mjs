// Shared Claude lane-execution core (Hyperdrive H3, P0-4): the exact
// acquire→spawn→release→classify→ownership→commit→result choreography of
// exec-claude-writer's runClaudeWriter, exposed as an importable function so
// a Codex lane under true quota exhaustion can hand off and execute the SAME
// logical lane with Claude (engine-handoff.mjs drives it). NOT a second
// permit path: the claude permit is acquired exactly once per invocation —
// the handoff acquires it here via the injected permit flag, the standalone
// writer acquires it itself.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateLaneOwnership } from './path-ownership.mjs';
import { releaseLanePermit, observeClaudeOutcome } from './provider-pool.mjs';
import { claudeProviderEvent } from './exec-claude-writer.mjs';
import {
  claimCompletedUnits,
  laneEvidencePaths,
  parseTaskGraph,
  requireTaskGraphForCompletionEvidence,
} from './writer-task-evidence.mjs';

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Execute the logical lane with Claude.
 *
 *   input.acquiredPermit — when true, the caller (engine handoff) already
 *     holds the claude permit for `holder` and this core releases it in its
 *     finally-equivalent path. When false (unused today; the standalone
 *     writer keeps its own copy for per-writer nuance), the core acquires
 *     it first.
 */
export function runClaudeLaneCore(input) {
  // P0 hardening: the engine-handoff path executes the SAME evidence-backed
  // brief — it must satisfy the identical task-graph gate BEFORE any provider
  // spawn (the handoff releases no codex permit here, so failing here leaks
  // nothing).
  requireTaskGraphForCompletionEvidence({
    graphPath: input.taskGraphPath,
    taskIds: input.taskIds,
    engine: input.handedOffFrom === 'CODEX' ? 'CODEX->CLAUDE' : 'CLAUDE',
    lane: input.lane,
  });
  const brief = readFileSync(input.briefPath, 'utf8');
  const resultDir = input.resultsDir;
  mkdirSync(resultDir, { recursive: true });
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
  const before = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
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
        timeout: Number(input.timeoutMs ?? 45 * 60_000),
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } finally {
    // Finally-equivalent release immediately AFTER lane termination (H2 §2).
    // The handoff acquired the claude permit before calling this core.
    releaseLanePermit(input.stateDir, input.holder, 'claude');
  }
  const detail = `${run?.stderr ?? ''}\n${run?.stdout ?? ''}`;
  const classification =
    run?.error?.code === 'ETIMEDOUT'
      ? 'TIMEOUT'
      : run?.status === 0
        ? 'SUCCESS'
        : claudeProviderEvent('PROBE', detail).healthy
          ? 'SEMANTIC_OR_PROVIDER_FAILURE'
          : 'TRANSIENT_PROVIDER_FAILURE';
  // Engine-specific attribution: feed ONLY the Claude pool.
  try {
    observeClaudeOutcome(input.stateDir, claudeProviderEvent(classification, detail));
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
        holder: input.holder,
        handedOffFrom: input.handedOffFrom ?? null,
        wallTimeMs: Date.now() - started,
        outcome: classification,
      },
      null,
      2,
    )}\n`,
  );
  if (classification !== 'SUCCESS')
    throw new Error(`CLAUDE_LANE_CORE_${classification}: ${(run.stderr ?? '').slice(-500)}`);

  // Lane evidence diff (live 7c98e02e): committed work counts — status alone
  // sees a clean tree after the agent's own commits.
  const dirty = git(['status', '--porcelain=v1'], input.worktree)
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').at(-1));
  const evidencePaths = laneEvidencePaths({ worktree: input.worktree, before });
  const ownership = validateLaneOwnership({
    engine: 'CLAUDE',
    role: 'implementation',
    changedPaths: evidencePaths,
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
        `feat: Claude implementation lane ${input.lane} (engine handoff from Codex)`,
      ],
      input.worktree,
    );
    if (commit.status !== 0) throw new Error(`CLAUDE_COMMIT_FAILED: ${commit.stderr}`);
  }
  const head = git(['rev-parse', 'HEAD'], input.worktree).stdout.trim();
  // Evidence-backed nominations (H3 P0-1) over the handoff's actual diff
  // (committed ∪ uncommitted).
  let evidence = { graph: null, unitsById: null };
  if (input.taskGraphPath) {
    const parsed = parseTaskGraph(input.taskGraphPath);
    if (parsed) evidence = parsed;
  }
  const claims = claimCompletedUnits({
    taskIds: input.taskIds ?? [],
    changed: evidencePaths,
    unitsById: evidence.unitsById,
    blockers: [],
  });
  const result = {
    schema: 'foresift/writer-result@1',
    shardId: input.lane,
    role: 'implementation',
    engine: 'CLAUDE',
    handedOffFrom: input.handedOffFrom ?? null,
    completed: evidencePaths.length > 0 ? claims.nominated : [],
    deferredUnits:
      evidencePaths.length > 0
        ? claims.deferred
        : (input.taskIds ?? []).map((taskId) => ({ taskId, reason: 'lane produced no diff' })),
    branch: git(['branch', '--show-current'], input.worktree).stdout.trim(),
    headSha: head,
    testsRun: [],
    testResults: 'reported in Claude transcript; deterministic gates remain authoritative',
    blockers: [],
  };
  writeFileSync(join(resultDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return { ok: true, lane: input.lane, result };
}
