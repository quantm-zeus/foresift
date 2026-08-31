export declare function taskEvidence(
  taskId: string,
  unitsById: Map<string, Record<string, unknown>>,
  changedFiles: string[],
): { evidencable: boolean; evidence?: string[]; reason: string | null };
export declare function nominateCompletedUnits(input: {
  assignedTaskIds: string[];
  unitsById: Map<string, Record<string, unknown>>;
  changedFiles: string[];
  blockers?: Array<string | { taskId: string }>;
}): {
  nominated: string[];
  deferred: Array<{ taskId: string; reason: string }>;
};
export declare function validateLaneNominations(input: {
  laneTaskIds: string[];
  unitsById: Map<string, Record<string, unknown>>;
  changedFiles: string[];
  nominatedTaskIds: string[];
  blockers?: Array<string | { taskId: string }>;
}): {
  accepted: string[];
  rejected: Array<{ taskId: string; reason: string }>;
};
export declare function unitsIndexFromGraph(
  graph: { units?: Array<{ id: string; [k: string]: unknown }> } | null | undefined,
): Map<string, Record<string, unknown>>;
