// Zero-AI launch preflight (Hyperdrive H3, P1-6): derives per-package write
// truth from the deterministic implementation task graph BEFORE a package
// launches, so co-run scheduling can upgrade from broad writeScopes overlap
// to EXACT predicted-write disjointness, and central files can serialize
// through a dedicated shared-surface lane instead of serializing whole
// packages.
//
// Conservative fallback contract: when exact truth is not derivable for a
// package (unreadable tasks, no predicted writes, graph build failure) the
// preflight returns `exact: false` and the caller keeps the existing
// broad-scope behavior — unknown write truth NEVER upgrades safety away.
//
// Zero AI: everything is derived from specs/<pkg>/tasks.md via
// build-implementation-task-graph.mjs (deterministic parser).

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './schema.mjs';
import { SHARED_SURFACE_FILES } from './exact-leases.mjs';
import { LANE_COUNT_LIMITS } from './adaptive-lanes.mjs';

const PREFLIGHT_SCHEMA = 'foresift/launch-preflight@1';

function fail(msg) {
  console.error(`launch-preflight: ${msg}`);
  process.exit(1);
}

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
  if (process.argv[i] === '--out') args.out = process.argv[i + 1];
}
const invokedDirectly = process.argv[1]?.endsWith('launch-preflight.mjs');
if (invokedDirectly && !args.package) fail('missing --package <id>');

const root = args.root ?? repoRoot();

/**
 * Build the preflight record for ONE package. Deterministic; throws nothing
 * for the expected not-derivable cases (returns exact:false instead).
 */
export function buildLaunchPreflight(packageId, rootDir = root) {
  const base = {
    schema: PREFLIGHT_SCHEMA,
    packageId,
    exact: false,
    predictedWrites: [],
    sharedSurfaces: [],
    testWrites: [],
    productWrites: [],
    migrationDuties: [],
    openTaskCount: 0,
    readyTaskCount: 0,
    parallelizableReadyCount: 0,
    shardNeed: null,
    reason: null,
  };
  const tasksPath = join(rootDir, 'specs', packageId, 'tasks.md');
  if (!existsSync(tasksPath)) return { ...base, reason: 'tasks.md missing' };

  // Deterministic graph build over the CURRENT tree (no shard planning — we
  // only need per-unit predicted writes). The builder fails closed itself on
  // corrupt milestone/tasks; catch and degrade conservatively.
  const out = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, 'build-implementation-task-graph.mjs'),
      '--package',
      packageId,
      '--root',
      rootDir,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  if (out.status !== 0 || !out.stdout)
    return { ...base, reason: `task graph unavailable: ${(out.stderr ?? '').slice(0, 160)}` };

  let graph;
  try {
    graph = JSON.parse(out.stdout);
  } catch {
    return { ...base, reason: 'task graph unreadable' };
  }
  const units = graph.units ?? [];
  const open = units.filter((u) => !u.done);
  // The exact lease footprint belongs to the package plan, not only to the
  // tasks that remain unchecked. A partially completed wave can still be
  // repaired or regenerated before launch, so dropping completed units here
  // would silently forget their product, test, and migration paths.
  const predictedWrites = [...new Set(units.flatMap((u) => u.predictedWrites ?? []))].sort();
  const testWrites = [...new Set(units.flatMap((u) => u.testWrites ?? []))].sort();
  const productWrites = [...new Set(units.flatMap((u) => u.productWrites ?? []))].sort();
  const migrationDuties = predictedWrites.filter((p) =>
    /^migrations\/g0_[a-z]+_\d+.*\.sql$/.test(p),
  );

  // READY work truth (H3 P0): a unit is ready when none of its declared
  // dependencies is still open — dependency/phase-blocked units must NOT be
  // counted as immediately parallel-ready. This is the input the adaptive
  // lane resolver consumes; absent it the resolver wrongly sees zero open
  // work and collapses the wave to one lane.
  const openIds = new Set(open.map((u) => u.id));
  const ready = open.filter((u) => (u.dependsOn ?? []).every((d) => !openIds.has(d)));
  const parallelizableReady = ready.filter((u) => u.parallelizable);

  if (predictedWrites.length === 0)
    return {
      ...base,
      openTaskCount: open.length,
      readyTaskCount: ready.length,
      parallelizableReadyCount: parallelizableReady.length,
      reason: 'no predicted writes derivable from open tasks',
    };

  // Disjoint-shard need (H3 P0): one deterministic probe of the graph builder
  // at the policy ceiling. The planner's cross-lane closure demotes every unit
  // that cannot sit beside the core into the serial shard, so the number of
  // non-empty planned shards is the exact number of lanes the work can
  // actually occupy. Missing/failed planning keeps shardNeed null — the lane
  // resolver then falls back to its ready-count heuristic, never expands.
  let shardNeed = null;
  try {
    const probe = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, 'build-implementation-task-graph.mjs'),
        '--package',
        packageId,
        '--root',
        rootDir,
        '--plan-shards',
        String(Math.max(1, LANE_COUNT_LIMITS.max)),
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    if (probe.status === 0 && probe.stdout) {
      const planned = JSON.parse(probe.stdout);
      const shards = (planned.shards ?? []).filter((s) => (s.units ?? []).length > 0);
      shardNeed = Math.max(1, shards.length);
    }
  } catch {
    shardNeed = null;
  }

  // A shared surface counts as an exact predicted write only when a task
  // actually names it — otherwise the package does not touch it.
  const sharedSurfaces = predictedWrites.filter((p) => SHARED_SURFACE_FILES.includes(p));

  return {
    schema: PREFLIGHT_SCHEMA,
    packageId,
    exact: true,
    predictedWrites,
    productWrites,
    testWrites,
    sharedSurfaces,
    migrationDuties,
    openTaskCount: open.length,
    readyTaskCount: ready.length,
    parallelizableReadyCount: parallelizableReady.length,
    shardNeed,
    reason: null,
  };
}

/**
 * Exact co-run decision between two preflight records. Exact truth on both
 * sides permits co-running when predicted writes are disjoint AND neither
 * side's shared-surface set collides (shared surfaces go through the
 * exact-lease manager at admission instead). Exact truth on either side
 * missing ⇒ NOT exact (caller falls back to broad scopes).
 */
export function exactCoRunCompatible(a, b) {
  if (!a?.exact || !b?.exact)
    return { compatible: null, reason: 'exact truth unavailable on a side' };
  const aSet = new Set(a.predictedWrites);
  const bSet = new Set(b.predictedWrites);
  const overlap = [...aSet].filter((p) => bSet.has(p));
  if (overlap.length > 0)
    return {
      compatible: false,
      reason: `predicted-write overlap: ${overlap.slice(0, 5).join(', ')}`,
    };
  // Dependency DAG between the two packages is checked by the caller
  // (canStartPackage owns transitive dependency truth); this function owns
  // exact write truth only.
  return { compatible: true, reason: 'predicted writes disjoint' };
}

/** CLI: emit the preflight JSON for scheduling consumers. */
if (invokedDirectly) {
  const record = buildLaunchPreflight(args.package, root);
  const outJson = `${JSON.stringify(record, null, 2)}\n`;
  if (args.out) writeFileSync(args.out, outJson);
  else process.stdout.write(outJson);
}
