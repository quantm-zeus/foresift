export interface Requirement {
  readonly id: string;
  readonly text: string;
  readonly textSha256: string;
  readonly line: number;
  readonly family: string;
  readonly dependencyGroup: string;
  readonly owner: string;
  readonly status: string;
  readonly acceptanceCriteria: readonly string[];
  readonly implementationRefs: readonly string[];
  readonly schemaRefs: readonly string[];
  readonly persistenceRefs: readonly string[];
  readonly apiToolUiRefs: readonly string[];
  readonly testRefs: readonly string[];
  readonly fixtureRefs: readonly string[];
  readonly telemetryRefs: readonly string[];
  readonly securityRightsCostControls: readonly string[];
  readonly activationGateRefs: readonly string[];
  readonly rollbackRefs: readonly string[];
  readonly supersedes: readonly string[];
  readonly supersededBy: readonly string[];
  readonly [key: string]: unknown;
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly text: string;
  readonly textSha256: string;
  readonly line: number;
  readonly requirementRefs: readonly string[];
  readonly evidenceOwner: string;
  readonly status: string;
  readonly positiveTestRef: string;
  readonly negativeOrFailureTestRef: string;
  readonly [key: string]: unknown;
}

export interface Invariant {
  readonly id: string;
  readonly text: string;
  readonly textSha256: string;
  readonly line: number;
  readonly testRef: string;
  readonly status: string;
  readonly [key: string]: unknown;
}

export interface Adr {
  readonly id: string;
  readonly title: string;
  readonly decision: string;
  readonly textSha256: string;
  readonly line: number;
  readonly status: string;
  readonly supersedes: readonly string[];
  readonly [key: string]: unknown;
}

export interface DependencyGroup {
  readonly id: string;
  readonly name: string;
  readonly dependsOn: readonly string[];
}

export interface RequirementManifest {
  readonly schemaVersion: string;
  readonly document: Readonly<Record<string, unknown>> & {
    readonly sourcePath: string;
    readonly normalizedSha256: string;
  };
  readonly requirements: readonly Requirement[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly invariants: readonly Invariant[];
  readonly adrs: readonly Adr[];
  readonly dependencyGroups: readonly DependencyGroup[];
  readonly releaseConformance: Readonly<Record<string, unknown>>;
}

export interface ManifestAudit {
  readonly hashes: Readonly<Record<string, string>>;
  readonly inventory: Readonly<Record<string, number>>;
  readonly manifest: Readonly<Record<string, number | string>>;
  readonly [key: string]: unknown;
}

export interface LoadedManifest {
  readonly rootDir: string;
  readonly specDir: string;
  readonly manifestPath: string;
  readonly auditPath: string;
  readonly documentPath: string;
  readonly checksumsPath: string;
  readonly manifest: RequirementManifest;
  readonly audit: ManifestAudit;
  readonly documentText: string;
  readonly checksumsText: string;
}
