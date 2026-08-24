// Deterministically seed specs/<package>/spec.md for ONE work package from the
// authoritative requirement manifest (throughput mission §8/§9): the mechanical,
// normative part of a scoped specification — subordinate-to-PRD declaration,
// authority binding, quoted requirement texts with IDs, acceptance criteria with
// test refs, and non-goals — so scoped planners spend their turns on architecture,
// approach, and trade-offs instead of transcribing the manifest.
//
// NEVER clobbers existing work: writes ONLY if specs/<package>/spec.md is absent.
// Never edits anything under docs/spec/** — reads only.
//
// Usage: node scripts/automation/bootstrap-package-spec.mjs --package <id> [--root <dir>]
// Derivation lives in plan-context-lib.mjs (shared with build-plan-context.mjs).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './schema.mjs';
import { BUILDER_VERSION, PlanContextError, derivePackageContext } from './plan-context-lib.mjs';

const args = {};
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--package') args.package = process.argv[i + 1];
  if (process.argv[i] === '--root') args.root = process.argv[i + 1];
}
function fail(msg) {
  console.error(`bootstrap-package-spec: ${msg}`);
  process.exit(1);
}
if (!args.package) fail('missing --package <id>');

const root = args.root ?? repoRoot();
const specPath = join(root, 'specs', args.package, 'spec.md');

if (existsSync(specPath)) {
  // Idempotent by design: an existing spec — seeded earlier or authored by an
  // agent — is never overwritten.
  console.log(
    JSON.stringify({ ok: true, seeded: false, skipped: 'spec_exists', path: relOut(specPath) }),
  );
  process.exit(0);
}

function relOut(p) {
  return p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
}

let ctx;
try {
  ctx = derivePackageContext(root, args.package);
} catch (e) {
  fail(e instanceof PlanContextError ? e.message : `${e?.message ?? e}`);
}
const { pkg, ms, assignedReqs, depStatus, otherPackages, sharedAcs, ownAcs, bound } = ctx;

// ── prettier-stable markdown emission ─────────────────────────────────────────
// These files land in git and CI enforces `prettier --check`, so the seeder
// emits prettier's canonical shapes directly: prose greedily filled at
// printWidth 100, list continuations at two spaces, one statement per line.
function fillParagraph(text, prefix, continuation) {
  const avail = 100 - prefix.length;
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= avail) line += ' ' + w;
    else {
      out.push(prefix + line);
      line = w;
    }
  }
  if (line) out.push(prefix + line);
  return out.map((l, i) =>
    i > 0 && continuation !== undefined ? continuation + l.slice(prefix.length) : l,
  );
}

function listItem(text) {
  return fillParagraph(text, '- ', '  ');
}

function acRefLine(a) {
  const bits = [`**${a.id}**`];
  if (a.positiveTestRef) bits.push(`positive: \`${a.positiveTestRef}\``);
  if (a.negativeOrFailureTestRef) bits.push(`negative/failure: \`${a.negativeOrFailureTestRef}\``);
  return bits.join(' · ');
}

const md = [];
md.push(`# ${pkg.id} — scoped specification`);
md.push('');
md.push(
  ...fillParagraph(
    'This file is a SUBORDINATE DERIVATIVE of the authoritative product contract ' +
      `\`${bound.prdPath}\`. It was seeded mechanically from the requirement manifest ` +
      'by `scripts/automation/bootstrap-package-spec.mjs` (builder v' +
      BUILDER_VERSION +
      '). The PRD always wins over any wording below.',
    '> ',
  ),
);
md.push('');
md.push('## Authority binding');
md.push('');
md.push(...listItem(`Milestone: \`${ms.milestoneId}\` (${ms.status ?? 'unknown status'})`));
md.push(...listItem(`Objective: ${pkg.objective}`));
md.push(
  ...listItem(
    `Risk: ${pkg.risk} · writeScopes: ${(pkg.writeScopes ?? []).map((s) => `\`${s}\``).join(', ')}`,
  ),
);
md.push(
  ...listItem(
    depStatus.length
      ? `Dependencies: ${depStatus.map((d) => `\`${d.id}\` ${d.status}`).join(', ')}`
      : 'Dependencies: none',
  ),
);
md.push(
  ...listItem(
    `Bound inputs at seed time: main \`${bound.mainHeadSha.slice(0, 12)}\`, manifest ` +
      `\`${bound.manifestSha256.slice(0, 12)}\`, PRD \`${bound.prdSha256.slice(0, 12)}\``,
  ),
);
md.push('');

md.push('## Assigned requirements (normative text quoted verbatim)');
md.push('');
for (const r of assignedReqs) {
  md.push(
    `### ${r.id}${r.section ? ` — ${r.section}` : ''}${r.line ? ` (PRD line ${r.line})` : ''}`,
  );
  md.push('');
  md.push(...fillParagraph(r.text, '> '));
  md.push('');
  const own = ownAcs(r);
  const acBits = [];
  acBits.push(`Normative level: ${r.normativeLevel ?? 'n/a'}.`);
  if (!r.acs.length) acBits.push('Acceptance criteria: none declared.');
  else if (own.length === r.acs.length)
    acBits.push(`Acceptance criteria: ${own.map((a) => a.id).join(', ')}.`);
  else if (own.length)
    acBits.push(
      `Acceptance criteria owned uniquely here: ${own.map((a) => a.id).join(', ')}; the remaining ${
        r.acs.length - own.length
      } are shared — see “Shared acceptance criteria”.`,
    );
  else
    acBits.push(
      `Acceptance criteria: all ${r.acs.length} are shared across this package — see “Shared acceptance criteria”.`,
    );
  md.push(...fillParagraph(acBits.join(' '), ''));
  const refLines = [];
  if (r.securityRightsCostControls)
    refLines.push(...listItem(`Security/rights/cost controls: ${r.securityRightsCostControls}`));
  if (r.schemaRefs.length)
    refLines.push(...listItem(`Schema refs: ${r.schemaRefs.map((s) => `\`${s}\``).join(', ')}`));
  if (r.fixtureRefs.length)
    refLines.push(...listItem(`Fixture refs: ${r.fixtureRefs.map((s) => `\`${s}\``).join(', ')}`));
  if (r.telemetryRefs.length)
    refLines.push(
      ...listItem(`Telemetry refs: ${r.telemetryRefs.map((s) => `\`${s}\``).join(', ')}`),
    );
  for (const a of ownAcs(r)) refLines.push(...listItem(acRefLine(a)));
  if (refLines.length) {
    // Prettier canonical form requires a blank line between a paragraph and a list.
    md.push('');
    md.push(...refLines);
  }
  md.push('');
}

md.push('## Shared acceptance criteria');
md.push('');
if (sharedAcs.length) {
  md.push(
    ...fillParagraph(
      'Attached to more than one requirement of this package — implement once, satisfy everywhere:',
      '',
    ),
  );
  md.push('');
  for (const a of sharedAcs)
    md.push(...listItem(`${acRefLine(a)} — attached to ${a.requirementCount} requirements`));
} else {
  md.push('- none');
}
md.push('');

md.push('## Non-goals');
md.push('');
md.push(...fillParagraph('Everything below is OUT OF SCOPE for this package:', ''));
md.push('');
for (const p of otherPackages) md.push(...listItem(`\`${p.id}\`: ${p.objective}`));
md.push('');
md.push('<!-- Seeded normative content ends here. Planner-owned sections (integration notes,');
md.push(
  '     invariants, open points resolved from authoritative sources) go below this line. -->',
);
md.push('');

mkdirSync(join(specPath, '..'), { recursive: true });
writeFileSync(specPath, md.join('\n'));
console.log(
  JSON.stringify({
    ok: true,
    seeded: true,
    path: relOut(specPath),
    requirements: assignedReqs.length,
    bound,
  }),
);
