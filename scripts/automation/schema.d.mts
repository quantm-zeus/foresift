// Type declarations for the pure control-plane state model (schema.mjs).
export interface RoadmapPolicy {
  foundationMilestones: string[];
  maxParallelCodingPackagesFoundation: number;
  maxParallelCodingPackages: number;
  serialWhenRisk?: string[];
}

export interface RoadmapMilestone {
  id: string;
  name: string;
  dependsOn?: string[];
  status: string;
}

export interface Roadmap {
  schemaVersion: string;
  policy: RoadmapPolicy;
  currentMilestoneId: string | null;
  milestones: RoadmapMilestone[];
}

export interface WorkPackage {
  id: string;
  objective: string;
  requirementIds: string[];
  dependencies?: string[];
  risk: string;
  parallelizable: boolean;
  writeScopes: string[];
  verificationCommands: string[];
  status: string;
  generation?: number;
}

export interface MilestoneState {
  schemaVersion: string;
  milestoneId: string;
  status: string;
  packages: WorkPackage[];
  plannedAt?: string;
}

export declare const PACKAGE_STATUSES: string[];
export declare const MILESTONE_STATUSES: string[];
export declare const RISKS: string[];
export declare const ALLOWED_STATUS_TRANSITIONS: Set<string>;
export declare function serializeMilestoneState(ms: MilestoneState): string;
export declare function repoRoot(): string;
export declare function implementationDir(root?: string): string;
export declare function loadJson(path: string): unknown;
export declare function loadRoadmap(root?: string): Roadmap;
export declare function loadCurrentMilestone(root?: string): MilestoneState | null;
export declare function validateRoadmap(rm: Roadmap): string[];
export declare function validateMilestoneState(ms: MilestoneState): string[];
export declare function classifyFailure(
  message?: string,
): 'TRANSIENT' | 'QUOTA_DAILY' | 'FATAL' | 'UNKNOWN';
/** Best-effort provider quota reset-time extraction from a failure message; null when absent. */
export declare function extractQuotaResetAt(message?: string): number | null;
export declare function findPackage(ms: MilestoneState, packageId: string): WorkPackage | null;
export declare function packageEligible(
  ms: MilestoneState,
  pkg: WorkPackage | null,
): { eligible: boolean; reason: string };
export declare const CAN_START_REASON_CLASSES: Readonly<{
  DEPENDENCY_BLOCK: 'DEPENDENCY_BLOCK';
  CRITICAL_SERIAL: 'CRITICAL_SERIAL';
  GLOBAL_SURFACE_SERIAL: 'GLOBAL_SURFACE_SERIAL';
  PARALLEL_POLICY_BLOCK: 'PARALLEL_POLICY_BLOCK';
  WRITE_SCOPE_CONFLICT: 'WRITE_SCOPE_CONFLICT';
  UNKNOWN_WRITE_TRUTH: 'UNKNOWN_WRITE_TRUTH';
}>;
export declare function canStartPackage(
  roadmap: Roadmap,
  ms: MilestoneState,
  candidate: WorkPackage,
  runningPackages: WorkPackage[],
): { ok: boolean; reason: string; reasonClass?: string };
