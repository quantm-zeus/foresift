import type { UtcTimestamp } from './timestamps.ts';

export const ProviderConflictClassification = {
  BENIGN_LATENCY_OR_ROUNDING: 'BENIGN_LATENCY_OR_ROUNDING',
  COMMON_UPSTREAM_DUPLICATION: 'COMMON_UPSTREAM_DUPLICATION',
  MATERIAL_DISAGREEMENT: 'MATERIAL_DISAGREEMENT',
  UNRESOLVED_DECISION_CRITICAL: 'UNRESOLVED_DECISION_CRITICAL',
} as const;
export type ProviderConflictClassification =
  (typeof ProviderConflictClassification)[keyof typeof ProviderConflictClassification];

export interface ProviderConflict {
  readonly conflictId: string;
  readonly observationIds: readonly string[];
  readonly classification: ProviderConflictClassification;
  readonly decisionCritical: boolean;
  readonly rationale: string;
  readonly classifiedAt: UtcTimestamp;
  readonly classifierVersion: string;
}
