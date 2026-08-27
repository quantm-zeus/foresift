// classify-ci-diff.d.mts — Type declarations for semantic CI classifier.

export declare const ALLOWED_STATUS_TRANSITIONS: Set<string>;

export function compareMilestoneJsonSemantic(
  before: unknown,
  after: unknown,
): { ok: boolean; changes?: unknown[]; reason?: string };

export function classifyCiDiff(opts?: { repoDir?: string; baseSha?: string; headSha?: string }): {
  mode: 'STATE_ONLY' | 'FULL';
  changedFiles: string[];
  semanticChanges?: unknown[];
  reason: string;
};
