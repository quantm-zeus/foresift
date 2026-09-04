// Coordinator join for a parallel writer wave (override §9/§15/§16): verify
// each writer's result manifest, RE-verify write authority directly against
// git (never trust the writer's own claim), merge passing shards additively
// into the canonical branch, mark completed units in canonical tasks.md, and
// emit an integration report. A failing shard is skipped closed — it never
// corrupts the canonical branch. No rebase, no force-push, no ours/theirs.
//
// Usage:
//   node scripts/automation/integrate-writer-results.mjs --package <id> \
//     --graph <task-graph.json> --results-dir <dir> \
//     [--canonical <checkout-path>] [--branch <name>] [--root <repo>] \
//     [--out <report.json>]
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, writeFileSync, lstatSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { repoRoot } from './schema.mjs';
import { validateLaneOwnership } from './path-ownership.mjs';
import { validateLaneNominations, unitsIndexFromGraph } from './task-completion-evidence.mjs';

function fail(msg) {
  console.error(`integrate-writers: ${msg}`);
  process.exit(1);
}
const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--graph') args.graph = process.argv[i + 1];
  if (process.argv[i] === '--results-dir') args.resultsDir = process.argv[i + 1];
  if (process.argv[i] === '--canonical') args.canonical = process.argv[i + 1];
  if (process.argv[i] === '--branch') args.branch = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
  if (process.argv[i] === '--out') args.out = process.argv[i + 1];
}
if (!args.package) fail('missing --package <id>');
if (!args.graph) fail('missing --graph <task-graph.json>');
if (!args.resultsDir) fail('missing --results-dir <dir>');

const root = args.root ?? repoRoot();
const canonical = args.canonical ?? root;
const graph = JSON.parse(readFileSync(args.graph, 'utf8'));
const allLanes = [...(graph.shards ?? []), ...(graph.testLanes ?? [])];
const shardById = new Map(allLanes.map((s) => [s.id, s]));
const scopeExceptions = new Set(graph.scopeExceptions ?? []);

const git = (cmd, cwd = canonical) => {
  const r = spawnSync(`git ${cmd}`, { shell: true, cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += glob[i + 2] === '/' ? '(?:[^/]+/)*' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

const report = {
  schema: 'foresift/wave-integration@1',
  package: args.package,
  integrated: [],
  rejected: [],
  completionRejections: [],
};

if (!existsSync(args.resultsDir)) fail(`results dir not found: ${args.resultsDir}`);
// Results live at <resultsDir>/<lane>/result.json (as wave-guard writes them);
// flat <lane>.json files are accepted too.
const resultFiles = [];
for (const e of readdirSync(args.resultsDir, { withFileTypes: true })) {
  if (e.isDirectory() && existsSync(join(args.resultsDir, e.name, 'result.json')))
    resultFiles.push(join(args.resultsDir, e.name, 'result.json'));
  else if (e.isFile() && e.name.endsWith('.json')) resultFiles.push(join(args.resultsDir, e.name));
}
resultFiles.sort();

for (const filePath of resultFiles) {
  let res;
  try {
    res = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    report.rejected.push({ file: filePath, reason: `unreadable result json: ${e.message}` });
    continue;
  }
  const laneName = filePath.endsWith('result.json')
    ? basename(dirname(filePath))
    : basename(filePath).replace(/\.json$/, '');
  const sid = res.shardId ?? laneName;
  const shard = shardById.get(sid);
  if (!shard) {
    report.rejected.push({ shardId: sid, reason: 'no such shard in task graph' });
    continue;
  }

  // ── write-authority re-verification against git (never trust claims) ────────
  if (!res.branch || !res.headSha || !res.baseSha) {
    report.rejected.push({ shardId: sid, reason: 'result missing branch/headSha/baseSha' });
    continue;
  }
  const branchExists = git(`rev-parse --verify ${res.branch}`, canonical);
  if (!branchExists.ok) {
    report.rejected.push({ shardId: sid, reason: `branch ${res.branch} not found` });
    continue;
  }
  const actualHead = git(`rev-parse ${res.branch}`, canonical).out;
  if (actualHead !== res.headSha) {
    report.rejected.push({
      shardId: sid,
      reason: `headSha mismatch: claimed ${res.headSha}, branch is ${actualHead}`,
    });
    continue;
  }
  const diffNames = git(`diff --name-only ${res.baseSha}..${res.headSha}`, canonical);
  if (!diffNames.ok) {
    report.rejected.push({ shardId: sid, reason: `cannot diff base..head: ${diffNames.err}` });
    continue;
  }
  // Symlinks are tooling plumbing, never authorship (live 486a44d0: a lane
  // agent's node_modules reuse symlink was swallowed into a lane commit
  // because gitignore's `node_modules/` matches directories, not a symlink
  // blob). Filtered before legality/ownership/nomination checks.
  const resultDir = join(args.resultsDir, sid);
  const changedPaths = diffNames.out
    .split('\n')
    .filter(Boolean)
    .filter((p) => {
      try {
        return !lstatSync(join(resultDir, '..', '..', 'wt', sid, p)).isSymbolicLink();
      } catch {
        return true; // absent from the worktree (renamed/deleted) — keep in evidence
      }
    });
  // Authority: package scopes (+ recorded exceptions) for legality, plus strict
  // cross-lane ownership — files predicted by ANOTHER shard may not appear here.
  const allowed = [
    ...shard.allowedWritePaths.map(globToRegExp),
    ...(graph.package.writeScopes ?? []).map(globToRegExp),
  ];
  // Chained serial batches (mission item 4) share one write column BY DESIGN:
  // core-batch-N lanes all carry the serial column's union, so a path predicted
  // by another batch is a plan-sanctioned revisit, never a cross-lane conflict
  // (mirrors wave-guard.mjs; live self-collision run e44f577a, 2026-09-01).
  const chainMates =
    shard.chainId != null
      ? new Set(allLanes.filter((s) => s.chainId === shard.chainId).map((s) => s.id))
      : null;
  const othersPredicted = new Set(
    allLanes
      .filter((s) => s.id !== sid && !(chainMates?.has(s.id) ?? false))
      .flatMap((s) => s.allowedWritePaths ?? []),
  );
  // Cross-lane exclusion must not fire on graph-recorded scope exceptions:
  // the central migration registry is a plan-sanctioned duty both sides may
  // write (mirrors wave-guard.mjs; live self-collision runs 831d0819/99e8e23b).
  const violations = changedPaths.filter(
    (p) =>
      (!allowed.some((re) => re.test(p)) && !scopeExceptions.has(p)) ||
      (othersPredicted.has(p) && !scopeExceptions.has(p)),
  );
  if (violations.length > 0) {
    report.rejected.push({
      shardId: sid,
      reason: 'write-authority violation',
      violations,
    });
    continue;
  }
  if (shard.role) {
    const ownership = validateLaneOwnership({
      engine: shard.engine,
      role: shard.role,
      changedPaths,
    });
    if (!ownership.ok) {
      report.rejected.push({
        shardId: sid,
        reason: ownership.violationCode,
        violations: ownership.violatingPaths,
      });
      continue;
    }
  }
  // Evidence-backed completion validation (H3 P0-1, fail-closed): the
  // coordinator re-validates every nominated ID against ITS OWN recomputed
  // diff (this script's git truth above, `diffNames`), lane membership from
  // the task graph, and the writer's declared blockers. Missing/ambiguous
  // evidence ⇒ the task stays OPEN. One accepted nomination never implies
  // sibling tasks are complete; a model merely saying "done" completes
  // nothing. A lane that produced a real diff but nominated nothing is a
  // completion-protocol refusal (never merged blindly as fully-done).
  const claimedUnits = Array.isArray(res.completed) ? res.completed : [];
  const laneUnits = new Set(shard.units ?? []);
  const unitsById = unitsIndexFromGraph(graph);
  const validated = validateLaneNominations({
    laneTaskIds: [...laneUnits],
    unitsById,
    changedFiles: changedPaths,
    nominatedTaskIds: claimedUnits,
    blockers: res.blockers ?? [],
  });
  if (validated.rejected.length > 0) {
    report.completionRejections.push({ shardId: sid, rejected: validated.rejected });
  }
  if (validated.accepted.length === 0) {
    report.rejected.push({
      shardId: sid,
      reason: validated.rejected.length
        ? 'no nomination carried predicted-write evidence (tasks stay open)'
        : 'writer reported zero completed units',
      deferredEvidence: validated.rejected,
    });
    continue;
  }

  // ── additive integration into the canonical branch ──────────────────────────
  const beforeHead = git('rev-parse HEAD', canonical).out;
  const merge = git(`merge --no-ff -m "wave integration: ${sid}" ${res.branch}`, canonical);
  if (!merge.ok) {
    git('merge --abort', canonical); // best-effort reset; never leave a conflicted index
    report.rejected.push({
      shardId: sid,
      reason: `merge conflict/failed: ${merge.err.split('\n')[0]}`,
    });
    continue;
  }
  const afterHead = git('rev-parse HEAD', canonical).out;
  report.integrated.push({
    shardId: sid,
    role: shard.role ?? 'implementation',
    units: validated.accepted,
    baselineClassifications: res.baselineClassifications ?? [],
    branch: res.branch,
    beforeHead,
    afterHead,
  });
}

// ── canonical bookkeeping: mark evidence-accepted units in tasks.md ──────────
// Only coordinator-VALIDATED nominations (predicted-write evidence in the
// recomputed diff) reach this point, so the checkbox flip is authoritative.
// One accepted task never flips its siblings: whatever the writer deferred
// stays an open `- [ ]` line in the canonical tasks.md.
//
// Role does not gate the flip — evidence ownership does (directive §5, live
// g1-solana-security defect): a validated TEST-role lane's nominations carry
// the same guarantees (lane membership from the task graph, predicted/
// testWrite evidence in the recomputed diff, no declared blockers) plus the
// TEST-only path-ownership guard, so a test lane can mark exactly its own
// test-bearing tasks and nothing else. Filtering on role === 'implementation'
// left every AGY test-author checkbox permanently open while its (validated)
// files were already merged into the canonical branch.
const completedUnits = new Set(report.integrated.flatMap((r) => r.units));
if (completedUnits.size > 0) {
  const tasksPath = join(canonical, 'specs', args.package, 'tasks.md');
  if (existsSync(tasksPath)) {
    const lines = readFileSync(tasksPath, 'utf8').split('\n');
    let touched = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^- \[ \] (T\d+)(.*)$/);
      if (m && completedUnits.has(m[1])) {
        lines[i] = `- [x] ${m[1]}${m[2]}`;
        touched++;
        completedUnits.delete(m[1]);
      }
    }
    if (touched > 0) {
      writeFileSync(tasksPath, lines.join('\n'));
      git(`add specs/${args.package}/tasks.md`, canonical);
      const commit = git(
        `-c user.email=noreply@foresift.local -c user.name='wave-coordinator' commit -m "chore(${args.package}): mark wave-completed units [${touched}]"`,
        canonical,
      );
      report.tasksMarked = { touched, committed: commit.ok };
    }
    report.unitsNotMarked = [...completedUnits]; // completed but absent/open in canonical
  } else {
    report.unitsNotMarked = [...completedUnits];
    report.tasksMarked = { touched: 0, committed: false, note: 'canonical tasks.md missing' };
  }
}

const outJson = JSON.stringify(report, null, 2) + '\n';
if (args.out) writeFileSync(args.out, outJson);
else process.stdout.write(outJson);
console.error(
  `integrate-writers: integrated=${report.integrated.length} rejected=${report.rejected.length}`,
);
