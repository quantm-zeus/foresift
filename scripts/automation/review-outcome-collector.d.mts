export const REVIEW_VERDICT_SCHEMA: 'foresift/review-verdict@1';
export const REVIEW_VERDICT_FILE: 'review-verdict.json';

export interface ReviewVerdict {
  schema: 'foresift/review-verdict@1';
  valid: boolean;
  prNumber: number | null;
  prUrl: string | null;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  unresolvedThreads: number | null;
  headAtReviewStart: string | null;
  headAfterReview: string | null;
  collectedAt: string;
  reasons: string[];
}

export function collectReviewOutcome(opts: {
  artifactsDir: string;
  repoRoot: string;
}): ReviewVerdict;
