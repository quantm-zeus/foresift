// Zero-AI launch preflight (Hyperdrive H3, P1-6). Derives per-package exact
// write truth from the deterministic task graph so co-run scheduling can
// upgrade from broad writeScopes overlap to exact predicted-write
// disjointness; unknown truth degrades conservatively (exact:false).

export declare const PREFLIGHT_SCHEMA: string;
export declare function buildLaunchPreflight(
  packageId: string,
  rootDir?: string,
): {
  schema: string;
  packageId: string;
  exact: boolean;
  predictedWrites: string[];
  productWrites: string[];
  testWrites: string[];
  sharedSurfaces: string[];
  migrationDuties: string[];
  openTaskCount: number;
  readyTaskCount: number;
  parallelizableReadyCount: number;
  shardNeed: number | null;
  reason: string | null;
};
export declare function exactCoRunCompatible(
  a: { exact: boolean; predictedWrites: string[] } | null | undefined,
  b: { exact: boolean; predictedWrites: string[] } | null | undefined,
): { compatible: boolean | null; reason: string };
