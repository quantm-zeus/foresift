// Post-integration coordinator duties (Hyperdrive H3, P0-5): the ZERO-AI
// mechanical bookkeeping a wave performs AFTER writers/guards/integration
// and BEFORE FAST — so AGY-authored test files are visible to the bun test
// plan without any writer ever touching evidence/bun-migration/.
//
// Duty order (invariant for every future wave):
//   WRITERS → GUARDS → INTEGRATION → POST-INTEGRATION COORDINATOR DUTIES
//     → manifest regeneration → manifest coverage assertion
//     → coordinator mechanical commit → coordinator task completion → FAST
//
// The g0-mcp-surface run had to perform the manifest duty manually; this
// module makes it systemic. Zero AI: every step is a deterministic command
// over the canonical checkout.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './schema.mjs';
import { isCoordinatorTask } from './task-metadata.mjs';

function fail(msg) {
  console.error(`wave-coordinator-duties: ${msg}`);
  process.exit(1);
}

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--graph') args.graph = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
}
if (!args.package) fail('missing --package <id>');
if (!args.graph) fail('missing --graph <task-graph.json>');

const root = args.root ?? repoRoot();
const git = (cmd) => {
  const r = spawnSync(`git ${cmd}`, { shell: true, cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

const MANIFEST = 'evidence/bun-migration/bun-migration-manifest.json';
const graph = JSON.parse(readFileSync(args.graph, 'utf8'));
const coordinatorUnits = (graph.coordinatorUnits ?? []).filter((id) => {
  const u = (graph.units ?? []).find((x) => x.id === id);
  return u && isCoordinatorTask(u) && !u.done;
});
const report = {
  schema: 'foresift/wave-coordinator-duties@1',
  package: args.package,
  manifestRegenerated: false,
  manifestCoverage: null,
  tasksCompleted: [],
  committed: false,
};

// ── 1. manifest regeneration (zero AI, mechanical) ───────────────────────────
// Delegates to the SAME CLI the prep step used (bun-migration-manifest.mjs
// --previous --out) so formatting, VERIFIED carryover, and TEST_LOSS
// fail-closed behavior stay byte-identical to the proven path.
const manifestPath = join(root, MANIFEST);
if (!existsSync(manifestPath)) fail(`${MANIFEST} missing — repository contract broken`);
const regen = spawnSync(
  process.execPath,
  [
    join(import.meta.dirname, 'bun-migration-manifest.mjs'),
    '--previous',
    manifestPath,
    '--out',
    manifestPath,
  ],
  { encoding: 'utf8', cwd: root },
);
if (regen.status !== 0)
  fail(`manifest regeneration failed: ${(regen.stderr ?? regen.stdout ?? '').slice(-300)}`);
report.manifestRegenerated = true;

// ── 2. manifest coverage assertion (fail-closed) ─────────────────────────────
// Every new *.spec.ts/*.test.ts file on the canonical checkout must be
// present in the regenerated manifest; a miss means `pnpm test` will never
// see it and the wave would land invisible tests.
const statusOut = spawnSync('git ls-files -co --exclude-standard', {
  shell: true,
  cwd: root,
  encoding: 'utf8',
});
const trackedTests = statusOut.stdout
  .split('\n')
  .filter(Boolean)
  .filter((p) => /(?:^|\/)[^/]+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/.test(p));
const manifestPaths = new Set(
  (JSON.parse(readFileSync(manifestPath, 'utf8')).files ?? []).map((f) => f.path),
);
const missing = trackedTests.filter((p) => !manifestPaths.has(p));
if (missing.length > 0) fail(`MANIFEST_COVERAGE_MISSING: ${missing.join(', ')}`);
report.manifestCoverage = { testFiles: trackedTests.length, missing: 0 };

// ── 3. coordinator mechanical commit ─────────────────────────────────────────
if (!git(`diff --quiet -- ${MANIFEST}`).ok || git(`status --porcelain ${MANIFEST}`).out) {
  git(`add ${MANIFEST}`);
  const commit = git(
    `-c user.email=noreply@foresift.local -c user.name='wave-coordinator' commit -m "chore(${args.package}): post-integration coordinator manifest regen"`,
  );
  report.committed = commit.ok;
  if (!commit.ok)
    fail(`coordinator commit failed: ${git('status --porcelain').err || 'uncommitted'}`);
}

// ── 4. coordinator task completion (evidence trivially complete: the duty
//      output IS the manifest diff this module just authored and committed) ──
for (const id of coordinatorUnits) {
  const u = graph.units.find((x) => x.id === id);
  if (u?.predictedWrites?.includes(MANIFEST)) report.tasksCompleted.push(id);
}

const outJson = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(outJson);
console.error(
  `wave-coordinator-duties: manifest ok, coverage ${report.manifestCoverage?.testFiles ?? 0} files, tasks completed: ${report.tasksCompleted.join(',') || 'none'}`,
);
