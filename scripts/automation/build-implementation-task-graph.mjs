// Build the deterministic implementation task graph for ONE work package
// (implementation-acceleration override §5): parse the package's scoped
// tasks.md into machine-readable units, derive requirement traces, predicted
// write paths, test refs, explicit dependencies, and — with --plan-shards N —
// a bounded write-disjoint shard plan that a parallel writer wave can execute
// (override §6/§8/§9). Scheduling metadata only; never product authority.
//
// Deterministic derivation rules (documented, conservative):
//   unit id / done state   → checkbox lines `- [ ]` / `- [x]` T<digits>
//   parallelizable         → the plan's own `[P]` marker (disjoint-files claim)
//   requirements           → FR-*-NNN tokens in the task body ("Traces:" text)
//   acceptance criteria    → AC-NNN tokens in the task body
//   predictedWrites        → backticked repo-relative paths in the body
//   dependencies           → (a) explicit other T<id> tokens in the body;
//                            (b) units under a heading containing "(blocks"
//                            block every unit outside that heading.
//                            Phase order alone imposes NO dependency.
//   estimatedSize          → body word count: <60 small, <150 medium, else large
//
// Shard planning (--plan-shards N): non-[P] open units form one serial core
// shard (listed order). [P] open units are greedily first-fit into at most N-1
// additional shards: a unit joins the first shard with no predictedWrite
// intersection; overflow beyond N shards is appended to the last shard
// (serialized within it). allowedWritePaths = union of member paths, each
// validated against the package's writeScopes — a scope violation fails closed.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, loadCurrentMilestone, validateMilestoneState, findPackage } from './schema.mjs';

export const TASK_GRAPH_SCHEMA = 'foresift/impl-task-graph@1';

function fail(msg) {
  console.error(`impl-task-graph: ${msg}`);
  process.exit(1);
}

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
  if (process.argv[i] === '--tasks') args.tasks = process.argv[i + 1];
  if (process.argv[i] === '--plan-shards') args.planShards = parseInt(process.argv[i + 1], 10);
  if (process.argv[i] === '--out') args.out = process.argv[i + 1];
}
if (!args.package) fail('missing --package <id>');
if (args.planShards !== undefined && (!Number.isInteger(args.planShards) || args.planShards < 1))
  fail('--plan-shards must be a positive integer');

const root = args.root ?? repoRoot();

// ── authority inputs ──────────────────────────────────────────────────────────
const ms = loadCurrentMilestone(root);
if (!ms || validateMilestoneState(ms).length > 0)
  fail('current milestone state invalid or missing');
const pkg = findPackage(ms, args.package);
if (!pkg) fail(`package ${args.package} not found in milestone ${ms.milestoneId}`);

const tasksPath = args.tasks ?? join(root, 'specs', args.package, 'tasks.md');
let text;
try {
  text = readFileSync(tasksPath, 'utf8');
} catch {
  fail(`cannot read ${tasksPath}`);
}

const headR = spawnSync(`git rev-parse HEAD`, { shell: true, cwd: root, encoding: 'utf8' });
const headSha = headR.status === 0 ? (headR.stdout ?? '').trim() : null;

// ── parse checkbox units ──────────────────────────────────────────────────────
const UNIT_ID = /^T\d+$/;
const lines = text.split('\n');
const units = [];
let heading = '';
let cur = null;
const flush = () => {
  if (cur) units.push(cur);
  cur = null;
};
for (const line of lines) {
  const m = line.match(/^- \[([ x])\] (.*)$/);
  if (m) {
    flush();
    const idTok = m[2].split(/\s+/).find((t) => UNIT_ID.test(t));
    if (!idTok) continue; // non-numbered checkbox: not a schedulable unit
    cur = {
      id: idTok,
      done: m[1] === 'x',
      parallelizable: /\[P\]/.test(m[2]),
      phase: heading,
      body: m[2],
    };
    continue;
  }
  if (/^#{1,6}\s/.test(line)) {
    flush();
    heading = line.replace(/^#+\s*/, '').trim();
    continue;
  }
  if (cur) cur.body += '\n' + line;
}
flush();
if (units.length === 0) fail(`no numbered checkbox units found in ${tasksPath}`);

// ── derive per-unit metadata ──────────────────────────────────────────────────
const BACKTICK_PATH = /`([^`\n]+)`/g;
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
const scopeRes = (pkg.writeScopes ?? []).map(globToRegExp);

for (const u of units) {
  const idsInBody = [...u.body.matchAll(/\bT\d+\b/g)].map((m) => m[0]);
  const reqs = [...new Set([...u.body.matchAll(/\bFR-[A-Z]+-\d+\b/g)].map((m) => m[0]))].sort();
  const acs = [...new Set([...u.body.matchAll(/\bAC-\d+\b/g)].map((m) => m[0]))].sort();
  const paths = [];
  for (const bt of u.body.matchAll(BACKTICK_PATH)) {
    const p = bt[1].replace(/^\.\//, '');
    if (/^(packages|tests|telemetry|migrations|docs|scripts)\//.test(p) && !paths.includes(p))
      paths.push(p);
  }
  // Paths are classified against binding writeScopes: a plan-sanctioned
  // exception (e.g. a guard task that merely names an out-of-scope file) is
  // recorded separately and DEMOTES the unit to serial execution — it never
  // widens what a parallel writer may touch.
  const inScope = [];
  const outOfScope = [];
  for (const p of paths) (scopeRes.some((re) => re.test(p)) ? inScope : outOfScope).push(p);
  const words = u.body.split(/\s+/).filter(Boolean).length;
  u.requirements = reqs;
  u.acceptanceCriteria = acs;
  u.predictedWrites = inScope.sort();
  u.outOfScopeWrites = outOfScope.sort();
  u.testRefs = paths.filter((p) => p.startsWith('tests/')).sort();
  u.dependsOn = [
    ...new Set(idsInBody.filter((t) => t !== u.id && units.some((o) => o.id === t))),
  ].sort();
  u.estimatedSize = words < 60 ? 'small' : words < 150 ? 'medium' : 'large';
}

// Blocking phases: every unit inside a "(blocks" heading blocks all outside it.
const blockingUnits = new Set(units.filter((u) => /\(blocks/i.test(u.phase)).map((u) => u.id));
for (const u of units)
  for (const b of blockingUnits)
    if (
      !u.dependsOn.includes(b) &&
      b !== u.id &&
      !(blockingUnits.has(u.id) && blockingUnits.has(b))
    )
      u.dependsOn.push(b);
for (const u of units) u.dependsOn.sort();

const open = units.filter((u) => !u.done);

// ── shard planning ────────────────────────────────────────────────────────────
let shards = null;
if (args.planShards !== undefined) {
  // Units whose predicted writes leave binding writeScopes are demoted to the
  // serial core shard; their paths are recorded as explicit scope exceptions.
  const scopeDemoted = open.filter((u) => u.outOfScopeWrites.length > 0);
  // A [P] unit may run beside the concurrently-executing core ONLY if it
  // neither writes a core path nor depends on a core unit; otherwise it is
  // demoted into the core lane (conservative cross-lane disjointness).
  const nonP = open.filter((u) => !u.parallelizable);
  const coreSeed = [...nonP, ...scopeDemoted];
  const coreIds = new Set(coreSeed.map((u) => u.id));
  const coreWriteSet = new Set(coreSeed.flatMap((u) => u.predictedWrites));
  const clashesCore = (u) =>
    u.predictedWrites.some((p) => coreWriteSet.has(p)) || u.dependsOn.some((d) => coreIds.has(d));
  const clashDemoted = open.filter(
    (u) => u.parallelizable && u.outOfScopeWrites.length === 0 && clashesCore(u),
  );
  const serial = [...coreSeed, ...clashDemoted];
  const par = open.filter(
    (u) =>
      u.parallelizable &&
      u.outOfScopeWrites.length === 0 &&
      !coreIds.has(u.id) &&
      !clashDemoted.includes(u),
  );
  const extra = Math.max(0, args.planShards - 1); // core shard occupies one slot
  const SIZE_W = { small: 1, medium: 2, large: 4 };
  const groups = Array.from({ length: extra }, () => ({ units: [], writes: new Set(), load: 0 }));
  const unitSize = (u) => SIZE_W[u.estimatedSize] ?? 2;
  for (const u of par) {
    // Compatible = write-disjoint AND dependency-disjoint; among those prefer
    // the least-loaded shard so work spreads instead of piling onto shard-1.
    const compatible = groups.filter(
      (g) =>
        g.units.length > 0 &&
        !u.predictedWrites.some((p) => g.writes.has(p)) &&
        !u.dependsOn.some((d) => g.units.some((x) => x.id === d)),
    );
    // An unused group is also a candidate — otherwise the first group hoovers
    // up every unit even when another writer slot sits idle.
    const empty = groups.find((g) => g.units.length === 0);
    const pool = [...compatible, ...(empty ? [empty] : [])];
    const target =
      pool.sort((a, b) => a.load - b.load || a.units.length - b.units.length)[0] ?? groups[0];
    target.units.push(u.id);
    for (const p of u.predictedWrites) target.writes.add(p);
    target.load += unitSize(u);
  }
  shards = [
    ...(serial.length
      ? [
          {
            id: 'core',
            mode: 'serial',
            units: serial.map((u) => u.id),
          },
        ]
      : []),
    ...groups
      .filter((g) => g.units.length > 0)
      .map((g, i) => ({
        id: `shard-${i + 1}`,
        mode: 'parallel',
        units: g.units,
      })),
  ];
  // allowedWritePaths per shard: union of member predictedWrites (parallel
  // shards carry only in-scope paths; the core shard may additionally carry
  // recorded scope exceptions).
  for (const s of shards) {
    const writes = new Set();
    for (const uid of s.units) {
      const u = open.find((x) => x.id === uid);
      for (const p of u.predictedWrites) writes.add(p);
      if (s.mode === 'serial') for (const p of u.outOfScopeWrites) writes.add(p);
    }
    s.allowedWritePaths = [...writes].sort();
    s.estimatedSize = s.units
      .map((uid) => open.find((x) => x.id === uid).estimatedSize)
      .reduce((acc, sz) => ({ small: 1, medium: 2, large: 4 })[sz] + acc, 0);
  }
}

// ── emit ──────────────────────────────────────────────────────────────────────
const graph = {
  schema: TASK_GRAPH_SCHEMA,
  package: { id: pkg.id, risk: pkg.risk, writeScopes: pkg.writeScopes ?? [] },
  bound: { mainHeadSha: headSha, tasksFile: tasksPath },
  totals: {
    units: units.length,
    done: units.filter((u) => u.done).length,
    open: open.length,
    openParallelizable: open.filter((u) => u.parallelizable).length,
  },
  units,
  ...(shards
    ? {
        shards,
        writerSlotsRequested: args.planShards,
        scopeExceptions: [...new Set(open.flatMap((u) => u.outOfScopeWrites))].sort(),
      }
    : {}),
};
const outJson = JSON.stringify(graph, null, 2) + '\n';
if (args.out) writeFileSync(args.out, outJson);
else process.stdout.write(outJson);
console.error(
  `impl-task-graph: ${graph.totals.open}/${graph.totals.units} open units` +
    (shards ? `, ${shards.length} shard(s) planned` : ''),
);
