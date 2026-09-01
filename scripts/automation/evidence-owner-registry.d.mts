export declare const evidenceOwnerRegistry: Readonly<Record<string, string>>;
export declare function assertEvidenceOwnership(
  graph: {
    units?: Array<{ id: string; done: boolean; evidence?: string | null; executor?: string }>;
  } | null,
  opts?: { evidenceKinds?: string[] },
): { ok: boolean; checked: number };
export declare function verificationCommandsFor(
  packageId: string,
  root: string,
): { commands: string[]; reason: string | null };
export declare function completeNonFileEvidence(
  unit: { id: string; evidence?: string | null; executor?: string; done: boolean } | null,
  ctx: { packageId: string; root: string; reason?: string },
): {
  taskId: string | null;
  evidenceKind: string;
  owner: string | null;
  completed: boolean;
  proof: string | null;
  atHead: string;
};
export declare function assertTraceabilityMatrixClosed(
  packageId: string,
  root: string,
): { ok: boolean; reason: string };
