#!/usr/bin/env node
// Durable implementation checkpoint (V2 task spec §5 — context capsule).
//
//   $ARTIFACTS_DIR/implementation-checkpoint.json
//
// CACHE/INDEX only — never an authority. Completion authority stays
// package-implement-complete.mjs; the gate stays the verification authority.
// A fresh implementation turn reads a VALIDATED checkpoint instead of
// rereading large irrelevant contract sections; any hash mismatch invalidates.
//
// Schema @2: every field deterministic code CAN derive from authoritative
// repository state IS derived at build time — the implementing agent must not
// hand-invent values machines can compute (package identity, profile, risk,
// task progress, requirement/acceptance IDs, PRD/ADR references, Spec Kit
// artifact paths, affected test refs, previous FAST outcome, slice base/final
// SHAs). The capsule is an INDEX into authority; the sources it points at stay
// authoritative and hashed.
//
// CLI:
//   package-checkpoint.mjs --build    --package <id> --artifacts-dir <dir> [options]
//   package-checkpoint.mjs --validate --package <id> --artifacts-dir <dir>
//   (exit 0 = valid / written; nonzero = invalid or refused; JSON on stdout)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadCurrentMilestone, findPackage } from './schema.mjs';
import { throughputProfile } from './work-package-throughput-profile.mjs';

export const CHECKPOINT_FILE = 'implementation-checkpoint.json';
export const CHECKPOINT_SCHEMA = 'foresift/implementation-checkpoint@2';
const MANIFEST_FILE =
  'docs/spec/crypto_intelligence_agent_gateway_PRD_FINAL_v6.0.requirements.json';

export function sha256File(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

/** Count checked/unchecked Spec Kit tasks in tasks.md text. */
export function parseTasksMd(text) {
  const completed = (text.match(/^\s*- \[x\]/gim) ?? []).length;
  const open = (text.match(/^\s*- \[ \]/gim) ?? []).length;
  return { completed, total: completed + open, remaining: open };
}

/** Unchecked task entries with 1-based line numbers, in file order. */
export function uncheckedTasks(text) {
  return (text.split('\n') ?? [])
    .map((line, i) => ({ line: i + 1, text: line.trim(), m: line.match(/^\s*[-*+]\s*\[ \]/) }))
    .filter((e) => e.m)
    .map((e) => ({ line: e.line, text: e.text.replace(/^\s*[-*+]\s*\[ \]\s*/, '').slice(0, 160) }));
}

/** Extract ADR-nn tokens from every string value in a requirement record. */
function adrTokens(value, out) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\bADR-\d+\b/g)) out.add(m[0]);
  } else if (Array.isArray(value)) {
    for (const v of value) adrTokens(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) adrTokens(v, out);
  }
}

/**
 * Derive the deterministic context capsule for a package from authoritative
 * state: milestone metadata + the PRD requirements manifest + scoped Spec Kit
 * artifacts. Purely read-only; returns plain JSON-able data. Missing optional
 * pieces (no manifest, no tasks.md yet) degrade to empty values — NEVER throw,
 * because a cache build must not break the slice boundary it runs on.
 */
export function deriveCapsule({ repoRoot, packageId, artifactsDir }) {
  const capsule = {
    profile: throughputProfile(packageId),
    risk: null,
    objective: null,
    writeScopes: [],
    requirementIds: [],
    acceptanceIds: [],
    prdReferences: [],
    adrReferences: [],
    specKitArtifacts: [],
    firstUnfinishedTask: null,
    suggestedNextTasks: [],
    affectedTestRefs: [],
    previousFast: null,
  };
  try {
    const ms = loadCurrentMilestone(repoRoot);
    const pkg = ms ? findPackage(ms, packageId) : null;
    if (pkg) {
      capsule.risk = pkg.risk ?? null;
      capsule.objective = pkg.objective ?? null;
      capsule.writeScopes = pkg.writeScopes ?? [];
      capsule.requirementIds = pkg.requirementIds ?? [];
    }
  } catch {
    /* milestone unreadable — capsule degrades, cache stays buildable */
  }
  try {
    const manifestPath = join(repoRoot, MANIFEST_FILE);
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const reqs = manifest.requirements ?? [];
      const wanted = new Set(capsule.requirementIds);
      const acIds = new Set();
      const prdRefs = [];
      const adrIds = new Set();
      for (const r of reqs) {
        if (!wanted.has(r.id)) continue;
        for (const ac of r.acceptanceCriteria ?? []) acIds.add(ac);
        prdRefs.push({
          requirementId: r.id,
          section: r.section ?? null,
          subsection: r.subsection ?? null,
          line: r.line ?? null,
        });
        adrTokens(r, adrIds);
      }
      capsule.acceptanceIds = [...acIds].sort();
      capsule.prdReferences = prdRefs;
      const adrById = new Map((manifest.adrs ?? []).map((a) => [a.id, a]));
      capsule.adrReferences = [...adrIds].sort().map((id) => {
        const a = adrById.get(id);
        return a ? { id, title: a.title ?? null, section: a.section ?? null } : { id };
      });
      // Acceptance-criteria test refs for this package's ACs.
      const wantedAc = new Set(capsule.acceptanceIds);
      const testRefs = [];
      for (const ac of manifest.acceptanceCriteria ?? []) {
        if (!wantedAc.has(ac.id)) continue;
        if (ac.positiveTestRef) testRefs.push(ac.positiveTestRef);
        if (ac.negativeOrFailureTestRef) testRefs.push(ac.negativeOrFailureTestRef);
      }
      capsule.affectedTestRefs = [...new Set(testRefs)].sort();
    }
  } catch {
    /* manifest unreadable — capsule degrades */
  }
  for (const f of ['spec.md', 'plan.md', 'tasks.md']) {
    const p = join(repoRoot, 'specs', packageId, f);
    if (existsSync(p)) capsule.specKitArtifacts.push(`specs/${packageId}/${f}`);
  }
  try {
    const tasksPath = join(repoRoot, 'specs', packageId, 'tasks.md');
    if (existsSync(tasksPath)) {
      const open = uncheckedTasks(readFileSync(tasksPath, 'utf8'));
      capsule.firstUnfinishedTask = open[0] ?? null;
      capsule.suggestedNextTasks = open.slice(0, 12);
    }
  } catch {
    /* tasks.md unreadable — capsule degrades */
  }
  try {
    const fastPath = join(artifactsDir ?? '', 'fast-verify-result.json');
    if (existsSync(fastPath)) {
      const fast = JSON.parse(readFileSync(fastPath, 'utf8'));
      capsule.previousFast = {
        schema: fast.schema ?? null,
        escalatedToFullSuite: Boolean(fast.escalatedToFullSuite),
        failed: (fast.results ?? []).some((r) => r?.result === 'FAIL'),
        timestamp: fast.timestamp ?? null,
      };
    }
  } catch {
    /* fast result unreadable — capsule degrades */
  }
  return capsule;
}

/**
 * Build a checkpoint record (schema @2). `sources` maps label → absolute path
 * of every authoritative file whose content the cached context depends on
 * (Spec Kit artifacts, milestone state, plan artifacts). Their content hashes
 * ride in the record so any later change invalidates the cache.
 */
export function buildCheckpoint(input) {
  const required = ['packageId', 'headSha', 'slice', 'tasks'];
  for (const k of required)
    if (input[k] === undefined || input[k] === null || input[k] === '')
      throw new Error(`checkpoint field '${k}' is required`);
  const sources = {};
  for (const [label, p] of Object.entries(input.sources ?? {}))
    sources[label] = { path: p, sha256: sha256File(p) };
  return {
    schema: CHECKPOINT_SCHEMA,
    packageId: input.packageId,
    headSha: input.headSha,
    sliceBaseSha: input.sliceBaseSha ?? null,
    completedTasks: input.tasks.completed,
    totalTasks: input.tasks.total,
    remainingTasks: input.tasks.remaining,
    slice: {
      id: input.slice.id ?? null,
      description: input.slice.description ?? null,
      taskIds: input.slice.taskIds ?? [],
      nextTaskId: input.slice.nextTaskId ?? null,
    },
    filesTouched: input.filesTouched ?? [],
    targetedChecks: input.targetedChecks ?? [], // [{command, result}]
    context: input.context ?? null, // derived capsule (see deriveCapsule)
    sourceHashes: sources,
    blocker: input.blocker ?? null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate a checkpoint against current reality: schema must be current, HEAD
 * must match, and every recorded source hash must still match the file on
 * disk. Returns { valid, reasons } — NEVER throws for an invalid cache;
 * callers treat an invalid checkpoint as "absent" (rebuild, do not trust).
 */
export function validateCheckpoint(cp, expected = {}) {
  const reasons = [];
  if (!cp || cp.schema !== CHECKPOINT_SCHEMA)
    return { valid: false, reasons: ['missing or unknown checkpoint schema'] };
  if (expected.packageId && cp.packageId !== expected.packageId)
    reasons.push(`packageId ${cp.packageId} ≠ ${expected.packageId}`);
  if (expected.headSha && cp.headSha !== expected.headSha)
    reasons.push(
      `HEAD moved since checkpoint (${cp.headSha?.slice(0, 8)} ≠ ${expected.headSha.slice(0, 8)})`,
    );
  for (const [label, rec] of Object.entries(cp.sourceHashes ?? {})) {
    if (!rec.path) {
      reasons.push(`source '${label}' has no recorded path`);
      continue;
    }
    if (rec.sha256 == null) {
      // Absent at build time (optional sources such as plan artifacts are
      // recorded with a null hash). Still absent ⇒ nothing drifted; APPEARED
      // since ⇒ the cached context never saw a file now sitting at a tracked
      // path, which is drift. (PR #19 semantics, preserved.)
      if (existsSync(rec.path)) reasons.push(`source '${label}' appeared since checkpoint`);
      continue;
    }
    if (!existsSync(rec.path)) {
      reasons.push(`source '${label}' no longer exists`);
      continue;
    }
    const now = sha256File(rec.path);
    if (now !== rec.sha256) reasons.push(`source '${label}' changed since checkpoint`);
  }
  if (typeof cp.completedTasks !== 'number' || typeof cp.totalTasks !== 'number')
    reasons.push('task counters missing');
  return { valid: reasons.length === 0, reasons };
}

function parseArgs(argv) {
  const a = { sources: {} };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--build':
        a.build = true;
        break;
      case '--validate':
        a.validate = true;
        break;
      case '--package':
        a.package = argv[++i];
        break;
      case '--artifacts-dir':
        a.artifactsDir = argv[++i];
        break;
      case '--repo-root':
        a.repoRoot = argv[++i];
        break;
      case '--head':
        a.head = argv[++i];
        break;
      case '--slice-id':
        a.sliceId = argv[++i];
        break;
      case '--slice-tasks':
        a.sliceTasks = argv[++i];
        break; // comma-separated ids
      case '--slice-base':
        a.sliceBase = argv[++i];
        break;
      case '--files':
        a.files = argv[++i];
        break; // comma-separated (hint only; git evidence is authoritative)
      case '--checks':
        a.checks = argv[++i];
        break; // JSON [{command,result}]
      case '--blocker':
        a.blocker = argv[++i];
        break;
      case '--source': {
        const [label, p] = String(argv[++i]).split('=', 2);
        a.sources[label] = resolve(p);
        break;
      }
      case '--no-capsule':
        a.noCapsule = true;
        break;
    }
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.package || !a.artifactsDir || !(a.build ^ a.validate)) {
    console.error(
      'usage: package-checkpoint.mjs (--build | --validate) --package <id> --artifacts-dir <dir> [--source label=path ...]',
    );
    process.exit(2);
  }
  const file = join(a.artifactsDir, CHECKPOINT_FILE);
  const repo = a.repoRoot ?? process.cwd();

  if (a.validate) {
    let cp = null;
    try {
      cp = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.log(JSON.stringify({ valid: false, reasons: ['checkpoint absent or unreadable'] }));
      process.exit(1);
    }
    const verdict = validateCheckpoint(cp, {
      packageId: a.package,
      headSha: a.head ?? null,
    });
    console.log(JSON.stringify(verdict));
    process.exit(verdict.valid ? 0 : 1);
  }

  // Build: derive durable facts from the repo instead of trusting the caller.
  const tasksPath = join(repo, 'specs', a.package, 'tasks.md');
  const tasks = parseTasksMd(existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8') : '');
  let head = a.head ?? null;
  if (!head) {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  }
  const defaultSources = {
    tasks: tasksPath,
    milestone: join(repo, 'specs', 'implementation', 'current-milestone.json'),
    plan: join(a.artifactsDir, 'plan.md'),
    planContext: join(a.artifactsDir, 'plan-context.md'),
  };
  const cp = buildCheckpoint({
    packageId: a.package,
    headSha: head,
    sliceBaseSha: a.sliceBase ?? null,
    tasks,
    slice: { id: a.sliceId ?? null, taskIds: a.sliceTasks ? a.sliceTasks.split(',') : [] },
    filesTouched: a.files ? a.files.split(',') : [],
    targetedChecks: a.checks ? JSON.parse(a.checks) : [],
    context: a.noCapsule
      ? null
      : deriveCapsule({ repoRoot: repo, packageId: a.package, artifactsDir: a.artifactsDir }),
    sources: { ...defaultSources, ...a.sources },
    blocker: a.blocker ?? null,
  });
  writeFileSync(file, JSON.stringify(cp, null, 2) + '\n');
  console.log(
    JSON.stringify({
      written: file,
      schema: cp.schema,
      completedTasks: cp.completedTasks,
      totalTasks: cp.totalTasks,
      capsuleDerived: Boolean(cp.context),
    }),
  );
}

const invokedDirectly = process.argv[1]?.endsWith('package-checkpoint.mjs');
if (invokedDirectly) main();
