export interface RequirementManifest {
  readonly schemaVersion: string;
  readonly document: Record<string, unknown>;
  readonly requirements: readonly RequirementItem[];
  readonly acceptanceCriteria: readonly AcceptanceItem[];
  readonly invariants: readonly ManifestItem[];
  readonly adrs: readonly ManifestItem[];
  readonly dependencyGroups: readonly DependencyGroup[];
  readonly releaseConformance: Record<string, unknown>;
}
export interface ManifestItem {
  readonly id: string;
  readonly line?: number;
  readonly text?: string;
  readonly textSha256?: string;
  readonly [key: string]: unknown;
}
export interface RequirementItem extends ManifestItem {
  readonly family: string;
  readonly dependencyGroup: string;
  readonly owner: string;
  readonly status: string;
  readonly acceptanceCriteria: readonly string[];
  readonly implementationRefs: readonly string[];
  readonly testRefs: readonly string[];
  readonly schemaRefs: readonly string[];
  readonly persistenceRefs: readonly string[];
  readonly apiToolUiRefs: readonly string[];
  readonly telemetryRefs: readonly string[];
  readonly fixtureRefs: readonly string[];
}
export interface AcceptanceItem extends ManifestItem {
  readonly requirementRefs: readonly string[];
}
export interface DependencyGroup {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly dependencies?: readonly string[];
}
