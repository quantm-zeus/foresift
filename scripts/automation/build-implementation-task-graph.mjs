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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, loadCurrentMilestone, validateMilestoneState, findPackage } from './schema.mjs';
import { classifyOwnedPath } from './path-ownership.mjs';
import { resolveTaskMetadata, isCoordinatorTask } from './task-metadata.mjs';
import { assertEvidenceOwnership } from './evidence-owner-registry.mjs';
import {
  implementationEngineForProfile,
  resolveExecutionProfile,
  testEngineForProfile,
} from './execution-profile.mjs';

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
  if (process.argv[i] === '--execution-profile') args.executionProfile = process.argv[i + 1];
  if (process.argv[i] === '--out') args.out = process.argv[i + 1];
}
if (!args.package) fail('missing --package <id>');
if (args.planShards !== undefined && (!Number.isInteger(args.planShards) || args.planShards < 1))
  fail('--plan-shards must be a positive integer');
if (args.executionProfile && args.planShards > 3)
  fail('fresh execution profiles support at most 3 product writers');

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
    // Explicit executor/kind metadata (H3 P0-5): [executor: X] / [kind: Y]
    // markers parsed and validated fail-closed — an UNKNOWN executor value is
    // a hard error here, never a silent writer dispatch. Legacy plans without
    // markers default to PRODUCT/IMPLEMENTATION.
    const metadata = resolveTaskMetadata(m[2]);
    cur = {
      id: idTok,
      done: m[1] === 'x',
      parallelizable: /\[P\]/.test(m[2]),
      phase: heading,
      body: m[2],
      executor: metadata.executor,
      kind: metadata.kind,
      evidence: metadata.evidence,
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
    // A backticked token containing whitespace is a COMMAND (e.g.
    // `scripts/x/cli.mjs generate`), not a writable path — recording it as a
    // predicted write made the evidence matcher compare a diff against a
    // string that can never be a filename (observed live on T016, run
    // 89c4b2b9). Commands are prose, never evidence paths.
    if (/\s/.test(p)) continue;
    // `pnpm-lock.yaml` and root `package.json` are collectible at the repo
    // root: the lockfile mechanically follows every workspace package scaffold,
    // and acceptance suites run under the root unit project, whose
    // devDependencies link each package exactly like every prior G0 package.
    // A unit that triggers either must be able to RECORD it as an out-of-scope
    // write exception instead of tripping the lane guard at integration time.
    if (
      (/^(packages|tests|telemetry|migrations|docs|scripts)\//.test(p) ||
        p === 'pnpm-lock.yaml' ||
        p === 'package.json') &&
      !paths.includes(p)
    )
      paths.push(p);
  }
  // Paths are classified against binding writeScopes: a plan-sanctioned
  // exception (e.g. a guard task that merely names an out-of-scope file) is
  // recorded separately and DEMOTES the unit to serial execution — it never
  // widens what a parallel writer may touch.
  //
  // Directory tokens (live T001/T002 class, run aa3e8015): a scaffold task
  // names its package DIRECTORY (`packages/requirement-manifest`), but the
  // binding scope is `packages/requirement-manifest/**` — `**/` requires a
  // trailing slash, so the bare directory never matched and the task's whole
  // write set fell to outOfScopeWrites. A token that IS the directory prefix
  // of some scope glob is squarely inside that scope (writing the directory
  // means writing its contents): normalize it to the scope's directory form
  // for classification. Nothing here widens any scope — the token must be a
  // strict prefix of a scope's literal part.
  const scopeDirs = (pkg.writeScopes ?? [])
    .map((g) => g.replace(/\*\*.*$/, '').replace(/\*.*$/, ''))
    .filter((d) => d.endsWith('/'))
    .map((d) => d.slice(0, -1));
  const classifyPath = (p) =>
    scopeRes.some((re) => re.test(p)) ||
    scopeDirs.some(
      (d) => p === d || (p.startsWith(d + '/') && !p.slice(d.length + 1).includes('/')),
    );
  const inScope = [];
  const outOfScope = [];
  for (const p of paths) (classifyPath(p) ? inScope : outOfScope).push(p);
  const words = u.body.split(/\s+/).filter(Boolean).length;
  u.requirements = reqs;
  u.acceptanceCriteria = acs;
  u.predictedWrites = inScope.sort();
  u.productWrites = u.predictedWrites.filter((p) => classifyOwnedPath(p) === 'PRODUCT');
  u.testWrites = paths.filter((p) => classifyOwnedPath(p) === 'TEST').sort();
  u.testOnly =
    u.productWrites.length === 0 &&
    (u.testWrites.length > 0 || /\b(?:test|fixture|acceptance|negative suite)\b/i.test(u.phase));
  u.productWork =
    !u.testOnly &&
    (u.productWrites.length > 0 ||
      /\b(?:implement|wire|add|define|create|extend|write|scaffold|author)\b/i.test(u.body));
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
// Zero-AI coordinator tasks are NEVER writer-assignable: they are excluded
// from every shard and every test lane at graph build time (the wave
// coordinator executes them mechanically post-integration; P0-5). The
// explicit [executor: COORDINATOR] marker replaced the old body-string
// manifest-path matcher — unknown executor values already failed closed
// above at parse time.
const coordinatorOpenIds = new Set(open.filter(isCoordinatorTask).map((u) => u.id));

// ── evidence-owner coverage (fail-closed, pre-writer cost) ────────────────────
// EVERY OPEN TASK HAS A REAL DETERMINISTIC COMPLETION OWNER. An open unit
// declaring a non-file evidence kind whose runtime consumer is not registered
// can never be completed — it would either block the package forever or tempt
// a manual/AI checkbox flip (forbidden). The registry assertion aborts the
// build here, before any writer/provider work is spent (G0 final delta,
// directive 4; live T025 case: COORDINATOR_ARTIFACT with no consumer).
assertEvidenceOwnership({
  units: open.map((u) => ({ id: u.id, done: false, evidence: u.evidence, executor: u.executor })),
});

// ── central migration registry duty (fail-closed, pre-writer cost) ───────────
// packages/persistence/test/migrator.spec.ts asserts EXACTLY the full
// migration script set across ALL generations (lexicographic,
// checksum-pinned). Any package whose tasks predict NEW migration scripts —
// g0_* or g1_* or any future g<N>_* — must also name that central suite as a
// (plan-sanctioned, scope-exception) write — the g0-provider-lifecycle
// precedent. The pattern is generation-agnostic (ADR-0019 amendment): a G0-
// pinned `g0_` regex let every G1 task sail through graph build with the duty
// unrecorded, deferring the failure to a deterministic persistence test
// failure inside package verification — the exact late, repair-budget-
// burning mode the guard exists to prevent. When the duty is missing, the
// wave guard legally refuses every
// repair that touches the central suite and the run exhausts its bounded
// repair budget deterministically (observed live 2026-08-28 on
// g0-cost-capacity). Refuse at graph build so no writer cost is burned.
const CENTRAL_MIGRATION_SUITE = 'packages/persistence/test/migrator.spec.ts';
{
  const migrationWriteRe = /^migrations\/g\d+_[a-z]+_\d+.*\.sql$/;
  const predictsNewMigrationScript = (u) =>
    (u.outOfScopeWrites ?? []).some(
      (p) => migrationWriteRe.test(p) && !existsSync(join(root, p)),
    ) ||
    (u.predictedWrites ?? []).some((p) => migrationWriteRe.test(p) && !existsSync(join(root, p)));
  const referencesCentralSuite = (u) => u.body.includes(CENTRAL_MIGRATION_SUITE);
  if (
    open.some(predictsNewMigrationScript) &&
    !open.some(referencesCentralSuite) &&
    !units.some(referencesCentralSuite)
  ) {
    fail(
      `CENTRAL_MIGRATION_SUITE_UNREFERENCED: tasks predict new migrations/g*_*.sql scripts but never name ${CENTRAL_MIGRATION_SUITE} — the central expected-script registry must be updated in the same package (plan-sanctioned scope exception)`,
    );
  }
}

// ── shard planning ────────────────────────────────────────────────────────────
let shards = null;
if (args.planShards !== undefined) {
  const productOpen = args.executionProfile
    ? open.filter((u) => u.productWork && !isCoordinatorTask(u))
    : open.filter((u) => !isCoordinatorTask(u));
  // Units whose predicted writes leave binding writeScopes are demoted to the
  // serial core shard; their paths are recorded as explicit scope exceptions.
  const scopeDemoted = productOpen.filter((u) => u.outOfScopeWrites.length > 0);
  // A [P] unit may run beside the concurrently-executing core ONLY if it
  // neither writes a core path nor depends on a core unit; otherwise it is
  // demoted into the core lane (conservative cross-lane disjointness).
  const nonP = productOpen.filter((u) => !u.parallelizable);
  // Dedupe by id: a non-[P] unit whose writes leave writeScopes qualifies for
  // BOTH lists, and the duplicate made core.units carry the same task twice
  // (observed live 2026-08-31, run 95c45071: core carried T001/T003/T005/
  // T009/T012/T015/T024 twice each).
  const coreSeed = [...new Map([...nonP, ...scopeDemoted].map((u) => [u.id, u])).values()];
  const coreIds = new Set(coreSeed.map((u) => u.id));
  const writesFor = (u) => (args.executionProfile ? u.productWrites : u.predictedWrites);
  const coreWriteSet = new Set(coreSeed.flatMap(writesFor));
  const clashesCore = (u) =>
    writesFor(u).some((p) => coreWriteSet.has(p)) || u.dependsOn.some((d) => coreIds.has(d));
  const clashDemoted = productOpen.filter(
    (u) => u.parallelizable && u.outOfScopeWrites.length === 0 && clashesCore(u),
  );
  const serial = [...coreSeed, ...clashDemoted];
  const par = productOpen.filter(
    (u) =>
      u.parallelizable &&
      u.outOfScopeWrites.length === 0 &&
      !coreIds.has(u.id) &&
      !clashDemoted.includes(u),
  );
  const extra = Math.max(
    0,
    args.executionProfile ? args.planShards - (serial.length > 0 ? 1 : 0) : args.planShards - 1,
  );
  const SIZE_W = { small: 1, medium: 2, large: 4 };
  const groups = Array.from({ length: extra }, () => ({ units: [], writes: new Set(), load: 0 }));
  const unitSize = (u) => SIZE_W[u.estimatedSize] ?? 2;
  // plan-shards 1 has NO parallel slots: leftover [P] units previously crashed
  // the plan (`target ?? groups[0]` is undefined — observed on the governor's
  // YELLOW path where adaptive lanes resolve to 1 and the wave prep then runs
  // the planner with --plan-shards 1). Demote them into the serial column
  // instead: the plan never drops work, and batching executes them serially.
  if (groups.length === 0) serial.push(...par);
  else
    for (const u of par) {
      // Compatible = write-disjoint AND dependency-disjoint; among those prefer
      // the least-loaded shard so work spreads instead of piling onto shard-1.
      const compatible = groups.filter(
        (g) =>
          g.units.length > 0 &&
          !writesFor(u).some((p) => g.writes.has(p)) &&
          !u.dependsOn.some((d) => g.units.some((x) => x.id === d)),
      );
      // An unused group is also a candidate — otherwise the first group hoovers
      // up every unit even when another writer slot sits idle.
      const empty = groups.find((g) => g.units.length === 0);
      const pool = [...compatible, ...(empty ? [empty] : [])];
      const target =
        pool.sort((a, b) => a.load - b.load || a.units.length - b.units.length)[0] ?? groups[0];
      target.units.push(u.id);
      for (const p of writesFor(u)) target.writes.add(p);
      target.load += unitSize(u);
    }
  // Cross-lane disjointness closure (observed live 2026-08-31, run 95c45071):
  // a parallel unit that clashes the core is demoted to core AFTER groups are
  // formed — but its writes may still collide with a group's writes (T017
  // depended on core units, was demoted to core, and still predicted
  // `packages/shared-schemas/src/trace.ts` which shard-1's T004 owned). The
  // wave guard correctly refused the lane, failing the run. Iterate: any
  // group unit whose writes collide with core's (or with another group's, or
  // whose dependency sits in core after demotion) is pulled into core until
  // the plan is provably pairwise write-disjoint again.
  const coreUnits = [...serial];
  const coreSet = new Set(coreUnits.map((u) => u.id));
  for (;;) {
    const coreWrites = new Set(coreUnits.flatMap((u) => writesFor(u)));
    const pulled = [];
    for (const g of groups) {
      for (const uid of [...g.units]) {
        const u = g.units.map((x) => x).length ? par.find((p) => p.id === uid) : null;
        if (!u) continue;
        const writeClash = writesFor(u).some(
          (p) => coreWrites.has(p) || [...groups].some((h) => h !== g && h.writes.has(p)),
        );
        const depClash =
          u.dependsOn.some((d) => coreSet.has(d)) ||
          u.dependsOn.some((d) => groups.some((h) => h !== g && h.units.includes(d)));
        if (writeClash || depClash) pulled.push({ g, uid, u });
      }
    }
    if (pulled.length === 0) break;
    for (const { g, uid, u } of pulled) {
      g.units.splice(g.units.indexOf(uid), 1);
      for (const p of writesFor(u)) g.writes.delete(p);
      g.load -= unitSize(u);
      if (!coreSet.has(uid)) {
        coreUnits.push(u);
        coreSet.add(uid);
      }
    }
  }
  serial.length = 0;
  serial.push(...coreUnits);

  // ── bounded lane-scope decomposition (H3 mission item 4) ─────────────────────
  // A serial core carrying EVERY non-parallelizable unit concentrates the whole
  // package's serial work in ONE lane: the writer spends its entire wall budget
  // inside a single lane scope (live g0-traceability-conformance: 17 units,
  // load 25, 56 write paths in one core lane) and everything past the timeout
  // is deferred to another full wave. Split the dependency-ordered serial
  // column into SEQUENTIAL batches of bounded estimated load; each batch is
  // its own chained lane (core-batch-1..N, each branching on its parent's
  // guarded head) so no lane scope exceeds the per-lane budget. One batch ⇒
  // the legacy single `core` lane (byte-identical shape for small packages).
  // Batches share one write-authority column (chainId 'core'): guards and the
  // integrator treat same-chain lanes as sequential siblings, never as
  // cross-lane collisions.
  const CORE_BATCH_MAX_LOAD = 8;
  const CORE_BATCH_MAX_LANES = 3; // wired in foresift-sharded-wave.yaml
  // Stable topological order: repeatedly take the FIRST listed unit whose
  // in-column dependencies are all placed. Dependencies on units outside the
  // serial column (done units, parallel lanes) are not intra-lane ordering
  // constraints. Fixes the listed-order dependency inversions the raw plan
  // order can carry (g0-traceability: T005..T024 listed before T002/T004 yet
  // depending on them).
  const inColumn = new Set(serial.map((u) => u.id));
  const placed = new Set();
  const serialOrdered = [];
  for (;;) {
    const next = serial.find(
      (u) => !placed.has(u.id) && u.dependsOn.every((d) => !inColumn.has(d) || placed.has(d)),
    );
    if (!next) break;
    placed.add(next.id);
    serialOrdered.push(next);
  }
  for (const u of serial) if (!placed.has(u.id)) serialOrdered.push(u); // defensive: cycles keep listed order
  const unitLoad = unitSize;
  const batches = [];
  let cur = { units: [], load: 0 };
  for (const u of serialOrdered) {
    if (cur.units.length > 0 && cur.load + unitLoad(u) > CORE_BATCH_MAX_LOAD) {
      batches.push(cur);
      cur = { units: [], load: 0 };
    }
    cur.units.push(u.id);
    cur.load += unitLoad(u);
  }
  if (cur.units.length > 0) batches.push(cur);
  // Overflow beyond the wired lane count folds into the LAST batch — the
  // alternative (dropping units) would silently unschedule work. The folded
  // batch is flagged laneTooLarge so the canary evidence sees the residual.
  while (batches.length > CORE_BATCH_MAX_LANES) {
    const extra = batches.pop();
    const last = batches[batches.length - 1];
    last.units.push(...extra.units);
    last.load += extra.load;
    last.overflow = true;
  }
  shards = [
    ...(batches.length
      ? batches.map((b, i) => ({
          id: batches.length === 1 ? 'core' : `core-batch-${i + 1}`,
          mode: 'serial',
          ...(batches.length > 1
            ? {
                chainId: 'core',
                batchIndex: i + 1,
                batchOf: batches.length,
                chainsFrom: i === 0 ? null : `core-batch-${i}`,
                laneTooLarge: b.overflow === true,
              }
            : {}),
          units: b.units,
        }))
      : []),
    ...groups
      .filter((g) => g.units.length > 0)
      .map((g, i) => ({
        id:
          args.executionProfile && serial.length === 0
            ? i === 0
              ? 'core'
              : `shard-${i}`
            : `shard-${i + 1}`,
        mode: 'parallel',
        units: g.units,
      })),
  ];
  // allowedWritePaths per shard: parallel shards carry the union of member
  // predictedWrites only; SERIAL lanes carry the WHOLE serial column's union
  // (a chained batch legitimately revisits column paths — e.g. a generated
  // docs glob two batches apart) plus the column's recorded scope exceptions.
  // estimatedSize stays the lane's OWN load (the per-lane work truth).
  const columnUnits = serial.slice();
  const columnWrites = [...new Set(columnUnits.flatMap(writesFor))].sort();
  const columnExceptions = [...new Set(columnUnits.flatMap((u) => u.outOfScopeWrites))].sort();
  for (const s of shards) {
    if (s.mode === 'serial') {
      s.allowedWritePaths = [...columnWrites, ...columnExceptions].sort();
      s.estimatedSize = s.units
        .map((uid) => unitLoad(open.find((x) => x.id === uid)))
        .reduce((acc, n) => n + acc, 0);
      continue;
    }
    const writes = new Set();
    for (const uid of s.units) {
      const u = open.find((x) => x.id === uid);
      for (const p of writesFor(u)) writes.add(p);
    }
    s.allowedWritePaths = [...writes].sort();
    s.estimatedSize = s.units
      .map((uid) => open.find((x) => x.id === uid).estimatedSize)
      .reduce((acc, sz) => ({ small: 1, medium: 2, large: 4 })[sz] + acc, 0);
  }
}

const executionProfile = args.executionProfile
  ? resolveExecutionProfile(args.executionProfile)
  : null;
if (executionProfile && shards) {
  const engine = implementationEngineForProfile(executionProfile);
  for (const shard of shards) {
    shard.role = 'implementation';
    shard.engine = engine;
  }
}
const testUnits = executionProfile
  ? open.filter(
      (u) =>
        !isCoordinatorTask(u) &&
        (u.testWrites.length > 0 ||
          u.testRefs.length > 0 ||
          u.acceptanceCriteria.length > 0 ||
          /\b(?:test|regression|fixture|fuzz|property)\b/i.test(u.body)),
    )
  : [];
/**
 * Bounded write-disjoint AGY test sharding (maintainer Part E, 2026-09-03):
 * split test-bearing units into AT MOST MAX_AGY_TEST_LANES lanes ONLY when the
 * exact testWrites sets are provably disjoint across every lane pair AND no
 * unit shares a write with another lane's set. Anything ambiguous (unknown or
 * overlapping writes, shared fixture/manifest/parity-suite paths) collapses
 * back to the single historical `test-author` lane — never splits on
 * filenames alone. AGY test lanes never gain product write authority: role
 * stays 'test' and the path-ownership guard is unchanged. The canary cap is
 * hard-wired at 2 lanes below (test-author-1/test-author-2).
 */
function shardTestLanes(units, engine) {
  const lane = (id, us) => ({
    id,
    mode: 'parallel',
    role: 'test',
    engine,
    units: us.map((u) => u.id),
    allowedWritePaths: [...new Set(us.flatMap((u) => u.testWrites))].sort(),
    baselineClassifications: [
      'NEW_BEHAVIOR_RED',
      'REGRESSION_RED',
      'NEGATIVE_RED',
      'CHARACTERIZATION_GREEN',
      'REFACTOR_GUARD_GREEN',
    ],
  });
  // Only units with EXACTLY known testWrites participate in a split; a single
  // unknown write set forces the whole column into one lane (fail closed).
  const exact = units.filter((u) => (u.testWrites ?? []).length > 0);
  if (exact.length !== units.length || units.length < 2) return [lane('test-author', units)];
  const disjoint = (a, b) => {
    const aSet = new Set(a.testWrites);
    return (b.testWrites ?? []).every((p) => !aSet.has(p));
  };
  // Deterministic collision-clustered 2-way split in task order: a unit joins
  // bin A while it is disjoint from A; the FIRST unit that collides with A
  // seeds bin B (every later unit joins B only while disjoint from B). The
  // split is emitted only when A and B are each internally disjoint and
  // A∩B = ∅; any cross-bin collision collapses to the single lane.
  const a = [];
  const b = [];
  for (const u of units) {
    const fitsA = a.length === 0 || a.every((x) => disjoint(x, u));
    const fitsB = b.length === 0 || b.every((x) => disjoint(x, u));
    if (fitsA && (a.length <= b.length || !fitsB)) a.push(u);
    else if (fitsB) b.push(u);
    else return [lane('test-author', units)]; // fits neither bin — collapse
  }
  if (!a.length || !b.length) return [lane('test-author', units)];
  for (const x of a) {
    for (const y of b) {
      if (!disjoint(x, y)) return [lane('test-author', units)];
    }
  }
  return [lane('test-author-1', a), lane('test-author-2', b)];
}

const testLanes = testUnits.length
  ? shardTestLanes(testUnits, testEngineForProfile(executionProfile))
  : [];

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
    openCoordinator: coordinatorOpenIds.size,
  },
  units,
  // Explicit zero-AI coordinator duty list (P0-5): the wave coordinator
  // executes these mechanically post-integration (manifest regen, coverage
  // assertion, bookkeeping commits) — never an AI writer.
  coordinatorUnits: [...coordinatorOpenIds].sort(),
  ...(executionProfile
    ? {
        executionProfile,
        implementationEngine: implementationEngineForProfile(executionProfile),
        testEngine: testEngineForProfile(executionProfile),
        testLanes,
      }
    : {}),
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
