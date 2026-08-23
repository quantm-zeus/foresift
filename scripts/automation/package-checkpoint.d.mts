export declare const CHECKPOINT_FILE: 'implementation-checkpoint.json';

export interface TaskCounters {
  completed: number;
  total: number;
  remaining: number;
}

export interface CheckpointSlice {
  id?: string | null;
  description?: string | null;
  taskIds?: string[];
  nextTaskId?: string | null;
}

export interface CheckpointRecord {
  schema: 'foresift/implementation-checkpoint@1';
  packageId: string;
  headSha: string;
  completedTasks: number;
  totalTasks: number;
  remainingTasks: number;
  slice: Required<Pick<CheckpointSlice, 'id' | 'description' | 'taskIds' | 'nextTaskId'>>;
  requirementIds: string[];
  acceptanceIds: string[];
  filesTouched: string[];
  targetedChecks: Array<{ command: string; result: string }>;
  sourceHashes: Record<string, { path: string; sha256: string | null }>;
  prdReferences: string[];
  adrReferences: string[];
  blocker: string | null;
  timestamp: string;
}

export interface BuildCheckpointInput {
  packageId: string;
  headSha: string;
  tasks: TaskCounters;
  slice: CheckpointSlice;
  requirementIds?: string[];
  acceptanceIds?: string[];
  filesTouched?: string[];
  targetedChecks?: Array<{ command: string; result: string }>;
  sources?: Record<string, string>;
  prdReferences?: string[];
  adrReferences?: string[];
  blocker?: string | null;
}

export declare function sha256File(path: string): string | null;
export declare function parseTasksMd(text: string): TaskCounters;
export declare function buildCheckpoint(input: BuildCheckpointInput): CheckpointRecord;
export declare function validateCheckpoint(
  cp: unknown,
  expected?: { packageId?: string; headSha?: string },
): { valid: boolean; reasons: string[] };
