// Evidence-backed, fail-closed task-completion protocol (Hyperdrive H3, P0-1).
//
// The g0-mcp-surface MCP run proved that a lane writer could partially
// implement its assignment yet claim EVERY assigned task complete — the old
// invariant `ANY DIFF => ALL LANE TASKS COMPLETE` (exec-codex-writer.mjs
// `completed: head === before ? [] : route.taskIds`, exec-claude-writer.mjs
// `completed: head === before ? [] : task-ids`, and the AGY writer's
// unconditional claim) is not completion evidence at all.
//
// New contract:
//   1. A writer may only NOMINATE exact task IDs it believes finished —
//      mechanically, deterministically: a task is nominatable iff the lane's
//      actual diff touches at least one of that task's predicted writes.
//   2. The coordinator (integrate-writer-results.mjs) re-validates every
//      nominated ID against ITS OWN recomputed diff: lane membership, unit
//      existence, predicted-write evidence, and declared blockers.
//   3. Missing/ambiguous evidence ⇒ the task stays OPEN. One completed task
//      never implies sibling tasks are complete. A model merely saying "done"
//      completes nothing.
//
// Zero AI: nomination and validation are deterministic arithmetic over git
// truth and the parsed task graph.

/**
 * Predicted-write evidence for ONE task. A task is evidencable iff its unit
 * is known AND (a) it has at least one predicted write that appears in the
 * lane diff (FILE_OUTPUT, the P0-1 default), or (b) its unit declares a
 * non-file evidence kind that the caller's context can satisfy:
 *
 *   VERIFICATION_ONLY — the caller (coordinator/gate context) proves the
 *     task by running its verification; a lane diff can NEVER complete it
 *     (a writer claiming it is deferred with that reason, never fabricated).
 *   COORDINATOR_ARTIFACT — the coordinator duty executor completes it when
 *     the artifact it generates exists (wave-coordinator-duties.mjs).
 *   NO_OP_ALREADY_SATISFIED — completion requires an explicit reason blob
 *     from the declaring context; a silent lane diff never completes it.
 *   TEST_PROOF — the task's testWrites appear in the diff.
 *   SHARED_SURFACE_OUTPUT — expressed via the exact-lease manager; a lane
 *     diff over a leased shared surface is coordinator-verified separately.
 *
 * Unknown/absent evidence kinds (the conservative default FILE_OUTPUT with
 * no predicted writes) mean the task can never be completed by this
 * protocol — it stays open and needs explicit coordinator/plan handling.
 */
export function taskEvidence(taskId, unitsById, changedFiles) {
  const unit = unitsById?.get?.(taskId);
  if (!unit) return { evidencable: false, reason: `unknown unit ${taskId}` };
  const predicted = unit.predictedWrites ?? [];
  const changed = new Set(changedFiles ?? []);
  // Non-file kinds: a lane diff alone can never complete them — they are
  // completed only by their owning context (coordinator duties, gate runs,
  // explicit already-satisfied declarations). Report deferrable with the
  // kind so the caller can route the proof obligation correctly.
  const evidenceKind = unit.evidence ?? 'FILE_OUTPUT';
  if (
    evidenceKind !== 'FILE_OUTPUT' &&
    evidenceKind !== 'TEST_PROOF' &&
    evidenceKind !== 'SHARED_SURFACE_OUTPUT'
  )
    return {
      evidencable: false,
      deferredByEvidenceKind: true,
      evidenceKind,
      reason: `task ${taskId} declares evidence kind ${evidenceKind} — completed by its owning context, never by a lane diff`,
    };
  const writes = evidenceKind === 'TEST_PROOF' ? (unit.testWrites ?? []) : predicted;
  if (!Array.isArray(writes) || writes.length === 0)
    return { evidencable: false, reason: `no predicted writes recorded for ${taskId}` };
  const evidence = writes.filter((p) => changed.has(p));
  if (evidence.length === 0)
    return {
      evidencable: false,
      reason: `none of ${taskId}'s predicted writes appear in the lane diff`,
    };
  return { evidencable: true, evidence, reason: null };
}

function isBlocked(taskId, blockers) {
  return (blockers ?? []).some((b) =>
    typeof b === 'string'
      ? b.split(/\s+/).includes(taskId) || b === taskId
      : (b?.taskId ?? null) === taskId,
  );
}

/**
 * Writer-side nomination (deterministic). Returns { nominated, deferred }:
 *   nominated — exact task IDs with predicted-write evidence in `changedFiles`
 *   deferred  — { taskId, reason } for every assigned task NOT nominated
 *               (unknown unit, no predicted writes, no diff evidence, or a
 *               declared blocker). Deferred tasks stay OPEN — never implied
 *               complete by a sibling's completion.
 */
export function nominateCompletedUnits({
  assignedTaskIds,
  unitsById,
  changedFiles,
  blockers = [],
}) {
  const nominated = [];
  const deferred = [];
  for (const taskId of assignedTaskIds ?? []) {
    if (isBlocked(taskId, blockers)) {
      deferred.push({ taskId, reason: 'declared blocker' });
      continue;
    }
    const ev = taskEvidence(taskId, unitsById, changedFiles);
    if (ev.evidencable) nominated.push(taskId);
    else deferred.push({ taskId, reason: ev.reason });
  }
  return { nominated, deferred };
}

/**
 * Coordinator-side validation (fail-closed). Every nominated ID must:
 *   - belong to THIS lane (lane membership from the task graph),
 *   - resolve to a known unit,
 *   - carry predicted-write evidence in the coordinator's OWN recomputed diff,
 *   - not be declared blocked by the writer.
 * Anything else is rejected closed (recorded, task stays OPEN) — an invalid
 * nomination never completes a task and never fails the lane merge itself
 * (code truth is owned by the gates; task-state truth is owned by evidence).
 */
export function validateLaneNominations({
  laneTaskIds,
  unitsById,
  changedFiles,
  nominatedTaskIds,
  blockers = [],
}) {
  const laneSet = new Set(laneTaskIds ?? []);
  const accepted = [];
  const rejected = [];
  for (const taskId of nominatedTaskIds ?? []) {
    if (!laneSet.has(taskId)) {
      rejected.push({ taskId, reason: `task not assigned to this lane` });
      continue;
    }
    if (isBlocked(taskId, blockers)) {
      rejected.push({ taskId, reason: 'declared blocker' });
      continue;
    }
    const ev = taskEvidence(taskId, unitsById, changedFiles);
    if (ev.evidencable) accepted.push(taskId);
    else rejected.push({ taskId, reason: ev.reason });
  }
  return { accepted, rejected };
}

/**
 * Build a unitsById map from a parsed task graph (`graph.units`).
 */
export function unitsIndexFromGraph(graph) {
  return new Map((graph?.units ?? []).map((u) => [u.id, u]));
}
