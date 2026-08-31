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
  const predictedWrites = [...new Set(open.flatMap((u) => u.predictedWrites ?? []))].sort();
  const testWrites = [...new Set(open.flatMap((u) => u.testWrites ?? []))].sort();
  const productWrites = [...new Set(open.flatMap((u) => u.productWrites ?? []))].sort();
  const migrationDuties = predictedWrites.filter((p) =>
    /^migrations\/g0_[a-z]+_\d+.*\.sql$/.test(p),
  );

  if (predictedWrites.length === 0)
    return {
      ...base,
      openTaskCount: open.length,
      reason: 'no predicted writes derivable from open tasks',
    };

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
