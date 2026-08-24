// Build a deterministic, authority-bound planning context capsule for ONE
// work package (throughput mission §8/§20). The capsule pre-derives everything
// the scoped planner otherwise re-reads from the PRD/manifest every run:
// normative requirement text, acceptance criteria with test refs, dependency
// status, writeScopes, and an existing-code index. It is a CACHE/index only —
// never product authority — and is bound to the exact authority inputs so any
// drift invalidates it. Derivation lives in plan-context-lib.mjs.
//
// Usage (inside a run worktree or the repo root):
//   node scripts/automation/build-plan-context.mjs --package <id> --out <dir>
// Writes <dir>/plan-capsule.json and <dir>/plan-capsule.md. Byte-stable given
// identical inputs (no timestamps, sorted keys) — safe to diff in tests.
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './schema.mjs';
import {
  CAPSULE_SCHEMA,
  BUILDER_VERSION,
  PlanContextError,
  derivePackageContext,
} from './plan-context-lib.mjs';

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--out') args.out = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
}
function fail(msg) {
  console.error(`plan-context: ${msg}`);
  process.exit(1);
}
if (!args.package) fail('missing --package <id>');
if (!args.out) fail('missing --out <dir>');

const root = args.root ?? repoRoot();

let ctx;
try {
  ctx = derivePackageContext(root, args.package);
} catch (e) {
  fail(e instanceof PlanContextError ? e.message : `${e?.message ?? e}`);
}
const { pkg, assignedReqs, depStatus, adrFiles, otherPackages, sharedAcs, ownAcs, bound } = ctx;
const headSha = bound.mainHeadSha;

const codeIndex = (pkg.writeScopes ?? []).map((scope) => {
  const base = scope.split('/**')[0].split('/*')[0];
  const abs = join(root, base);
  let entries = [];
  if (existsSync(abs)) {
    try {
      entries = readdirSync(abs, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .slice(0, 40);
    } catch {
      entries = [];
    }
  }
  return { scope, baseDir: base, exists: existsSync(abs), entries };
});

const capsule = {
  schema: CAPSULE_SCHEMA,
  builderVersion: BUILDER_VERSION,
  package: {
    id: pkg.id,
    objective: pkg.objective,
    risk: pkg.risk,
    parallelizable: pkg.parallelizable ?? false,
    dependencies: depStatus,
    writeScopes: pkg.writeScopes ?? [],
  },
  bound,
  requirements: assignedReqs,
  sharedAcceptanceCriteria: sharedAcs,
  nonGoals: { note: 'Everything below is OUT OF SCOPE for this package.', packages: otherPackages },
  codeIndex,
};

function formatAc(a) {
  const bits = [a.id];
  if (a.positiveTestRef) bits.push(`+${a.positiveTestRef}`);
  if (a.negativeOrFailureTestRef) bits.push(`−${a.negativeOrFailureTestRef}`);
  return a.crossCutting ? `${bits.join(' ')} (cross-cutting)` : bits.join(' ');
}

const formatSharedLine = (a) => {
  const bits = [`**${a.id}**`];
  if (a.positiveTestRef) bits.push(`+ \`${a.positiveTestRef}\``);
  if (a.negativeOrFailureTestRef) bits.push(`− \`${a.negativeOrFailureTestRef}\``);
  return `- ${bits.join(' ')} — attached to ${a.requirementCount} requirements`;
};

// ── markdown rendering ────────────────────────────────────────────────────────
const md = [
  `# Planning context capsule — ${pkg.id}`,
  '',
  `> DERIVATIVE CACHE, NOT AUTHORITY. Bound to main \`${headSha.slice(0, 10)}\`,`,
  `> PRD \`${bound.prdSha256.slice(0, 12)}…\`, manifest \`${bound.manifestSha256.slice(0, 12)}…\`.`,
  '> If authority changed since this capsule was built, regenerate it — never trust a stale one.',
  '',
  `**Objective**: ${pkg.objective}  `,
  `**Risk**: ${pkg.risk} · **writeScopes**: ${(pkg.writeScopes ?? []).join(', ')}`,
  '',
  '## Dependencies',
  ...(depStatus.length ? depStatus.map((d) => `- ${d.id}: **${d.status}**`) : ['- none']),
  '',
  '## Assigned requirements (normative text quoted verbatim)',
  ...assignedReqs.flatMap((r) => {
    const own = ownAcs(r);
    const acLine = !r.acs.length
      ? 'Acceptance criteria: none declared'
      : own.length === r.acs.length
        ? `Acceptance criteria: ${own.map((a) => formatAc(a)).join('; ')}`
        : own.length
          ? `Acceptance criteria: ${own.map((a) => formatAc(a)).join('; ')}; plus ${r.acs.length - own.length} shared → see “Shared acceptance criteria”`
          : `Acceptance criteria: all ${r.acs.length} shared across this package's requirements → see “Shared acceptance criteria”`;
    return [
      `### ${r.id}${r.section ? ` — ${r.section}` : ''}${r.line ? ` (PRD line ${r.line})` : ''}`,
      '',
      `> ${r.text}`,
      '',
      `Normative level: ${r.normativeLevel ?? 'n/a'}. ${acLine}`,
      ...(r.schemaRefs.length ? [`Schema refs: ${r.schemaRefs.join(', ')}`] : []),
      ...(r.fixtureRefs.length ? [`Fixture refs: ${r.fixtureRefs.join(', ')}`] : []),
      ...(r.telemetryRefs.length ? [`Telemetry refs: ${r.telemetryRefs.join(', ')}`] : []),
      '',
    ];
  }),
  '## Shared acceptance criteria',
  ...(sharedAcs.length
    ? [
        'Attached to more than one requirement of this package — implement once, satisfy everywhere:',
        '',
        ...sharedAcs.map(formatSharedLine),
      ]
    : ['- none']),
  '',
  '## Non-goals (other packages in this milestone)',
  ...capsule.nonGoals.packages.map((p) => `- ${p.id}: ${p.objective}`),
  '',
  '## Existing code index under writeScopes',
  ...codeIndex.map(
    (c) =>
      `- \`${c.baseDir}/\`: ${c.exists ? 'exists' : 'does not exist yet'}${
        c.entries.length ? ` — top-level: ${c.entries.join(', ')}` : ''
      }`,
  ),
  '',
  '## Accepted ADRs present (read selectively if relevant)',
  ...(adrFiles.length ? adrFiles.map((f) => `- docs/adr/${f}`) : ['- none']),
  '',
];

// ── emit ──────────────────────────────────────────────────────────────────────
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, 'plan-capsule.json'), JSON.stringify(capsule, null, 2) + '\n');
writeFileSync(join(args.out, 'plan-capsule.md'), md.join('\n'));
console.log(
  JSON.stringify({
    ok: true,
    package: pkg.id,
    bound: capsule.bound,
    requirements: assignedReqs.length,
    out: args.out,
  }),
);
