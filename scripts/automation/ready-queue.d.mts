// Global ready queue + work stealing (Hyperdrive H3, P1-7). One ordered
// candidate stream per tick with exact predicted-write co-run gating; unknown
// truth degrades to broad writeScopes. stealNext is the re-enterable pop loop
// capacity events call back into.

export declare const READY_QUEUE_SCHEMA: string;

export declare function buildReadyQueue(
  orderedCandidates: Array<string | { id: string }>,
  preflight?: (packageId: string, rootDir?: string) => unknown,
): {
  schema: string;
  entries: Array<{ packageId: string; preflight: unknown }>;
  byId: Map<string, { packageId: string; preflight: unknown }>;
};

export declare function exactCoRunGate(
  candidatePreflight: { exact: boolean; predictedWrites: string[]; packageId?: string },
  runningPreflights: Array<{
    packageId: string;
    exact: boolean;
    predictedWrites: string[];
  }>,
): { ok: boolean; reason: string };

export declare function stealNext<T>(
  queue: { entries: Array<{ packageId: string; preflight: unknown }> },
  admit: (
    entry: { packageId: string; preflight: unknown },
    preflight: unknown,
  ) => T | null | undefined | false,
): T | null;
