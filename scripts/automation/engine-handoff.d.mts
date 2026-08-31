export declare function isQuotaHandoffReason(reason: string | null | undefined): boolean;
export declare function isTransientContentionReason(reason: string | null | undefined): boolean;
export declare function persistHandoffRecord(
  resultDir: string,
  record: Record<string, unknown>,
): void;
export declare function executeHandoffToClaude(input: {
  stateDir: string;
  holder: string;
  packageId: string;
  generation: number;
  laneId: string;
  runId?: string | null;
  resultDir: string;
  releaseCodex?: boolean;
  taskIds: string[];
  taskGraphPath?: string | null;
  worktree: string;
  executeWithClaude: () => unknown;
}): unknown;
export declare function handoffCompletionClaims(input: {
  taskIds: string[];
  changed: string[];
  taskGraphPath?: string | null;
  blockers?: Array<string | { taskId: string }>;
}): {
  nominated: string[];
  deferred: Array<{ taskId: string; reason: string }>;
};
