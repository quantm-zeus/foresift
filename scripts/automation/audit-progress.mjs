#!/usr/bin/env node
// Durable audit-progress tracking for Foresift milestone audits (Mode B),
// including the FINAL product-wide audit at G7.
//
//   node scripts/automation/audit-progress.mjs --init     # create/sync skeleton
//   node scripts/automation/audit-progress.mjs --check    # completion guard
//   node scripts/automation/audit-progress.mjs            # status summary
//
// The progress artifact ($ARTIFACTS_DIR/milestone-audit-progress.json) lets a
// bounded fresh-context audit loop continue across many Claude turns: each
// turn loads the file, audits the next unaudited range of requirements, and
// updates it. The deterministic --check command is the Archon loop's
// `until_bash` completion signal: exit 0 only when EVERY required requirement
// ID carries an audited verdict backed by evidence references.
//
// Exit codes for --check: 0 complete · 1 incomplete · 2 corrupt/unusable.
// The required-requirement set is computed from the authoritative manifest,
// never from AI-authored content.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, loadCurrentMilestone, validateMilestoneState } from './schema.mjs';

// until_bash guards receive NO ARTIFACTS_DIR environment variable (Archon
// v0.9.0, probe-verified — see docs/adr/0004-archon-until-bash-artifacts-contract.md):
// guards must pass --artifacts-dir "$ARTIFACTS_DIR", which archon textually
// substitutes in bare form. The env var remains the fallback for regular
// workflow bash nodes, where it IS exported.
let artifactsDir = process.env.ARTIFACTS_DIR ?? '';
for (let i = 0; i < process.argv.length - 1; i++) {
  if (process.argv[i] === '--artifacts-dir') artifactsDir = process.argv[i + 1];
}
if (!artifactsDir) {
  console.error(
    'missing artifacts directory: pass --artifacts-dir "$ARTIFACTS_DIR" ' +
      '(until_bash guards get no ARTIFACTS_DIR env var) or run inside an Archon bash node',
  );
  process.exit(2);
}
const FILE = join(artifactsDir, 'milestone-audit-progress.json');
const root = process.env.FORESIFT_REPO_ROOT ?? repoRoot(); // test seam; default = script's own repo

function loadManifest() {
  return JSON.parse(
    readFileSync(
      join(
        root,
        'docs',
        'spec',
        'crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json',
      ),
      'utf8',
    ),
  );
}

function computeScope() {
  const ms = loadCurrentMilestone(root);
  const errs = ms ? validateMilestoneState(ms) : ['current-milestone.json missing'];
  if (errs.length) {
    console.error(JSON.stringify({ error: 'invalid current milestone', errors: errs }));
    process.exit(2);
  }
  const manifest = loadManifest();
  const isFinal = ms.milestoneId === 'G7';
  // supersededBy must be an array; a truthy-but-empty value would silently
  // shrink the audit scope to nothing, so fail loudly on the malformed shape.
  for (const r of manifest.requirements) {
    if (!Array.isArray(r.supersededBy)) {
      console.error(
        JSON.stringify({
          error: `manifest requirement ${r.id}: supersededBy must be an array`,
        }),
      );
      process.exit(2);
    }
  }
  const required = manifest.requirements
    .filter(
      (r) =>
        (r.supersededBy ?? []).length === 0 && (isFinal || r.dependencyGroup === ms.milestoneId),
    )
    .map((r) => r.id)
    .sort();
  return { milestoneId: ms.milestoneId, isFinal, required };
}

function skeleton(scope) {
  return {
    schemaVersion: '1.0.0',
    milestoneId: scope.milestoneId,
    isFinal: scope.isFinal,
    requiredRequirementIds: scope.required,
    acceptanceCriteriaCovered: [],
    evidenceRefs: {},
    audited: {},
    gaps: [],
    nextRange: null,
    updatedAt: new Date().toISOString(),
  };
}

function validateStructure(p) {
  const errs = [];
  for (const f of ['schemaVersion', 'milestoneId', 'isFinal', 'requiredRequirementIds', 'audited'])
    if (!(f in p)) errs.push(`missing field ${f}`);
  if (!Array.isArray(p?.requiredRequirementIds))
    errs.push('requiredRequirementIds must be an array');
  if (typeof p?.audited !== 'object' || p?.audited === null || Array.isArray(p?.audited))
    errs.push('audited must be an object');
  return errs;
}

const scope = computeScope();
const argInit = process.argv.includes('--init');
const argCheck = process.argv.includes('--check');

let progress = null;
if (existsSync(FILE)) {
  try {
    progress = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.error(
      JSON.stringify({ error: 'corrupt audit progress file', detail: String(err?.message ?? err) }),
    );
    process.exit(2);
  }
  const structural = validateStructure(progress);
  if (structural.length) {
    console.error(
      JSON.stringify({ error: 'invalid audit progress structure', errors: structural }),
    );
    process.exit(2);
  }
  // Scope drift (milestone changed underneath the artifact): re-init rather
  // than trust stale coverage.
  if (
    progress.milestoneId !== scope.milestoneId ||
    progress.isFinal !== scope.isFinal ||
    JSON.stringify([...(progress.requiredRequirementIds ?? [])].sort()) !==
      JSON.stringify(scope.required)
  ) {
    if (!argInit) {
      console.error(
        JSON.stringify({
          error: 'audit progress scope mismatch — rerun with --init to resynchronize',
          expected: scope,
          found: { milestoneId: progress.milestoneId, isFinal: progress.isFinal },
        }),
      );
      process.exit(2);
    }
    progress = null;
  }
}

if (!progress) {
  if (!argInit) {
    console.log(JSON.stringify({ complete: false, reason: 'no audit progress file yet' }));
    process.exit(argCheck ? 1 : 0);
  }
  progress = skeleton(scope);
}

if (argInit) {
  progress.updatedAt = new Date().toISOString();
  writeFileSync(FILE, JSON.stringify(progress, null, 2) + '\n');
}

const missing = scope.required.filter((rid) => {
  const entry = progress.audited?.[rid];
  return (
    !entry ||
    !['PASS', 'GAP'].includes(entry.verdict) ||
    typeof entry.evidence !== 'string' ||
    entry.evidence.trim().length < 3
  );
});
const summary = {
  milestoneId: scope.milestoneId,
  isFinal: scope.isFinal,
  requiredCount: scope.required.length,
  auditedCount: scope.required.length - missing.length,
  missingCount: missing.length,
  nextMissingExamples: missing.slice(0, 5),
  complete: missing.length === 0,
};

if (argCheck) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(missing.length === 0 ? 0 : 1);
}
// --init (seeding) path: exit 0 once the durable progress artifact is written.
// Completeness is the AUDIT LOOP's business — decided by --check above, never
// by the seeding pass. Live root cause (runs cca85aa2/944441a4, 2026-09-02):
// --init exited 1 on a fresh skeleton (0/N audited is the EXPECTED initial
// state), so `set -e` killed the milestone verify-repo node right after its
// gate had passed — every AUDIT-mode run failed before its loop could start.
console.log(JSON.stringify(summary, null, 2));
