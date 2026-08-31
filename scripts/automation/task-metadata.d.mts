export declare const TASK_EXECUTORS: readonly string[];
export declare const TASK_KINDS: readonly string[];
export declare const TASK_EVIDENCE_KINDS: readonly string[];
export declare function parseTaskMetadata(taskLine: string): {
  executor: string | null;
  kind: string | null;
  evidence: string | null;
  raw: string;
};
export declare function resolveTaskMetadata(taskLine: string): {
  executor: 'PRODUCT' | 'TEST' | 'COORDINATOR';
  kind: string;
  evidence: string;
};
export declare function isCoordinatorTask(unit: { executor?: string } | null | undefined): boolean;
