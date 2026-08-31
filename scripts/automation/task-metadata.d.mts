export declare const TASK_EXECUTORS: readonly string[];
export declare const TASK_KINDS: readonly string[];
export declare function parseTaskMetadata(taskLine: string): {
  executor: string | null;
  kind: string | null;
  raw: string;
};
export declare function resolveTaskMetadata(taskLine: string): {
  executor: 'PRODUCT' | 'TEST' | 'COORDINATOR';
  kind: string;
};
export declare function isCoordinatorTask(unit: { executor?: string } | null | undefined): boolean;
