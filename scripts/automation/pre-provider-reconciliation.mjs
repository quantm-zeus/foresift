// Pre-provider already-satisfied reconciliation (directive 2026-09-06 §4).
//
// Live evidence (run fbbcb1d7, core-batch-1): a writer lane burned 64m35s on
// units whose every predicted output already existed at HEAD with trusted
// package-lineage ancestry — changedFiles=0, SUCCESS, zero product value. The
// §6 already-satisfied audit inside evidence-owner-registry only runs
// POST-integration, when the provider spend is already sunk. This pass runs
// the SAME trusted-ancestry arithmetic (fileEvidenceAlreadySatisfied) BEFORE
// any writer lane dispatches, so an already-satisfied FILE_OUTPUT unit is
// reconciled deterministically: checkbox closed as NO_OP_ALREADY_SATISFIED in
// ONE coordinator commit, recorded in a machine-readable report the wave
// mirrors for telemetry.
//
// Fail-closed laws (never weaken completion):
//   - only OPEN, non-coordinator FILE_OUTPUT units participate; VERIFICATION_
//     ONLY / COORDINATOR_ARTIFACT units stay with their own owners;
//   - a missing output, missing authoring commit, or authorship that does not
//     postdate the trusted base (graph.bound.mainHeadSha) leaves the unit
//     OPEN and is recorded as a blocker — never silently flipped, and mere
//     file existence is never proof;
//   - the pass is pure git/FS arithmetic (zero AI): flips are computed for
//     ALL units first, written once, then committed atomically; when the
//     commit fails the write is reverted (no half-flipped dirty state).
//
// Usage (wave prep node):
//   node scripts/automation/pre-provider-reconciliation.mjs \
//     --package <id> --graph <task-graph.json> [--report <out.json>]
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileEvidenceAlreadySatisfied } from './evidence-owner-registry.mjs';

const REPORT_SCHEMA = 'foresift/pre-provider-reconciliation@1';

function git(cmd, cwd) {
  const r = spawnSync(`git ${cmd}`, { shell: true, cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/**
 * Reconcile already-satisfied FILE_OUTPUT units of `graph` on the canonical
 * tree BEFORE provider acquisition. Returns the per-unit report and — when
 * ctx.commit !== false — persists the flips in ONE coordinator commit
 * (reverting the write on commit failure).
 *
 * @param graph task graph as emitted by build-implementation-task-graph.mjs
 *              (units carry id/done/evidence/predictedWrites; bound.mainHeadSha
 *              is the trusted launch/adoption base)
 * @param ctx   { root, packageId, reportPath?, commit? }
 */
export function preProviderReconciliation(graph, ctx) {
  const root = ctx.root;
  const packageId = ctx.packageId;
  const trustedBase = graph?.bound?.mainHeadSha ?? null;
  const reconciled = [];
  const decisions = [];
  const blocked = [];
  const outOfScope = [];
  const flips = [];
  for (const u of graph.units ?? []) {
    if (u.done) continue;
    // Reservation/no-op law (run 4e59191b/T020, 2026-09-10): a unit whose
    // full task block carries [evidence: NO_OP_ALREADY_SATISFIED] (resolved
    // over title + wrapped continuation lines at graph build) and predicts
    // ZERO writes has nothing to prove on disk — the marker plus the empty
    // write set IS the deterministic proof. Flip closed here, BEFORE any
    // provider can be acquired, so the unit never reaches a writer lane.
    // A NO_OP unit that still predicts writes is contradictory (claims
    // no-op while naming deliverables) — it falls through to outOfScope
    // below and stays OPEN, never silently skipped.
    if (
      u.evidence === 'NO_OP_ALREADY_SATISFIED' &&
      (u.predictedWrites ?? []).length === 0 &&
      (u.testWrites ?? []).length === 0
    ) {
      reconciled.push(u.id);
      decisions.push({
        taskId: u.id,
        proof:
          'NO_OP_ALREADY_SATISFIED block marker with zero predicted writes — nothing to author or verify on disk',
      });
      flips.push(u.id);
      continue;
    }
    if (!u.evidence || u.evidence === 'FILE_OUTPUT') {
      const audit = fileEvidenceAlreadySatisfied(u, { root, trustedBase });
      if (audit.satisfied) {
        reconciled.push(u.id);
        decisions.push({ taskId: u.id, proof: audit.reason, fileProof: audit.proof });
        flips.push(u.id);
      } else {
        blocked.push({ taskId: u.id, reason: audit.reason });
      }
    } else {
      // Non-file evidence kinds have their own deterministic owners
      // (evidence-owner-registry post-FAST, coordinator bookkeeping) — the
      // pre-provider pass never claims them.
      outOfScope.push(u.id);
    }
  }
  let commit = null;
  if (flips.length > 0 && ctx.commit !== false) {
    const tasksPath = join(root, 'specs', packageId, 'tasks.md');
    const before = readFileSync(tasksPath, 'utf8');
    const lines = before.split('\n');
    const pending = [...flips];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^- \[ \] (T\d+)(.*)$/);
      if (m && pending.includes(m[1])) {
        lines[i] =
          `- [x] ${m[1]}${m[2]} — [evidence: NO_OP_ALREADY_SATISFIED] reconciled pre-provider (already satisfied at trusted base)`;
        pending.splice(pending.indexOf(m[1]), 1);
      }
    }
    writeFileSync(tasksPath, lines.join('\n'));
    git(`add specs/${packageId}/tasks.md`, root);
    const c = git(
      `-c user.email=noreply@foresift.local -c user.name='wave-coordinator' commit -m "chore(${packageId}): pre-provider reconciliation of already-satisfied units (NO_OP_ALREADY_SATISFIED)"`,
      root,
    );
    if (c.ok) {
      commit = git('rev-parse HEAD', root).out.slice(0, 12);
    } else {
      // Commit failed → revert the write; tasks stay logically OPEN.
      writeFileSync(tasksPath, before);
      git(`reset -q specs/${packageId}/tasks.md`, root);
      for (const d of decisions)
        d.proof = `${d.proof}; commit FAILED — flip reverted, task remains OPEN`;
      console.error(`pre-provider-reconciliation: commit failed: ${c.err}`);
    }
  }
  const report = {
    schema: REPORT_SCHEMA,
    packageId,
    atHead: git('rev-parse HEAD', root).out,
    trustedBase,
    reconciled,
    decisions,
    blocked,
    outOfScope,
    ...(commit ? { commit } : {}),
  };
  if (ctx.reportPath) writeFileSync(ctx.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const invokedDirectly = process.argv[1]?.endsWith('pre-provider-reconciliation.mjs');
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const packageId = value('--package');
  const graphPath = value('--graph');
  if (!packageId || !graphPath) {
    console.error(
      'usage: pre-provider-reconciliation.mjs --package <id> --graph <task-graph.json> [--report <out.json>]',
    );
    process.exit(2);
  }
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const report = preProviderReconciliation(graph, {
    root: process.cwd(),
    packageId,
    reportPath: value('--report'),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  console.error(
    `pre-provider-reconciliation: reconciled=[${report.reconciled.map((r) => r.taskId).join(',') || 'none'}] blocked=${report.blocked.length} outOfScope=${report.outOfScope.length}`,
  );
}
