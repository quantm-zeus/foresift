// Generate per-writer briefs from an implementation task graph (override §12):
// each writer gets ONLY its own shard — assigned unit bodies, their requirement
// traces, predicted write paths, the pinned base HEAD, its private worktree
// path, and the package capsule reference. No full-package history, no full
// PRD. Deterministic output; one markdown brief per shard under --out.
//
// Usage:
//   node scripts/automation/build-writer-briefs.mjs --package <id> \
//     --graph <task-graph.json> --capsule <plan-capsule.json> --out <dir> \
//     [--root <repo>] [--base-head <sha>] [--writer-root <dir>]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from './schema.mjs';
import { isCoordinatorTask } from './task-metadata.mjs';

function fail(msg) {
  console.error(`writer-briefs: ${msg}`);
  process.exit(1);
}

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--graph') args.graph = process.argv[i + 1];
  if (process.argv[i] === '--capsule') args.capsule = process.argv[i + 1];
  if (process.argv[i] === '--out') args.out = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
  if (process.argv[i] === '--base-head') args.baseHead = process.argv[i + 1];
  if (process.argv[i] === '--writer-root') args.writerRoot = process.argv[i + 1];
}
if (!args.package) fail('missing --package <id>');
if (!args.graph) fail('missing --graph <task-graph.json>');
if (!args.out) fail('missing --out <dir>');

const root = args.root ?? repoRoot();
const graph = JSON.parse(readFileSync(args.graph, 'utf8'));
let capsule = null;
try {
  capsule = JSON.parse(readFileSync(args.capsule, 'utf8'));
} catch {
  capsule = null; // brief still works without a capsule; it just cites fewer anchors
}
const baseHead =
  args.baseHead ??
  graph.bound?.mainHeadSha ??
  (() => {
    const rr = spawnSync('git rev-parse HEAD', { shell: true, cwd: root, encoding: 'utf8' });
    return rr.status === 0 ? (rr.stdout ?? '').trim() : 'UNKNOWN';
  })();
const writerRoot = args.writerRoot ?? join('/tmp', 'foresift-writers', args.package);

const reqText = new Map((capsule?.requirements ?? []).map((r) => [r.id, r]));
mkdirSync(args.out, { recursive: true });

const written = [];
for (const shard of [...(graph.shards ?? []), ...(graph.testLanes ?? [])]) {
  const allUnits = shard.units.map((uid) => graph.units.find((u) => u.id === uid)).filter(Boolean);
  // Coordinator tasks (explicit [executor: COORDINATOR] metadata — H3 P0-5)
  // are zero-AI mechanical bookkeeping executed by the wave coordinator
  // post-integration and are EXCLUDED from every writer brief — the AGY
  // product ownership guard legally refuses any writer that touches
  // evidence/bun-migration/ (observed live 2026-08-29/30, runs 9cf2bf57 and
  // 0b4838ae). If such a unit is still open, the brief says so explicitly
  // instead of handing the writer an unwritable task. The body-string
  // manifest-path matcher this replaces was the last string-classified duty.
  const isMechanicalBookkeeping = (u) => isCoordinatorTask(u);
  const units = allUnits.filter((u) => !isMechanicalBookkeeping(u));
  const skippedMechanical = allUnits.filter(isMechanicalBookkeeping).map((u) => u.id);
  const reqs = [...new Set(units.flatMap((u) => u.requirements))].sort();
  const lines = [
    `# ${shard.role === 'test' ? 'AGY test-author' : 'Implementation writer'} brief — ${args.package} · ${shard.id}`,
    '',
    `Mode: **${shard.mode}**. Pinned base HEAD: \`${String(baseHead).slice(0, 12)}\`.`,
    `Private worktree (write HERE only): \`${join(writerRoot, shard.id)}\``,
    '',
    '> Work ONLY inside your private worktree. Never touch the canonical',
    '> checkout, never edit specs/<pkg>/tasks.md or any checkpoint — the',
    '> coordinator owns those. Run targeted tests only (your listed test refs',
    '> plus focused package suites); never pnpm verify / FULL gate.',
    ...(shard.role === 'test'
      ? [
          '> You are the sole task-owned TEST AUTHOR. Write tests, fixtures, and',
          '> test-only helpers only. Never modify product implementation paths.',
          '> Record each test baseline as NEW_BEHAVIOR_RED, REGRESSION_RED,',
          '> NEGATIVE_RED, CHARACTERIZATION_GREEN, or REFACTOR_GUARD_GREEN.',
        ]
      : [
          '> You implement PRODUCT CODE only. Never edit tests, *.test.*, *.spec.*,',
          '> __tests__, fixtures, or test-only helpers. You may read and run tests.',
          '> If a test conflicts with requirements, emit TEST_DISPUTE evidence;',
          '> never modify the disputed test.',
        ]),
    '',
    '## Allowed write paths',
    ...(shard.allowedWritePaths.length
      ? shard.allowedWritePaths.map((p) => `- \`${p}\``)
      : ['- (no predicted paths; stay conservative and document actual files)']),
    '',
    `## Assigned units (${shard.role === 'test' ? 'author task-owned tests' : 'implement in listed order'})`,
    '',
    ...(skippedMechanical.length
      ? [
          `> Mechanical bookkeeping units EXCLUDED from this brief (coordinator-owned,`,
          `> zero-AI): ${skippedMechanical.join(', ')}. Do NOT attempt them; the`,
          `> coordinator regenerates the test manifest mechanically after the wave.`,
          '',
        ]
      : []),
  ];
  for (const u of units) {
    lines.push(`### ${u.id}${u.parallelizable ? ' [P]' : ''} — ${u.phase}`);
    lines.push('');
    lines.push(u.body.trim());
    lines.push('');
    if (u.acceptanceCriteria.length)
      lines.push(`Acceptance criteria: ${u.acceptanceCriteria.join(', ')}.`);
    if (u.testRefs.length)
      lines.push(`Test files: ${u.testRefs.map((t) => `\`${t}\``).join(', ')}.`);
    lines.push('');
  }
  lines.push('## Requirement anchors (quoted normative text)');
  lines.push('');
  for (const rid of reqs) {
    const r = reqText.get(rid);
    if (!r) continue;
    const sec = r.section ? ` (${r.section}, PRD line ${r.line})` : '';
    lines.push(`### ${rid}${sec}`);
    lines.push('');
    lines.push(`> ${r.text}`);
    lines.push('');
    const acBits = (r.acs ?? [])
      .map(
        (a) =>
          `${a.id}: ${a.positiveTestRef ?? '—'}${
            a.negativeOrFailureTestRef ? ` / failure-path ${a.negativeOrFailureTestRef}` : ''
          }`,
      )
      .slice(0, 40);
    if (acBits.length) {
      lines.push(`AC test refs: ${acBits.join('; ')}`);
      lines.push('');
    }
  }
  lines.push('## Completion contract');
  lines.push('');
  lines.push('- Commit coherent slices inside your worktree as you go.');
  lines.push(
    '- BUDGET LAW (observed live 2026-08-31): a lane that spends its whole time reading and writes nothing at the end loses EVERYTHING to the lane timeout. Read at most ~10 minutes, then START WRITING: implement the FIRST unit completely, `git add` + `git commit` it in your worktree, then move to the next unit. One commit per completed unit — partial work surviving a timeout is real progress; an unwritten plan is not.',
  );
  lines.push(
    `- On finish write \`$ARTIFACTS_DIR/writer-results/${shard.id}/result.json\` with: {"schema":"foresift/writer-result@1", shardId, role, engine, units, completed, branch, headSha, testsRun, testResults, baselineClassifications, blockers}.`,
  );
  lines.push('- List EVERY unit you finished; list unfinished ones under blockers.');
  lines.push('');

  const file = join(args.out, `${shard.id}-brief.md`);
  writeFileSync(file, lines.join('\n'));
  written.push(file);
}
console.log(JSON.stringify({ ok: true, briefs: written.length, out: args.out }));
