export declare const NOOP_EVIDENCE: string;
export declare function readTaskBlock(
  tasksText: string,
  taskId: string,
): { found: boolean; done: boolean; blockText: string };
export declare function reconcileNoopWave(opts: {
  packageId: string;
  graph: {
    shards?: Array<{ id: string; mode?: string; units?: string[] }>;
    testLanes?: Array<{ id: string; mode?: string; units?: string[] }>;
  };
  resultsDir: string;
  canonical: string;
}): {
  ok: boolean;
  report: {
    schema: string;
    package: string;
    dispatched: number;
    reconciledLanes: Array<{
      shardId: string;
      units: string[];
      diffFiles: number;
      uniqueDiffs: number;
    }>;
    failedLanes: Array<{ shardId?: string; file?: string; reason: string }>;
    reconciled: boolean;
  };
  reason?: string;
};
