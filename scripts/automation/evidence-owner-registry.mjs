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
 * The verification contract for ONE unit, resolved from the task's declared
 * verification profile — never model prose. A unit's body may declare
 * `[verification: PROFILE]`; the profile maps to the authoritative command
 * set in VERIFICATION_PROFILES (single source of truth). A VERIFICATION_ONLY
 * unit with NO declared profile falls back to the package's milestone-record
 * verificationCommands (the pre-existing behavior), but a DECLARED profile
 * that is unknown or unmapped fails closed — a weaker gate must never stand
 * in for the task's contract.
 */
export const VERIFICATION_PROFILES = Object.freeze({
  // T024's full convergence gate (specs/g0-traceability-conformance/tasks.md
  // Phase 7): the package suites, the central migration-registry suite with
  // the extended registry, the deterministic conformance CLI, the generated
  // docs drift check, and the repo-level verify+spec:verify. Commands run at
  // the canonical tree root; `--filter` commands are pnpm workspace scoped.
  TRACEABILITY_FULL_CONVERGENCE: [
    'pnpm --filter @foresift/requirement-manifest test',
    'pnpm --filter @foresift/release-conformance test',
    'bun test ./packages/persistence/test/migrator.spec.ts',
    'node scripts/verify-release-conformance/cli.mjs',
    'node scripts/generate-requirement-manifest/cli.mjs --check',
    'pnpm spec:verify',
  ],
});

const VERIFICATION_MARKER = /\[verification:\s*([A-Za-z_-]+)\]/;

export function verificationProfileFor(unit) {
  const m = VERIFICATION_MARKER.exec(String(unit?.body ?? ''));
  return m ? m[1] : null;
}

/**
 * The verification commands a unit's completion owner will run, derived from
 * the authoritative plan: a declared [verification: PROFILE] maps to the
 * single-source VERIFICATION_PROFILES command set; without a profile the
 * package's current-milestone verificationCommands apply (legacy fallback).
 */
export function verificationCommandsFor(unit, packageId, root) {
  const profile = verificationProfileFor(unit);
  if (profile != null) {
    const commands = VERIFICATION_PROFILES[profile];
    if (!commands)
      return {
        commands: [],
        reason: `unknown verification profile ${profile}`,
        profile,
        profileSource: 'declared-but-unmapped',
      };
    return { commands: [...commands], reason: null, profile, profileSource: 'declared' };
  }
  const msPath = join(root, 'specs', 'implementation', 'current-milestone.json');
  if (!existsSync(msPath))
    return {
      commands: [],
      reason: 'current-milestone.json missing',
      profile: null,
      profileSource: 'milestone',
    };
  const ms = JSON.parse(readFileSync(msPath, 'utf8'));
  const pkg = (ms.packages ?? []).find((p) => p.id === packageId);
  if (!pkg)
    return {
      commands: [],
      reason: `package ${packageId} not in milestone`,
      profile: null,
      profileSource: 'milestone',
    };
  return {
    commands: pkg.verificationCommands ?? [],
    reason: null,
    profile: null,
    profileSource: 'milestone',
  };
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
  const dry = ctx.dryRun === true;
  const flipOrProbe = () => {
    if (dry) return { flipped: 1, error: null, dryRun: true };
    return flipTaskCheckbox(
      join(ctx.root, 'specs', ctx.packageId, 'tasks.md'),
      unit.id,
      ctx.reason,
    );
  };

  if (kind === 'VERIFICATION_ONLY') {
    const { commands, reason, profile, profileSource } = verificationCommandsFor(
      unit,
      ctx.packageId,
      ctx.root,
    );
    if (commands.length === 0)
      return { ...base, proof: `no verification commands derivable (${reason})` };
    const outcomes = [];
    for (const cmd of commands) {
      const r = spawnSync(cmd, { shell: true, cwd: ctx.root, encoding: 'utf8', timeout: 900_000 });
      outcomes.push({ command: cmd, exitCode: r.status ?? null });
      if (r.status !== 0)
        return {
          ...base,
          profile: profile ?? null,
          profileSource,
          commandOutcomes: outcomes,
          proof: `verification command RED (${cmd}): ${(r.stderr ?? r.stdout ?? '').slice(-200)}`,
        };
    }
    const flip = flipOrProbe();
    if (flip.error) return { ...base, proof: flip.error };
    return {
      ...base,
      completed: true,
      profile: profile ?? null,
      profileSource,
      commandOutcomes: outcomes,
      proof: `all ${commands.length} verification commands GREEN (${profileSource}${profile ? `:${profile}` : ''})${dry ? ' (dry-run)' : ''}`,
    };
  }

  if (kind === 'COORDINATOR_ARTIFACT') {
    if (!isCoordinatorTask(unit))
      return { ...base, proof: 'refusing: COORDINATOR_ARTIFACT on a non-coordinator unit' };
    // T025's artifact is the closed traceability matrix: deterministic
    // conformance = full authoritative-task coverage + non-empty mappings +
    // ordered rows (assertTraceabilityMatrixClosed).
    const matrix = assertTraceabilityMatrixClosed(ctx.packageId, ctx.root, {
      taskIds: ctx.taskIds,
    });
    if (!matrix.ok) return { ...base, proof: matrix.reason };
    const flip = flipOrProbe();
    if (flip.error) return { ...base, proof: flip.error };
    return { ...base, completed: true, proof: dry ? `${matrix.reason} (dry-run)` : matrix.reason };
  }

  if (kind === 'NO_OP_ALREADY_SATISFIED') {
    if (!ctx.reason)
      return { ...base, proof: 'explicit reason required — silent completion refused' };
    const flip = flipOrProbe();
    if (flip.error) return { ...base, proof: flip.error };
    return { ...base, completed: true, proof: dry ? `${ctx.reason} (dry-run)` : ctx.reason };
  }

  return { ...base, proof: `owner not implemented for kind ${kind}` };
}

/**
 * T025's deterministic artifact: the plan's traceability matrix is CLOSED
 * iff (1) the matrix exists with task rows; (2) every row's task ids resolve
 * against the AUTHORITATIVE task set (tasks.md checkbox ids + any task-graph
 * ids); (3) every authoritative task id is covered by ≥1 row (ranges expand,
 * en-dash or hyphen); (4) requirement and AC mappings are non-empty; (5) the
 * completing unit itself is covered. Unknown ids and uncovered tasks fail
 * closed. Zero AI: pure arithmetic over tasks.md.
 */
export function assertTraceabilityMatrixClosed(packageId, root, opts = {}) {
  const tasksPath = join(root, 'specs', packageId, 'tasks.md');
  if (!existsSync(tasksPath)) return { ok: false, reason: 'tasks.md missing' };
  const text = readFileSync(tasksPath, 'utf8');
  const matrix = text.split('## Traceability matrix')[1]?.split(/\n## /)[0] ?? '';
  const rows = [...matrix.matchAll(/^\| (T\d+[^|]*) \| ([^|]*) \| ([^|]*) \|/gm)];
  if (rows.length === 0) return { ok: false, reason: 'traceability matrix has no task rows' };

  // Authoritative task set: checkbox ids in tasks.md (+ task graph ids when
  // provided). The matrix must cover EXACTLY this set — no unknown ids, no
  // missing coverage.
  const authoritative = new Set(opts.taskIds ?? []);
  for (const m of text.matchAll(/^- \[.\] (T\d+)/gm)) authoritative.add(m[1]);
  if (authoritative.size === 0) return { ok: false, reason: 'no authoritative task ids found' };

  const expandRange = (token) => {
    const r = token.match(/^(T\d+)\s*[–-]\s*(T\d+)$/);
    if (!r) return /^\d+$/.test(token) ? [`T${token}`] : [token];
    const [, a, b] = r;
    const na = Number(a.slice(1));
    const nb = Number(b.slice(1));
    if (!Number.isInteger(na) || !Number.isInteger(nb) || nb < na) return null; // invalid range
    const out = [];
    for (let i = na; i <= nb; i++) out.push(`T${String(i).padStart(a.length - 1, '0')}`);
    return out;
  };

  const covered = new Map(); // taskId -> row label
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
    const rowLabel = tasks.trim();
    if (reqList.length === 0 || acList.length === 0) {
      openRows.push(`${rowLabel}: missing requirement or AC mapping`);
      continue;
    }
    for (const token of rowLabel
      .split(/[,+]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const ids = expandRange(token);
      if (!ids) {
        openRows.push(`${rowLabel}: invalid task range '${token}'`);
        continue;
      }
      for (const id of ids) {
        if (!authoritative.has(id)) {
          openRows.push(`${rowLabel}: unknown task id '${id}'`);
          continue;
        }
        covered.set(id, rowLabel);
      }
    }
  }
  if (openRows.length > 0)
    return { ok: false, reason: `matrix rows invalid — ${openRows.join('; ')}` };

  const missing = [...authoritative].filter((id) => !covered.has(id)).sort();
  if (missing.length > 0)
    return {
      ok: false,
      reason: `matrix does not cover authoritative tasks — missing: ${missing.join(',')}`,
    };

  const order = [...authoritative].sort();
  const coveredOrdered = order.filter((id) => covered.has(id));
  const rowsSorted = [...rows].map((r) => r[1].trim()).join('|');
  const canonicalRows = [...new Set(coveredOrdered.map((id) => covered.get(id)))].join('|');
  if (!rowsSorted.includes(canonicalRows))
    return {
      ok: false,
      reason: `matrix rows are not ordered by authoritative task id (expected ${canonicalRows})`,
    };
  return {
    ok: true,
    reason: `traceability matrix closed: ${rows.length} rows cover all ${authoritative.size} authoritative tasks, all mapped`,
  };
}

/**
 * Already-satisfied file-truth completion (live root cause run e9af6ec0, part
 * 2): after recovery replays, a wave's adopted base can already contain a
 * unit's deliverables (authored by EARLIER validated lanes of the SAME
 * package branch — salvage/repair integrations). Re-dispatched writers then
 * correctly produce zero diffs, and the P0-1 diff protocol correctly
 * nominates zero units — integration_empty. The supported deterministic
 * completion for that shape: every predicted write EXISTS at the canonical
 * HEAD and was authored on THIS package branch (git-log provenance), so the
 * unit is already satisfied. Proof = the authoring commit per file. This is
 * file truth from git, never model prose, and never a lane-diff bypass: the
 * authoring commits themselves went through guards + integration validation.
 */
/**
 * Already-satisfied audit for open FILE-truth units (directive §6):
 * every predicted write must exist at HEAD with package authorship —
 * its latest authoring commit postdates ctx.trustedBase (the adopted
 * launch head) and is a descendant of it. A base-commit author means a
 * pre-existing fixture (stays OPEN unless opts.allowBaseFiles).
 *
 * @param unit graph unit (id, predictedWrites, testWrites)
 * @param ctx  { root, trustedBase?, allowBaseFiles? } — trustedBase = the
 *             package's trusted launch/adoption commit (graph.bound.mainHeadSha)
 */
export function fileEvidenceAlreadySatisfied(unit, ctx) {
  const writes = [...(unit?.predictedWrites ?? []), ...(unit?.testWrites ?? [])];
  if (writes.length === 0)
    return { satisfied: false, reason: `no predicted writes recorded for ${unit?.id}` };
  const proof = [];
  for (const w of writes) {
    // glob writes: expand against the working tree via git ls-files
    let paths = [w];
    if (w.includes('*')) {
      const ls = git(`ls-files '${w}'`, ctx.root);
      paths = ls.out.split('\n').filter(Boolean);
      if (paths.length === 0)
        return { satisfied: false, reason: `glob ${w} matches no tracked files` };
    }
    for (const p of paths) {
      const exists = spawnSync(`git cat-file -e HEAD:'${p}'`, {
        shell: true,
        cwd: ctx.root,
        encoding: 'utf8',
      });
      if (exists.status !== 0)
        return { satisfied: false, reason: `predicted write ${p} not present at HEAD` };
      const author = git(`log --format=%H --follow -1 -- '${p}'`, ctx.root);
      if (!author.ok || !author.out)
        return { satisfied: false, reason: `no authoring commit found for ${p}` };
      // Trusted-ancestry proof (directive §6): the deliverable must carry
      // package authorship — its latest authoring commit must postdate the
      // trusted launch/adoption base (graph.bound.mainHeadSha) and be a
      // descendant of it. A file whose latest author is the base commit
      // itself is a pre-existing fixture that merely matches a predicted
      // path (the unrelated-file trap): it stays OPEN unless the caller
      // explicitly opts in with allowBaseFiles. When no trustedBase is
      // provided the check degrades to authorship-at-HEAD
      // (scratch/non-repo fixtures); the wave CLI always passes
      // graph.bound.mainHeadSha (the adopted launch head).
      if (ctx.trustedBase) {
        const authoredSinceBase =
          author.out !== ctx.trustedBase &&
          git(`merge-base --is-ancestor ${ctx.trustedBase} ${author.out}`, ctx.root).ok;
        if (!authoredSinceBase && !ctx.allowBaseFiles) {
          // CASE 1 guard (directive §6): the file's latest authoring commit is
          // the trusted base itself — a base fixture that merely matches a
          // predicted path carries no package authorship since adoption.
          // Completion via base existence needs the caller's explicit opt-in
          // (allowBaseFiles), never silent trust.
          return {
            satisfied: false,
            reason: `predicted write ${p} existed at trusted base ${String(ctx.trustedBase).slice(0, 12)} with no package authorship since`,
          };
        }
      }
      proof.push({ path: p, authoringCommit: author.out.slice(0, 12) });
    }
  }
  return {
    satisfied: true,
    reason: `all ${proof.length} predicted write(s) present at HEAD with package-branch provenance${ctx.trustedBase ? ` (ancestor of trusted base ${String(ctx.trustedBase).slice(0, 12)})` : ''}`,
    proof,
  };
}

// ── CLI: post-integration non-file completion pass (zero AI) ─────────────────
//   node scripts/automation/evidence-owner-registry.mjs \
//     --package <id> --graph <task-graph.json> [--reason <why>]
// Walks every OPEN non-file-evidence unit and attempts its deterministic
// completion on the canonical tree; commits checkbox flips as the wave
// coordinator (same commit identity integration uses). RED/missing-artifact
// outcomes are recorded, never fatal — the owning gate decides final truth.
//
// Completion-mutation atomicity (G0 final delta): the tasks.md write is only
// durable once committed. The pass computes ALL flips first, writes once,
// then `git add <exact file>` + one coordinator commit; if the commit fails
// the write is reverted (task stays logically OPEN — no half-completed dirty
// state), and completed=false is reported for every unit in the pass.
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
  const taskIds = (graph.units ?? []).map((u) => u.id);
  // Open FILE-truth units get the already-satisfied audit first: if every
  // predicted write exists at HEAD with package-branch provenance, the unit is
  // deterministic-completed with per-file proof (e9af6ec0 root cause part 2).
  // Trusted base = the graph's bound launch/adoption head (directive §6): an
  // output first authored by an untrusted commit (this run's own lane diff)
  // never satisfies the audit — it must have existed in authoritative history.
  const trustedBase = graph?.bound?.mainHeadSha ?? null;
  const alreadySatisfied = [];
  for (const u of graph.units ?? []) {
    if (u.done) continue;
    if (u.evidence && u.evidence !== 'FILE_OUTPUT') continue; // non-file handled below
    const audit = fileEvidenceAlreadySatisfied(u, { root, trustedBase });
    if (audit.satisfied) alreadySatisfied.push(u.id);
  }
  // Dry-run evaluation FIRST (no mutation): which units would complete?
  const evaluated = [];
  for (const u of targets) {
    const probe = completeNonFileEvidence(unitsById.get(u.id) ?? u, {
      packageId,
      root,
      reason,
      taskIds,
      dryRun: true,
    });
    evaluated.push(probe);
  }
  const wouldFlip = [
    ...alreadySatisfied,
    ...evaluated.filter((r) => r.completed).map((r) => r.taskId),
  ];
  // Apply: flip all completing units in ONE write, then commit atomically.
  const results = evaluated.map((r) => ({ ...r, completed: false, committed: false }));
  if (wouldFlip.length > 0) {
    const tasksPath = join(root, 'specs', packageId, 'tasks.md');
    const before = readFileSync(tasksPath, 'utf8');
    const lines = before.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^- \[ \] (T\d+)(.*)$/);
      if (m && wouldFlip.includes(m[1])) lines[i] = `- [x] ${m[1]}${m[2]}`;
    }
    writeFileSync(tasksPath, lines.join('\n'));
    git(`add specs/${packageId}/tasks.md`, root);
    const commit = git(
      `-c user.email=noreply@foresift.local -c user.name='wave-coordinator' commit -m "chore(${packageId}): mark evidence-owned units complete [${wouldFlip.join(',')}] (deterministic non-file evidence)"`,
      root,
    );
    if (commit.ok) {
      for (const r of results) {
        if (wouldFlip.includes(r.taskId)) {
          r.completed = true;
          r.committed = true;
          r.proof = `${r.proof}; committed ${commit.out.slice(0, 12)}`;
        }
      }
    } else {
      // Commit failed → revert the write; tasks stay logically OPEN.
      writeFileSync(tasksPath, before);
      git(`reset -q specs/${packageId}/tasks.md`, root);
      for (const r of results) {
        if (wouldFlip.includes(r.taskId))
          r.proof = `${r.proof}; commit FAILED — flip reverted, task remains OPEN`;
      }
      console.error(`evidence-owner: commit failed: ${commit.err}`);
    }
  }
  for (const id of alreadySatisfied) {
    const audit = fileEvidenceAlreadySatisfied(unitsById.get(id), { root, trustedBase });
    results.push({
      taskId: id,
      evidenceKind: 'FILE_OUTPUT',
      owner: 'ALREADY_SATISFIED_AT_HEAD',
      completed:
        wouldFlip.includes(id) && results.every((r) => (r.taskId !== id ? true : r.completed)),
      proof: audit.reason,
      fileProof: audit.proof,
      atHead: git('rev-parse HEAD', root).out,
    });
  }
  process.stdout.write(
    `${JSON.stringify({ schema: 'foresift/evidence-owner@1', package: packageId, results }, null, 2)}\n`,
  );
  const open = results.filter((r) => !r.completed).map((r) => `${r.taskId}: ${r.proof}`);
  console.error(
    `evidence-owner: completed=[${wouldFlip.join(',') || 'none'}] stillOpen=${open.length ? open.join(' | ') : 'none'}`,
  );
}
