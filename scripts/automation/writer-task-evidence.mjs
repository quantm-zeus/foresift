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
 * P0 hardening (live 89c4b2b9, 2026-09-01): a writer expected to produce
 * evidence-backed task completion MUST possess a valid task graph BEFORE any
 * provider spend. Without it the P0-1 arithmetic has no predicted writes to
 * match, the writer nominates zero units, the integrator rejects every lane
 * ("writer reported zero completed units"), and 10-55 minutes of provider work
 * dies at integration — the defect was wiring, and only THIS gate makes the
 * omission impossible to burn tokens on. Fail closed BEFORE permit
 * acquisition / provider spawn:
 *   - no --task-graph argument          → refuse
 *   - unreadable / malformed graph      → refuse
 *   - graph without a units array       → refuse
 *   - no assigned task ids              → refuse
 * Callers invoke this before acquireLanePermit. Only a caller that
 * deliberately completes NO tasks (not applicable today) may bypass.
 */
export function requireTaskGraphForCompletionEvidence({ graphPath, taskIds, engine, lane }) {
  const fail = (reason) => {
    throw new Error(`TASK_GRAPH_REQUIRED_FOR_COMPLETION_EVIDENCE: ${reason}`);
  };
  if (!graphPath) fail(`${engine} lane ${lane} has no --task-graph argument`);
  const parsed = parseTaskGraph(graphPath);
  if (!parsed) fail(`${engine} lane ${lane}: task graph unreadable or malformed at ${graphPath}`);
  if (!Array.isArray(parsed.graph.units) || parsed.graph.units.length === 0)
    fail(`${engine} lane ${lane}: task graph carries no units`);
  const assigned = (taskIds ?? []).filter(Boolean);
  if (assigned.length === 0)
    fail(`${engine} lane ${lane}: no assigned task ids — nothing can ever be evidenced`);
  const known = assigned.filter((id) => parsed.unitsById.has(id));
  if (known.length === 0)
    fail(
      `${engine} lane ${lane}: assigned task ids ${assigned.join(',')} are absent from the graph's units`,
    );
  return parsed;
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
