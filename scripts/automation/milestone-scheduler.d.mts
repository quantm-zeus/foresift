export declare function longestDownstreamPath(
  ms: { packages?: Array<{ id: string; dependencies?: string[] }> },
  pkgId: string,
  memo?: Map<string, number>,
): number;

export declare function unlockedDownstreamCount(
  ms: { packages?: Array<{ id: string; status?: string; dependencies?: string[] }> },
  pkgId: string,
): number;

export declare function criticalPathScore(
  ms: { packages?: Array<{ id: string; risk?: string; dependencies?: string[] }> },
  pkg: { id: string; risk?: string },
): {
  longestDownstreamPath: number;
  unlockedDownstreamCount: number;
  riskRank: number;
  id: string;
};

export declare function selectNextPackage(
  canStart: (candidate: unknown, runningPackages: unknown[]) => { ok: boolean; reason: string },
  ms: unknown,
  runningPackages?: unknown[],
): {
  selected: { id: string; score: Record<string, unknown> } | null;
  ranked: Array<{ id: string; score: Record<string, unknown>; startable: boolean; reason: string }>;
};

/** Critical-path-ordered PENDING candidates (order fixed once per tick). */
export declare function rankPendingPackages(ms: {
  packages?: Array<{ id: string; status?: string; risk?: string; dependencies?: string[] }>;
}): Array<{ id: string; status?: string; risk?: string; dependencies?: string[] }>;
