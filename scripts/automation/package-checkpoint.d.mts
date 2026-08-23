export declare const CHECKPOINT_FILE: 'implementation-checkpoint.json';
export declare const CHECKPOINT_SCHEMA: 'foresift/implementation-checkpoint@2';

export interface TaskCounters {
  completed: number;
  total: number;
  remaining: number;
}

export interface UncheckedTask {
  line: number;
  text: string;
}

export interface CheckpointSlice {
  id?: string | null;
  description?: string | null;
  taskIds?: string[];
  nextTaskId?: string | null;
}

export interface CheckpointCapsule {
  profile: 'LEGACY' | 'OPTIMIZED';
  risk: string | null;
  objective: string | null;
  writeScopes: string[];
  requirementIds: string[];
  acceptanceIds: string[];
  prdReferences: Array<{
    requirementId: string;
    section: string | null;
    subsection: string | null;
    line: number | null;
  }>;
  adrReferences: Array<{ id: string; title?: string | null; section?: string | null }>;
  specKitArtifacts: string[];
  firstUnfinishedTask: UncheckedTask | null;
  suggestedNextTasks: UncheckedTask[];
  affectedTestRefs: string[];
  previousFast: {
    schema: string | null;
    escalatedToFullSuite: boolean;
    failed: boolean;
    timestamp: string | null;
  } | null;
}

export interface CheckpointRecord {
  schema: typeof CHECKPOINT_SCHEMA;
  packageId: string;
  headSha: string;
  sliceBaseSha: string | null;
  completedTasks: number;
  totalTasks: number;
  remainingTasks: number;
  slice: Required<Pick<CheckpointSlice, 'id' | 'description' | 'taskIds' | 'nextTaskId'>>;
  filesTouched: string[];
  targetedChecks: Array<{ command: string; result: string }>;
  context: CheckpointCapsule | null;
  sourceHashes: Record<string, { path: string; sha256: string | null }>;
  blocker: string | null;
  timestamp: string;
}

export interface BuildCheckpointInput {
  packageId: string;
  headSha: string;
  sliceBaseSha?: string | null;
  tasks: TaskCounters;
  slice: CheckpointSlice;
  filesTouched?: string[];
  targetedChecks?: Array<{ command: string; result: string }>;
  context?: CheckpointCapsule | null;
  sources?: Record<string, string>;
  blocker?: string | null;
}

export interface DeriveCapsuleInput {
  repoRoot: string;
  packageId: string;
  artifactsDir?: string | null;
}

export declare function sha256File(path: string): string | null;
export declare function parseTasksMd(text: string): TaskCounters;
export declare function uncheckedTasks(text: string): UncheckedTask[];
export declare function deriveCapsule(input: DeriveCapsuleInput): CheckpointCapsule;
export declare function buildCheckpoint(input: BuildCheckpointInput): CheckpointRecord;
export declare function validateCheckpoint(
  cp: unknown,
  expected?: { packageId?: string; headSha?: string },
): { valid: boolean; reasons: string[] };
