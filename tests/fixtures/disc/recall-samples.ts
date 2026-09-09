/**
 * Recall claim-basis vectors and retrospective classification samples covering:
 * - independent first-party observation
 * - independent provider lineage
 * - valid known inclusion probabilities
 * - shared-lineage trap (refusal of independent claim)
 * - self-recall trap (refusal of self-generated universe recall)
 * - no-basis trap (refusal of claims without sound basis)
 * - NOT_DISCOVERED classification samples extending retrospective fixture set.
 *
 * Traces: FR-DISC-006, FR-DISC-007, FR-DISC-010, FR-DISC-012.
 */
import type { UtcTimestamp } from '@foresift/domain';

export type RecallClaimBasisType =
  | 'INDEPENDENT_FIRST_PARTY'
  | 'INDEPENDENT_LINEAGE'
  | 'VALID_INCLUSION_PROBABILITIES'
  | 'SHARED_LINEAGE_TRAP'
  | 'SELF_RECALL_TRAP'
  | 'NO_BASIS_TRAP';

export type RecallVerdict =
  | 'VALID_INDEPENDENT_RECALL'
  | 'DEPENDENT_LINEAGE_DISCLOSED'
  | 'SELF_RECALL_REFUSED'
  | 'NO_BASIS_REFUSED';

export interface RecallSampleVector {
  readonly sampleId: string;
  readonly assetRepresentationId: string;
  readonly evaluatedSourceId: string;
  readonly universeSourceId: string;
  readonly claimBasis: RecallClaimBasisType;
  readonly inclusionProbability?: number;
  readonly sharedLineageWithEvaluated: boolean;
  readonly selfGeneratedUniverse: boolean;
  readonly discoveredByEvaluatedSource: boolean;
  readonly groundTruthExists: boolean;
  readonly outcomeProfileMet: boolean;
  readonly expectedVerdict: RecallVerdict;
  readonly expectedClassification:
    | 'DISCOVERED'
    | 'NOT_DISCOVERED'
    | 'INELIGIBLE'
    | 'LINEAGE_DEPENDENT'
    | 'SELF_RECALL_REFUSED'
    | 'NO_BASIS_REFUSED';
  readonly sampleTimestamp: UtcTimestamp;
}

export const RECALL_VECTOR_INDEPENDENT_FIRST_PARTY: RecallSampleVector = {
  sampleId: 'recall_vec_001_first_party',
  assetRepresentationId: 'asset_rep_sol_missed_gem_001',
  evaluatedSourceId: 'src_gmgn_free_aggregate',
  universeSourceId: 'col_solana_pump_live',
  claimBasis: 'INDEPENDENT_FIRST_PARTY',
  inclusionProbability: 1.0,
  sharedLineageWithEvaluated: false,
  selfGeneratedUniverse: false,
  discoveredByEvaluatedSource: false,
  groundTruthExists: true,
  outcomeProfileMet: true,
  expectedVerdict: 'VALID_INDEPENDENT_RECALL',
  expectedClassification: 'NOT_DISCOVERED',
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const RECALL_VECTOR_INDEPENDENT_LINEAGE: RecallSampleVector = {
  sampleId: 'recall_vec_002_indep_lineage',
  assetRepresentationId: 'asset_rep_sol_missed_gem_002',
  evaluatedSourceId: 'src_gmgn_free_aggregate',
  universeSourceId: 'src_solana_archive_node_direct',
  claimBasis: 'INDEPENDENT_LINEAGE',
  inclusionProbability: 1.0,
  sharedLineageWithEvaluated: false,
  selfGeneratedUniverse: false,
  discoveredByEvaluatedSource: false,
  groundTruthExists: true,
  outcomeProfileMet: true,
  expectedVerdict: 'VALID_INDEPENDENT_RECALL',
  expectedClassification: 'NOT_DISCOVERED',
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const RECALL_VECTOR_VALID_INCLUSION_PROBABILITIES: RecallSampleVector = {
  sampleId: 'recall_vec_003_inclusion_prob',
  assetRepresentationId: 'asset_rep_sol_token_003',
  evaluatedSourceId: 'col_solana_pump_live',
  universeSourceId: 'src_stratified_universe_sample_v1',
  claimBasis: 'VALID_INCLUSION_PROBABILITIES',
  inclusionProbability: 0.05,
  sharedLineageWithEvaluated: false,
  selfGeneratedUniverse: false,
  discoveredByEvaluatedSource: true,
  groundTruthExists: true,
  outcomeProfileMet: true,
  expectedVerdict: 'VALID_INDEPENDENT_RECALL',
  expectedClassification: 'DISCOVERED',
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const RECALL_VECTOR_SHARED_LINEAGE_TRAP: RecallSampleVector = {
  sampleId: 'recall_vec_004_shared_lineage_trap',
  assetRepresentationId: 'asset_rep_sol_shared_lineage_002',
  evaluatedSourceId: 'src_gmgn_free_aggregate',
  universeSourceId: 'src_gmgn_archive_dump',
  claimBasis: 'SHARED_LINEAGE_TRAP',
  inclusionProbability: 1.0,
  sharedLineageWithEvaluated: true,
  selfGeneratedUniverse: false,
  discoveredByEvaluatedSource: false,
  groundTruthExists: true,
  outcomeProfileMet: true,
  expectedVerdict: 'DEPENDENT_LINEAGE_DISCLOSED',
  expectedClassification: 'LINEAGE_DEPENDENT',
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const RECALL_VECTOR_SELF_RECALL_TRAP: RecallSampleVector = {
  sampleId: 'recall_vec_005_self_recall_trap',
  assetRepresentationId: 'asset_rep_sol_pump_token_001',
  evaluatedSourceId: 'src_gmgn_free_aggregate',
  universeSourceId: 'src_gmgn_free_aggregate',
  claimBasis: 'SELF_RECALL_TRAP',
  inclusionProbability: 1.0,
  sharedLineageWithEvaluated: true,
  selfGeneratedUniverse: true,
  discoveredByEvaluatedSource: true,
  groundTruthExists: true,
  outcomeProfileMet: true,
  expectedVerdict: 'SELF_RECALL_REFUSED',
  expectedClassification: 'SELF_RECALL_REFUSED',
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const RECALL_VECTOR_NO_BASIS_TRAP: RecallSampleVector = {
  sampleId: 'recall_vec_006_no_basis_trap',
  assetRepresentationId: 'asset_rep_sol_unknown_token_006',
  evaluatedSourceId: 'src_gmgn_free_aggregate',
  universeSourceId: 'unknown_unverified_universe',
  claimBasis: 'NO_BASIS_TRAP',
  inclusionProbability: undefined,
  sharedLineageWithEvaluated: false,
  selfGeneratedUniverse: false,
  discoveredByEvaluatedSource: false,
  groundTruthExists: false,
  outcomeProfileMet: false,
  expectedVerdict: 'NO_BASIS_REFUSED',
  expectedClassification: 'NO_BASIS_REFUSED',
  sampleTimestamp: '2026-08-20T12:00:00.000Z' as UtcTimestamp,
};

export const EXTENDED_RETROSPECTIVE_SAMPLES: readonly RecallSampleVector[] = [
  RECALL_VECTOR_INDEPENDENT_FIRST_PARTY,
  RECALL_VECTOR_INDEPENDENT_LINEAGE,
  RECALL_VECTOR_VALID_INCLUSION_PROBABILITIES,
  RECALL_VECTOR_SHARED_LINEAGE_TRAP,
  RECALL_VECTOR_SELF_RECALL_TRAP,
  RECALL_VECTOR_NO_BASIS_TRAP,
];
