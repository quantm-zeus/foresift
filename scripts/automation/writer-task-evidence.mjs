// Shared writer-side task-evidence plumbing (Hyperdrive H3, P0-1): parse the
// wave's task graph and derive evidence-backed completion nominations for a
// lane. Used by exec-claude-writer, exec-codex-writer, and
// exec-agy-test-writer so all three engines share ONE fail-closed protocol —
// a writer may only nominate exact task IDs whose predicted writes actually
// appear in the lane's own diff. Any DIFF never implies ALL assigned tasks.
import { readFileSync } from 'node:fs';
import { nominateCompletedUnits, unitsIndexFromGraph } from './task-completion-evidence.mjs';

/** Parse a task-graph JSON file into a unitsById index. Throws unreadable. */
export function parseTaskGraph(graphPath) {
  let graph = null;
  try {
    graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  } catch {
    return null; // evidence-unavailable path: writers fall back to zero claims
  }
  if (!graph?.units) return null;
  return { graph, unitsById: unitsIndexFromGraph(graph) };
}

/**
 * Deterministic completion claims for a finished lane (evidence-backed).
 *
 *   taskIds    — the lane's assigned task ids (routing/graph)
 *   changed    — the lane's ACTUAL changed files (git truth, not claims)
 *   unitsById  — parsed task-graph unit index
 *   blockers   — writer-declared blockers (string blobs or {taskId})
 *
 * The writer nominates ONLY tasks whose predicted writes it demonstrably
 * touched. Everything else lands in `deferred` with a reason, and the result
 * JSON records it so the coordinator can keep those tasks OPEN. An empty diff
 * nominates nothing — never fabricated. A model merely saying "done"
 * completes nothing.
 */
export function claimCompletedUnits({ taskIds, changed, unitsById, blockers = [] }) {
  return nominateCompletedUnits({
    assignedTaskIds: taskIds,
    unitsById,
    changedFiles: changed,
    blockers,
  });
}
