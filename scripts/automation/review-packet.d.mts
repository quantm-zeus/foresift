export declare const REVIEW_PACKET_SCHEMA: 'foresift/review-packet@1';
export declare const REVIEW_PACKET_FILE: 'review-packet.json';
export declare const REVIEW_PACKET_MD_FILE: 'review-packet.md';
export declare const PERMANENT_BOUNDARIES: string;

export declare interface ReviewPacket {
  schema: string;
  packageId: string;
  risk: string | null;
  writeScopes: string[];
  profile?: string;
  objective?: string | null;
  requirementIds?: string[];
  acceptanceIds?: string[];
  prdReferences?: unknown[];
  adrReferences?: unknown[];
  specKitArtifacts?: string[];
  firstUnfinishedTask?: { line: number; text: string } | null;
  baseRef: string | null;
  baseSource: string;
  reviewedHeadSha: string | null;
  headTreeHash: string | null;
  diffIdentity: string | null;
  filesChanged: Array<{ path: string; status: string }>;
  testsAddedOrChanged: string[];
  fullGateEvidence: { present: boolean; passed?: boolean; failedCategories?: string[] } | null;
  attestationEvidence: { present: boolean; result?: string | null; headSha?: string | null };
  outOfScopeNotes: string | null;
  permanentBoundaries: string;
  knownUnresolvedIssues: string[];
  checkpointRef: Record<string, unknown>;
  valid: boolean;
  reasons: string[];
}

export declare function buildReviewPacket(opts: {
  packageId: string;
  repoRoot: string;
  artifactsDir: string;
}): ReviewPacket;

/** Accepts unknown input by design: untrusted packets must fail closed, not throw. */
export declare function validateReviewPacket(
  packet: unknown,
  opts?: { expectedHead?: string },
): { valid: boolean; reasons: string[] };

export declare interface ReviewFinding {
  severity: string;
  category: string;
  file: string;
  line: number;
  requirementId: string;
  finding: string;
  requiredFix: boolean;
}

export declare function aggregateFindings(findings: ReviewFinding[]): {
  aggregated: Array<ReviewFinding & { occurrences: number }>;
  exactDuplicatesMerged: number;
};

/** V3-C §12: byte-deterministic markdown twin so reviewers consume the packet. */
export declare function renderReviewPacketMarkdown(packet: ReviewPacket): string;
