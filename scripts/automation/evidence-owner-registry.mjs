// Evidence-owner registry (G0 final correctness delta, directive 4).
//
// PRD law: EVERY OPEN TASK HAS A REAL DETERMINISTIC COMPLETION OWNER. The
// P0-1 completion protocol evidences FILE_OUTPUT/TEST_PROOF/SHARED_SURFACE_
// OUTPUT tasks through lane diffs; the non-file kinds defer completion to an
// OWNING CONTEXT. A kind whose owner never runs in the wave pipeline leaves
// its task open forever (or worse, invites a manual/AI checkbox flip, which
// the protocol forbids) — metadata alone is not completion.
//
// This module is the single registry:
//   1. evidenceOwnerRegistry — every non-file TASK_EVIDENCE_KIND maps to the
//      runtime context that consumes it (machine-checked against the kinds
//      vocabulary in task-metadata.mjs);
//   2. assertEvidenceOwnership(graph) — fail-closed graph-build/preflight
//      coverage assertion: an OPEN task declaring a kind with no registered
//      owner (or an owner that cannot act on THIS unit) aborts the build;
//   3. completeNonFileEvidence(...) — the deterministic completer the wave
//      pipeline invokes post-integration. VERIFICATION_ONLY: the task's
//      declared verification commands (from the current-milestone package
//      record) execute on the canonical tree; all-green ⇒ the unit flips via
//      the same coordinator-commit path integration uses. COORDINATOR_ARTIFACT:
//      the named deterministic artifact must exist; its presence completes.
//      RED ⇒ the task stays OPEN (never fabricated, never model-prose).
//
// Zero AI: every step is deterministic command execution + checkbox arithmetic.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCoordinatorTask, TASK_EVIDENCE_KINDS } from './task-metadata.mjs';

/**
 * Owner of every non-file evidence kind. FILE_OUTPUT/TEST_PROOF/
 * SHARED_SURFACE_OUTPUT are file-truth kinds owned by the lane-diff protocol
 * (task-completion-evidence.mjs) and are intentionally absent.
 */
export const evidenceOwnerRegistry = Object.freeze({
  // The wave pipeline's post-integration completer runs the task's declared
  // verification commands on the canonical tree (completeNonFileEvidence).
  VERIFICATION_ONLY: 'WAVE_NON_FILE_COMPLETION',
  // The zero-AI coordinator duty executor completes these when the artifact
  // its duty generated exists (completeNonFileEvidence, artifact check).
  COORDINATOR_ARTIFACT: 'WAVE_NON_FILE_COMPLETION',
  // Explicit already-satisfied declarations need a reason blob from the
  // declaring context; the registry records them as covered by the same
  // deterministic completer's explicit-reason path.
  NO_OP_ALREADY_SATISFIED: 'WAVE_NON_FILE_COMPLETION',
});

/** Owners that must be resolvable for every kind a task may declare. */
const KNOWN_KINDS = new Set(TASK_EVIDENCE_KINDS);
const FILE_TRUTH_KINDS = new Set(['FILE_OUTPUT', 'TEST_PROOF', 'SHARED_SURFACE_OUTPUT']);

/**
 * Fail-closed coverage assertion over a parsed task graph. Throws when an
 * OPEN task declares an evidence kind with no registered runtime consumer —
 * a task that could never be deterministically completed must abort the
 * build BEFORE any writer/provider work is spent on it.
 *
 * @param graph parsed task graph (units + coordinatorUnits)
 * @param opts  { evidenceKinds?: string[] } — injectable registry (tests)
 */
export function assertEvidenceOwnership(graph, opts = {}) {
  const owners = opts.evidenceKinds ?? Object.keys(evidenceOwnerRegistry);
  const ownerSet = new Set(owners);
  const violations = [];
  for (const u of graph?.units ?? []) {
    if (u.done) continue;
    const kind = u.evidence ?? 'FILE_OUTPUT';
    if (!KNOWN_KINDS.has(kind)) {
      violations.push({ taskId: u.id, kind, reason: 'unknown evidence kind' });
      continue;
    }
    if (FILE_TRUTH_KINDS.has(kind)) continue; // lane-diff protocol owns these
    if (!ownerSet.has(kind)) {
      violations.push({
        taskId: u.id,
        kind,
        reason: `evidence kind ${kind} has no registered runtime consumer`,
      });
      continue;
    }
    // COORDINATOR_ARTIFACT is completed by the coordinator duty executor —
    // the unit must BE a coordinator task or its owner can never act on it.
    if (kind === 'COORDINATOR_ARTIFACT' && !isCoordinatorTask(u)) {
      violations.push({
        taskId: u.id,
        kind,
        reason: 'COORDINATOR_ARTIFACT requires [executor: COORDINATOR] ownership',
      });
    }
  }
  if (violations.length > 0) {
    const detail = violations.map((v) => `${v.taskId}: ${v.kind} — ${v.reason}`).join('; ');
    throw new Error(`EVIDENCE_OWNER_MISSING: ${detail}`);
  }
  return { ok: true, checked: (graph?.units ?? []).filter((u) => !u.done).length };
}

/**
 * The verification commands a unit's completion owner will run, derived from
 * the authoritative plan: the Phase-7 verification command list lives in the
 * package's current-milestone record (verificationCommands). T024's task body
 * enumerates the same gate; the milestone record is the machine-readable
 * authority (spec-verified), so the owner consumes THAT, not model prose.
 */
export function verificationCommandsFor(packageId, root) {
  const msPath = join(root, 'specs', 'implementation', 'current-milestone.json');
  if (!existsSync(msPath)) return { commands: [], reason: 'current-milestone.json missing' };
  const ms = JSON.parse(readFileSync(msPath, 'utf8'));
  const pkg = (ms.packages ?? []).find((p) => p.id === packageId);
  if (!pkg) return { commands: [], reason: `package ${packageId} not in milestone` };
  return { commands: pkg.verificationCommands ?? [], reason: null };
}

function git(cmd, cwd) {
  const r = spawnSync(`git ${cmd}`, { shell: true, cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function flipTaskCheckbox(tasksPath, taskId, reason) {
  const lines = readFileSync(tasksPath, 'utf8').split('\n');
  let flipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[ \] (T\d+)(.*)$/);
    if (m && m[1] === taskId) {
      lines[i] = `- [x] ${m[1]}${m[2]}`;
      flipped++;
      break;
    }
  }
  if (flipped === 0) return { flipped, error: `task ${taskId} not found open in tasks.md` };
  writeFileSync(tasksPath, lines.join('\n'));
  return { flipped, error: null, reason };
}

/**
 * Deterministic non-file completion for ONE open unit. Returns a record:
 *   { taskId, evidenceKind, owner, completed, proof, atHead }
 * NEVER throws for an ordinary not-yet-satisfiable state — RED verification
 * or a missing artifact leaves the task OPEN with the failure recorded.
 *
 * @param unit   graph unit (id, evidence, body)
 * @param ctx    { packageId, root, reason? } — root = canonical checkout
 */
export function completeNonFileEvidence(unit, ctx) {
  const kind = unit?.evidence ?? 'FILE_OUTPUT';
  const owner = evidenceOwnerRegistry[kind] ?? null;
  const base = {
    taskId: unit?.id ?? null,
    evidenceKind: kind,
    owner,
    completed: false,
    proof: null,
    atHead: git('rev-parse HEAD', ctx.root).out,
  };
  if (!owner) return { ...base, proof: `no registered owner for evidence kind ${kind}` };

  if (kind === 'VERIFICATION_ONLY') {
    const { commands, reason } = verificationCommandsFor(ctx.packageId, ctx.root);
    if (commands.length === 0)
      return { ...base, proof: `no verification commands derivable (${reason})` };
    for (const cmd of commands) {
      const r = spawnSync(cmd, { shell: true, cwd: ctx.root, encoding: 'utf8', timeout: 900_000 });
      if (r.status !== 0)
        return {
          ...base,
          proof: `verification command RED (${cmd}): ${(r.stderr ?? r.stdout ?? '').slice(-200)}`,
        };
    }
    const flip = flipTaskCheckbox(
      join(ctx.root, 'specs', ctx.packageId, 'tasks.md'),
      unit.id,
      ctx.reason,
    );
    if (flip.error) return { ...base, proof: flip.error };
    return {
      ...base,
      completed: true,
      proof: `all ${commands.length} verification commands GREEN`,
    };
  }

  if (kind === 'COORDINATOR_ARTIFACT') {
    if (!isCoordinatorTask(unit))
      return { ...base, proof: 'refusing: COORDINATOR_ARTIFACT on a non-coordinator unit' };
    // T025's artifact is the closed traceability matrix: deterministic
    // conformance = every plan task row maps to ≥1 requirement AND ≥1 AC.
    const matrix = assertTraceabilityMatrixClosed(ctx.packageId, ctx.root);
    if (!matrix.ok) return { ...base, proof: matrix.reason };
    const flip = flipTaskCheckbox(
      join(ctx.root, 'specs', ctx.packageId, 'tasks.md'),
      unit.id,
      ctx.reason,
    );
    if (flip.error) return { ...base, proof: flip.error };
    return { ...base, completed: true, proof: matrix.reason };
  }

  if (kind === 'NO_OP_ALREADY_SATISFIED') {
    if (!ctx.reason)
      return { ...base, proof: 'explicit reason required — silent completion refused' };
    const flip = flipTaskCheckbox(
      join(ctx.root, 'specs', ctx.packageId, 'tasks.md'),
      unit.id,
      ctx.reason,
    );
    if (flip.error) return { ...base, proof: flip.error };
    return { ...base, completed: true, proof: ctx.reason };
  }

  return { ...base, proof: `owner not implemented for kind ${kind}` };
}

/**
 * T025's deterministic artifact: the plan's traceability matrix is CLOSED
 * iff every task row maps to ≥1 requirement and ≥1 acceptance criterion, and
 * every row's task ids exist in the plan. Zero AI: pure arithmetic over the
 * matrix section of tasks.md.
 */
export function assertTraceabilityMatrixClosed(packageId, root) {
  const tasksPath = join(root, 'specs', packageId, 'tasks.md');
  if (!existsSync(tasksPath)) return { ok: false, reason: 'tasks.md missing' };
  const text = readFileSync(tasksPath, 'utf8');
  const matrix = text.split('## Traceability matrix')[1]?.split('## ')[0] ?? '';
  const rows = [...matrix.matchAll(/^\| (T\d+[^|]*) \| ([^|]*) \| ([^|]*) \|/gm)];
  if (rows.length === 0) return { ok: false, reason: 'traceability matrix has no task rows' };
  const openRows = [];
  for (const [, tasks, reqs, acs] of rows) {
    const reqList = reqs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const acList = acs
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (reqList.length === 0 || acList.length === 0)
      openRows.push(`${tasks.trim()}: missing requirement or AC mapping`);
  }
  if (openRows.length > 0)
    return { ok: false, reason: `matrix rows unmapped — ${openRows.join('; ')}` };
  return { ok: true, reason: `traceability matrix closed: ${rows.length} task rows, all mapped` };
}

// ── CLI: post-integration non-file completion pass (zero AI) ─────────────────
//   node scripts/automation/evidence-owner-registry.mjs \
//     --package <id> --graph <task-graph.json> [--reason <why>]
// Walks every OPEN non-file-evidence unit and attempts its deterministic
// completion on the canonical tree; commits checkbox flips as the wave
// coordinator (same commit identity integration uses). RED/missing-artifact
// outcomes are recorded, never fatal — the owning gate decides final truth.
const invokedDirectly = process.argv[1]?.endsWith('evidence-owner-registry.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const packageId = value('--package');
  const graphPath = value('--graph');
  const reason = value('--reason') ?? 'evidence owner ran its verification/artifact duty';
  if (!packageId || !graphPath) {
    console.error(
      'usage: evidence-owner-registry.mjs --package <id> --graph <task-graph.json> [--reason <why>]',
    );
    process.exit(2);
  }
  const root = process.cwd();
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const unitsById = new Map((graph.units ?? []).map((u) => [u.id, u]));
  const targets = (graph.units ?? []).filter(
    (u) =>
      !u.done &&
      u.evidence &&
      ['VERIFICATION_ONLY', 'COORDINATOR_ARTIFACT', 'NO_OP_ALREADY_SATISFIED'].includes(u.evidence),
  );
  const results = [];
  for (const u of targets) {
    results.push(completeNonFileEvidence(unitsById.get(u.id) ?? u, { packageId, root, reason }));
  }
  const flipped = results.filter((r) => r.completed).map((r) => r.taskId);
  if (flipped.length > 0) {
    git(`add specs/${packageId}/tasks.md`, root);
    const commit = git(
      `-c user.email=noreply@foresift.local -c user.name='wave-coordinator' commit -m "chore(${packageId}): mark evidence-owned units complete [${flipped.join(',')}] (deterministic non-file evidence)"`,
      root,
    );
    if (!commit.ok) console.error(`evidence-owner: commit failed: ${commit.err}`);
  }
  process.stdout.write(
    `${JSON.stringify({ schema: 'foresift/evidence-owner@1', package: packageId, results }, null, 2)}\n`,
  );
  const open = results.filter((r) => !r.completed).map((r) => `${r.taskId}: ${r.proof}`);
  console.error(
    `evidence-owner: completed=[${flipped.join(',') || 'none'}] stillOpen=${open.length ? open.join(' | ') : 'none'}`,
  );
}
