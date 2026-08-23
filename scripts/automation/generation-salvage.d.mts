// Type declarations for generation salvage (override §§4–13, generation-salvage.mjs).

export declare const SALVAGE_MANIFEST_SCHEMA: 'foresift/salvage-manifest@1';
export declare const CONTROL_PLANE_PREFIXES: string[];
export declare const PRODUCT_PREFIXES: string[];
export declare const ROOT_MANIFEST_FILES: Set<string>;

export type SalvageClassification =
  'REUSE_AS_IS' | 'REUSE_WITH_RECONCILIATION' | 'OBSOLETE_CONTROL_PLANE' | 'UNKNOWN' | 'EMPTY';

export interface SalvageFileEntry {
  path: string;
  status: string;
  classification: SalvageClassification;
}

export interface SalvageCommitEntry {
  sha: string;
  subject: string;
  filesTouched: number;
  classification: SalvageClassification;
}

export interface SalvageManifest {
  schema: typeof SALVAGE_MANIFEST_SCHEMA;
  packageId: string;
  sourceSalvagePr: number | null;
  sourceSalvageBranch: string;
  sourceSalvageHead: string;
  finalV3BaseHead: string;
  mergeBase: string;
  files: SalvageFileEntry[];
  commits: SalvageCommitEntry[];
  summary: {
    filesTotal: number;
    reuseAsIs: number;
    reuseWithReconciliation: number;
    obsoleteControlPlane: number;
    unknown: number;
    commitsTotal: number;
    commitsFullyProduct: number;
    commitsMixed: number;
    commitsControlPlaneOnly: number;
  };
}

export declare function classifyPath(path: string, pkgId: string): SalvageClassification;

export declare function buildSalvageInventory(args: {
  repoRoot: string;
  pkgId: string;
  salvageRef: string;
  baseRef: string;
  sourceSalvagePr?: number;
}): SalvageManifest;

export declare function reconcileJsonManifest(
  currentText: string,
  salvageText: string,
): string | null;

export declare function reconcileWorkspaceYaml(
  currentText: string,
  salvageText: string,
): string | null;

export declare function planAdrRenames(
  files: Array<{ path: string; status?: string }>,
  baseFileSet: Set<string>,
): Record<string, string>;

export interface TaskReconstruction {
  content: string;
  reused: number;
  reopened: number;
  remaining: number;
  details: Array<{
    task: string;
    verdict: 'REUSED' | 'REOPENED';
    acs: string[];
    why?: string;
  }>;
}

export declare function reconstructTasks(
  tasksMd: string,
  salvagedFiles: string[],
): TaskReconstruction;

export interface ApplySalvageResult {
  appliedHead: string;
  renames: Record<string, string>;
  manifestReconciliation: Array<{ file: string; decision: string }>;
  taskReconstruction: Omit<TaskReconstruction, 'content'> | null;
  install: { ran: boolean; mode: string; ok?: boolean; tail?: string };
}

export declare function applySalvage(args: {
  repoRoot: string;
  manifest: Pick<SalvageManifest, 'sourceSalvageHead' | 'files' | 'packageId'> & {
    sourceSalvagePr?: number | null;
    sourceSalvageBranch?: string;
  };
  genBranch: string;
  baseRef: string;
  allowUnknown?: boolean;
  installMode?: 'lockfile-only' | 'full' | 'none';
}): ApplySalvageResult;
