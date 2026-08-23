import type { ReviewVerdict } from './review-outcome-collector.mjs';

export const DECISION_NOT_REQUIRED: 'CONVERGENCE_NOT_REQUIRED';
export const DECISION_REQUIRED: 'CONVERGENCE_REQUIRED';
export const DECISION_SCHEMA: 'foresift/convergence-decision@1';

export interface ConvergenceDecision {
  schema: 'foresift/convergence-decision@1';
  decision: 'CONVERGENCE_NOT_REQUIRED' | 'CONVERGENCE_REQUIRED';
  currentHead: string | null;
  reasons: string[];
  decidedAt: string;
}

export function parseReviewVerdict(raw: unknown): ReviewVerdict | null;

export function decideConvergence(opts: {
  currentHead: string | null;
  verdict: {
    valid?: unknown;
    reviewDecision?: unknown;
    unresolvedThreads?: unknown;
    headAtReviewStart?: unknown;
    headAfterReview?: unknown;
  } | null;
  attestation: { present: boolean; drift: string[] | null } | null;
  completeness: { complete?: unknown } | null;
}): ConvergenceDecision;
