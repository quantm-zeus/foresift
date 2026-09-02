// Shared writer-side task-evidence plumbing (Hyperdrive H3, P0-1).
export declare function parseTaskGraph(graphPath: string): {
  graph: Record<string, unknown>;
  unitsById: Map<string, Record<string, unknown>>;
} | null;
export declare function claimCompletedUnits(input: {
  taskIds: string[];
  changed: string[];
  unitsById: Map<string, Record<string, unknown>> | null;
  blockers?: Array<string | { taskId: string }>;
}): {
  nominated: string[];
  deferred: Array<{ taskId: string; reason: string }>;
};
export declare function requireTaskGraphForCompletionEvidence(input: {
  graphPath: string | undefined | null;
  taskIds: Array<string | undefined | null>;
  engine: string;
  lane: string;
}): {
  graph: Record<string, unknown>;
  unitsById: Map<string, Record<string, unknown>>;
};
/**
 * Lane evidence diff = committed base..HEAD paths ∪ uncommitted status paths
 * (repo-relative). A clean tree after agent-side commits still yields the
 * commit diff; a failed `before`/HEAD probe falls back to status-only.
 */
export declare function laneEvidencePaths(input: {
  worktree: string;
  before?: string | null;
}): string[];
