export declare const evidenceOwnerRegistry: Readonly<Record<string, string>>;
export declare const VERIFICATION_PROFILES: Readonly<Record<string, readonly string[]>>;
export declare function verificationProfileFor(unit: { body?: string } | null): string | null;
export declare function assertEvidenceOwnership(
  graph: {
    units?: Array<{ id: string; done: boolean; evidence?: string | null; executor?: string }>;
  } | null,
  opts?: { evidenceKinds?: string[] },
): { ok: boolean; checked: number };
export declare function verificationCommandsFor(
  unit: { body?: string } | null,
  packageId: string,
  root: string,
): {
  commands: string[];
  reason: string | null;
  profile: string | null;
  profileSource: string;
};
export declare function completeNonFileEvidence(
  unit: {
    id: string;
    evidence?: string | null;
    executor?: string;
    done: boolean;
    body?: string;
  } | null,
  ctx: { packageId: string; root: string; reason?: string; taskIds?: string[]; dryRun?: boolean },
): {
  taskId: string | null;
  evidenceKind: string;
  owner: string | null;
  completed: boolean;
  committed?: boolean;
  proof: string | null;
  atHead: string;
  profile?: string | null;
  profileSource?: string;
  commandOutcomes?: Array<{ command: string; exitCode: number | null }>;
};
export declare function assertTraceabilityMatrixClosed(
  packageId: string,
  root: string,
  opts?: { taskIds?: string[] },
): { ok: boolean; reason: string };
export declare function fileEvidenceAlreadySatisfied(
  unit: {
    id: string;
    predictedWrites?: string[];
    testWrites?: string[];
  } | null,
  ctx: { root: string },
): {
  satisfied: boolean;
  reason: string;
  proof?: Array<{ path: string; authoringCommit: string }>;
};
