// classify-ci-diff.d.mts — Type declarations for semantic CI classifier.

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
