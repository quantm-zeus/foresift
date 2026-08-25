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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './schema.mjs';

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
const shard = (graph.shards ?? []).find((s) => s.id === args.shard);

const baseSha = readFileSync(join(args.artifacts, 'base-head.txt'), 'utf8').trim();
const headR = git(`rev-parse ${shardMeta.branch}`);
if (!headR.ok) fail(`branch ${shardMeta.branch} missing: ${headR.err}`);
const headSha = headR.out;

// Actual changed files base..head (recomputed here, never taken from claims).
let changed = [];
if (headSha !== baseSha) {
  const d = git(`diff --name-only ${baseSha}..${headSha}`);
  if (!d.ok) fail(`cannot diff base..head: ${d.err}`);
  changed = d.out.split('\n').filter(Boolean);
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
// touched by this lane even though they sit inside package scopes.
const othersPredicted = new Set(
  (graph.shards ?? []).filter((s) => s.id !== args.shard).flatMap((s) => s.allowedWritePaths ?? []),
);
const exceptions = new Set(graph.scopeExceptions ?? []);
const violations = changed.filter(
  (p) => (!allowed.some((re) => re.test(p)) && !exceptions.has(p)) || othersPredicted.has(p),
);

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
  assignedUnits: shard?.units ?? [],
  completed: Array.isArray(claimed.completed) ? claimed.completed : [],
  testsRun: claimed.testsRun ?? [],
  testResults: claimed.testResults ?? 'unknown',
  blockers: claimed.blockers ?? [],
  // computed facts (override §9 — never trust AI claims):
  branch: shardMeta.branch,
  worktree: shardMeta.worktree,
  baseSha,
  headSha,
  changedFiles: changed.length,
  authorityOk: violations.length === 0,
  violations,
};

if (violations.length > 0) {
  mkdirSync(join(args.artifacts, 'writer-results', args.shard), { recursive: true });
  writeFileSync(resPath, JSON.stringify(verdict, null, 2) + '\n');
  console.error(`wave-guard: WRITE-AUTHORITY VIOLATION in ${args.shard}:`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

mkdirSync(join(args.artifacts, 'writer-results', args.shard), { recursive: true });
writeFileSync(resPath, JSON.stringify(verdict, null, 2) + '\n');
console.log(
  `wave-guard: ${args.shard} ok — ${changed.length} file(s), ${verdict.completed.length} unit(s) claimed`,
);
