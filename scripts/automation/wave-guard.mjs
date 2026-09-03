// Per-lane deterministic write-authority guard for a sharded wave
// (implementation-acceleration override §9). Recomputes the lane's actual diff
// against the pinned base directly from git — the writer's own claims about
// branch/head are never trusted — enforces allowedWritePaths ⊆ scopes (+ any
// graph-recorded scope exceptions), and OVERWRITES the lane's result.json with
// computed facts so the integrator consumes verified data only.
//
// Exit 0: authority held (including an idle lane with zero commits).
// Exit 1: violation or unusable evidence — the lane is rejected closed.
//
// Usage:
//   node scripts/automation/wave-guard.mjs --shard <id> \
//     --artifacts <dir> --graph <task-graph.json> [--root <repo>]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './schema.mjs';
import { validateLaneOwnership } from './path-ownership.mjs';

function fail(reason) {
  console.error(`wave-guard: ${reason}`);
  process.exit(1);
}

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--shard') args.shard = process.argv[i + 1];
  if (process.argv[i] === '--artifacts') args.artifacts = process.argv[i + 1];
  if (process.argv[i] === '--graph') args.graph = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
}
if (!args.shard || !args.artifacts || !args.graph) fail('missing --shard/--artifacts/--graph');

const root = args.root ?? repoRoot();
const git = (cmd, cwd = root) => {
  const r = spawnSync(`git ${cmd}`, { shell: true, cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

const meta = JSON.parse(readFileSync(join(args.artifacts, 'shard-meta.json'), 'utf8'));
const shardMeta = meta[args.shard];
if (!shardMeta) fail(`no worktree metadata for shard ${args.shard}`);

const graph = JSON.parse(readFileSync(args.graph, 'utf8'));
const allLanes = [...(graph.shards ?? []), ...(graph.testLanes ?? [])];
const shard = allLanes.find((s) => s.id === args.shard) ?? {
  id: args.shard,
  mode: 'unknown',
  units: [],
  allowedWritePaths: [],
};

const baseSha = readFileSync(join(args.artifacts, 'base-head.txt'), 'utf8').trim();
const headR = git(`rev-parse ${shardMeta.branch}`);
if (!headR.ok) fail(`branch ${shardMeta.branch} missing: ${headR.err}`);
const headSha = headR.out;

// Actual changed files base..head (recomputed here, never taken from claims).
// Symlinks are tooling plumbing, never authorship (live 486a44d0: a lane
// agent's node_modules reuse symlink was swallowed into a lane commit because
// gitignore's `node_modules/` matches directories, not a symlink blob — the
// guard must not count it against the lane).
let changed = [];
if (headSha !== baseSha) {
  const d = git(`diff --name-only ${baseSha}..${headSha}`);
  if (!d.ok) fail(`cannot diff base..head: ${d.err}`);
  changed = d.out
    .split('\n')
    .filter(Boolean)
    .filter((p) => {
      try {
        return !lstatSync(join(shardMeta.worktree, p)).isSymbolicLink();
      } catch {
        return true; // path absent from the worktree (renamed/deleted) — keep it in evidence
      }
    });
}

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
const allowed = [
  ...(shard?.allowedWritePaths ?? []).map(globToRegExp),
  ...(graph.package.writeScopes ?? []).map(globToRegExp),
];
// Cross-lane ownership: files PREDICTED by another active shard may not be
// touched by this lane even though they sit inside package scopes — EXCEPT
// graph-recorded scope exceptions. An exception (e.g. the central migration
// registry `packages/persistence/test/migrator.spec.ts`) is a plan-sanctioned
// duty that BOTH sides may legitimately carry: T003-class implementation units
// name the central suite in their recorded exceptions while the test lane owns
// it as testWrites. Excluding exceptions here caused a deterministic
// self-collision observed live (runs 831d0819/99e8e23b, 2026-08-30): the plan
// handed the file to the test lane, then the guard rejected the same lane for
// touching it — every restart of that package failed identically.
//
// Chained serial batches (mission item 4) share one write column BY DESIGN:
// core-batch-N lanes all carry the serial column's union, so a path predicted
// by another batch is a plan-sanctioned revisit (batch 2 legitimately touches a
// file batch 1 created), not a cross-lane conflict. Only lanes OUTSIDE the
// batch's chain count as "others" (live self-collision: run e44f577a, 2026-09-01
// — guard-serial-1 refused T004/T005/T006/T007-class paths that core-batch-2/3
// merely inherited from the shared column).
const chainMates =
  shard?.chainId != null
    ? new Set(allLanes.filter((s) => s.chainId === shard.chainId).map((s) => s.id))
    : null;
const othersPredicted = new Set(
  allLanes
    .filter((s) => s.id !== args.shard && !(chainMates?.has(s.id) ?? false))
    .flatMap((s) => s.allowedWritePaths ?? []),
);
const exceptions = new Set(graph.scopeExceptions ?? []);
const violations = changed.filter(
  (p) =>
    (!allowed.some((re) => re.test(p)) && !exceptions.has(p)) ||
    (othersPredicted.has(p) && !exceptions.has(p)),
);
const ownership = shard.role
  ? validateLaneOwnership({ engine: shard.engine, role: shard.role, changedPaths: changed })
  : { ok: true, violations: [] };

// Carry over whatever the writer claimed about completed units (bookkeeping
// only — code truth is decided by the merge + downstream gates).
let claimed = {};
const resPath = join(args.artifacts, 'writer-results', args.shard, 'result.json');
if (existsSync(resPath)) {
  try {
    claimed = JSON.parse(readFileSync(resPath, 'utf8'));
  } catch {
    claimed = { unreadableClaim: true };
  }
}

const verdict = {
  schema: 'foresift/writer-result@1',
  shardId: args.shard,
  mode: shard?.mode ?? 'unknown',
  // lane role from the task graph so the integrator can distinguish
  // implementation from test bookkeeping (test units complete without
  // product checkbox semantics).
  role: shard?.role ?? 'implementation',
  engine: shard?.engine ?? null,
  assignedUnits: shard?.units ?? [],
  completed: Array.isArray(claimed.completed) ? claimed.completed : [],
  testsRun: claimed.testsRun ?? [],
  testResults: claimed.testResults ?? 'unknown',
  baselineClassifications: Array.isArray(claimed.baselineClassifications)
    ? claimed.baselineClassifications
    : [],
  blockers: claimed.blockers ?? [],
  // computed facts (override §9 — never trust AI claims):
  branch: shardMeta.branch,
  worktree: shardMeta.worktree,
  baseSha,
  headSha,
  changedFiles: changed.length,
  authorityOk: violations.length === 0 && ownership.ok,
  ownership,
  violations: [...violations, ...(ownership.ok ? [] : ownership.violations)],
};

if (verdict.violations.length > 0) {
  mkdirSync(join(args.artifacts, 'writer-results', args.shard), { recursive: true });
  writeFileSync(resPath, JSON.stringify(verdict, null, 2) + '\n');
  console.error(`wave-guard: WRITE-AUTHORITY VIOLATION in ${args.shard}:`);
  for (const v of verdict.violations) console.error(`  - ${v}`);
  process.exit(1);
}

mkdirSync(join(args.artifacts, 'writer-results', args.shard), { recursive: true });
writeFileSync(resPath, JSON.stringify(verdict, null, 2) + '\n');
console.log(
  `wave-guard: ${args.shard} ok — ${changed.length} file(s), ${verdict.completed.length} unit(s) claimed`,
);
