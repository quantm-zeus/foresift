/**
 * Recall claim-basis vectors and retrospective classification samples (§63.9, FR-DISC-006, FR-DISC-010).
 * Covers independent first-party, independent lineage, valid inclusion probabilities,
 * shared-lineage trap, self-recall trap, no-basis trap, and retrospective classification samples.
 * Traces: FR-DISC-006, FR-DISC-010.
 */
import type { UtcTimestamp } from '@foresift/domain';
import type {
  RecallEstimateInput,
  RecallObservation,
  RecallDependenceEdge,
  RecallEstimateResult,
} from '../../../packages/discovery-universe/src/recall-estimator.ts';
import type {
  RetrospectiveEvidence,
  RetrospectiveClassification,
} from '../../../packages/discovery-universe/src/retrospective-classifier.ts';
import type { CoveragePopulationManifest } from '../../../packages/shared-schemas/src/disc.ts';

// -----------------------------------------------------------------------------
// 1. Coverage Population Manifests for Recall Testing
// -----------------------------------------------------------------------------

export const MANIFEST_FIRST_PARTY_EVAL: CoveragePopulationManifest = {
  manifestId: 'cov_man_recall_first_party_001',
  populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
  collectorScopeIds: ['scope_pump_live_v1'],
  sourceIds: ['col_solana_pump_live_upstream'], // Evaluated source is NOT in sourceIds
  startSlot: '300000000',
  endSlot: '300100000',
  startTime: '2026-08-20T00:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T12:00:00Z' as UtcTimestamp,
  knownGapsCount: 0,
  rightsExclusions: [],
  sourceDependenceDisclosed: true,
};

export const MANIFEST_SELF_RECALL_UNIVERSE: CoveragePopulationManifest = {
  manifestId: 'cov_man_self_recall_002',
  populationClass: 'SUPPORTED_PROGRAM_UNIVERSE',
  collectorScopeIds: ['scope_pump_live_v1'],
  sourceIds: ['col_solana_pump_live', 'src_gmgn_free_aggregate'], // col_solana_pump_live IS in sourceIds
  startSlot: '300000000',
  endSlot: '300100000',
  startTime: '2026-08-20T00:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T12:00:00Z' as UtcTimestamp,
  knownGapsCount: 0,
  rightsExclusions: [],
  sourceDependenceDisclosed: true,
};

export const MANIFEST_STRATIFIED_SAMPLED: CoveragePopulationManifest = {
  manifestId: 'cov_man_stratified_sampled_003',
  populationClass: 'STRATIFIED_SAMPLED_UNIVERSE',
  collectorScopeIds: ['scope_pump_live_v1'],
  sourceIds: ['col_solana_archive_node_direct'],
  startSlot: '300000000',
  endSlot: '300100000',
  startTime: '2026-08-20T00:00:00Z' as UtcTimestamp,
  endTime: '2026-08-20T12:00:00Z' as UtcTimestamp,
  knownGapsCount: 0,
  rightsExclusions: [],
  selectionProbabilities: {
    subj_sample_001: 0.5, // weight = 2
    subj_sample_002: 0.25, // weight = 4
    subj_sample_003: 0.1, // weight = 10
  },
  sourceDependenceDisclosed: true,
};

// -----------------------------------------------------------------------------
// 2. Recall Observations
// -----------------------------------------------------------------------------

export const OBSERVATIONS_STANDARD: readonly RecallObservation[] = [
  { subjectId: 'subj_001', discoveredByEvaluatedSource: true, eligible: true },
  { subjectId: 'subj_002', discoveredByEvaluatedSource: true, eligible: true },
  { subjectId: 'subj_003', discoveredByEvaluatedSource: true, eligible: true },
  { subjectId: 'subj_004', discoveredByEvaluatedSource: true, eligible: true },
  { subjectId: 'subj_005', discoveredByEvaluatedSource: false, eligible: true },
  { subjectId: 'subj_006', discoveredByEvaluatedSource: false, eligible: true },
  { subjectId: 'subj_007', discoveredByEvaluatedSource: true, eligible: true },
  { subjectId: 'subj_008', discoveredByEvaluatedSource: true, eligible: true },
  { subjectId: 'subj_009', discoveredByEvaluatedSource: true, eligible: true },
  { subjectId: 'subj_010', discoveredByEvaluatedSource: true, eligible: true },
]; // 8 / 10 discovered -> recall = 0.8

export const OBSERVATIONS_STRATIFIED: readonly RecallObservation[] = [
  { subjectId: 'subj_sample_001', discoveredByEvaluatedSource: true, eligible: true }, // weight 2, disc
  { subjectId: 'subj_sample_002', discoveredByEvaluatedSource: true, eligible: true }, // weight 4, disc
  { subjectId: 'subj_sample_003', discoveredByEvaluatedSource: false, eligible: true }, // weight 10, not disc
]; // weighted discovered = 6, weighted population = 16 -> recall = 6/16 = 0.375

// -----------------------------------------------------------------------------
// 3. Dependence Edges for Lineage Independence
// -----------------------------------------------------------------------------

export const RECALL_EDGE_INDEPENDENT: RecallDependenceEdge = {
  edgeId: 'rec_edge_indep_001',
  sourceA: 'src_independent_indexer',
  sourceB: 'col_solana_pump_live_upstream',
  validFrom: '2026-01-01T00:00:00.000Z',
  effectiveIndependenceMultiplier: 1.0,
  evidenceIds: ['ev_indexer_provenance_audit_001'],
};

export const RECALL_EDGE_SHARED_LINEAGE: RecallDependenceEdge = {
  edgeId: 'rec_edge_shared_002',
  sourceA: 'src_gmgn_free_aggregate',
  sourceB: 'col_solana_pump_live_upstream',
  validFrom: '2026-01-01T00:00:00.000Z',
  effectiveIndependenceMultiplier: 0.25, // Shared lineage / low multiplier
  evidenceIds: ['ev_shared_upstream_lineage_disclosure_002'],
};

// -----------------------------------------------------------------------------
// 4. Recall Claim-Basis Vectors (Admission & Traps)
// -----------------------------------------------------------------------------

/** 1. Valid Independent First-Party Observation */
export const RECALL_VECTOR_INDEPENDENT_FIRST_PARTY: RecallEstimateInput = {
  estimateId: 'rec_est_first_party_001',
  manifest: MANIFEST_FIRST_PARTY_EVAL,
  evaluatedSourceId: 'col_solana_pump_live',
  claimBasis: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
  asOf: '2026-08-20T12:00:00.000Z',
  observations: OBSERVATIONS_STANDARD,
  independenceEvidence: ['ev_first_party_spine_verified'],
  independentFirstPartyObservation: true,
};

/** 2. Valid Independent Provider Lineage */
export const RECALL_VECTOR_INDEPENDENT_PROVIDER_LINEAGE: RecallEstimateInput = {
  estimateId: 'rec_est_provider_lineage_002',
  manifest: MANIFEST_FIRST_PARTY_EVAL,
  evaluatedSourceId: 'src_independent_indexer',
  claimBasis: 'INDEPENDENT_PROVIDER_LINEAGE',
  asOf: '2026-08-20T12:00:00.000Z',
  observations: OBSERVATIONS_STANDARD,
  independenceEvidence: ['ev_indexer_audit_cert'],
  dependenceEdges: [RECALL_EDGE_INDEPENDENT],
};

/** 3. Valid Known Inclusion Probabilities (Horvitz-Thompson) */
export const RECALL_VECTOR_KNOWN_INCLUSION_PROBABILITIES: RecallEstimateInput = {
  estimateId: 'rec_est_stratified_003',
  manifest: MANIFEST_STRATIFIED_SAMPLED,
  evaluatedSourceId: 'src_evaluated_stratified_source',
  claimBasis: 'KNOWN_INCLUSION_PROBABILITIES',
  asOf: '2026-08-20T12:00:00.000Z',
  observations: OBSERVATIONS_STRATIFIED,
  independenceEvidence: ['ev_sample_plan_hash_003'],
  inclusionProbabilitySource: 'sha256:stratified_sample_draw_spec_003',
};

/** 4. Shared-Lineage Trap (Dependent Disclosed) */
export const RECALL_VECTOR_SHARED_LINEAGE_TRAP: RecallEstimateInput = {
  estimateId: 'rec_est_shared_trap_004',
  manifest: MANIFEST_FIRST_PARTY_EVAL,
  evaluatedSourceId: 'src_gmgn_free_aggregate',
  claimBasis: 'INDEPENDENT_PROVIDER_LINEAGE',
  asOf: '2026-08-20T12:00:00.000Z',
  observations: OBSERVATIONS_STANDARD,
  independenceEvidence: ['ev_disclosed_shared_dependence'],
  dependenceEdges: [RECALL_EDGE_SHARED_LINEAGE],
};

/** 5. Self-Recall Trap (Structural Refusal) */
export const RECALL_VECTOR_SELF_RECALL_TRAP: RecallEstimateInput = {
  estimateId: 'rec_est_self_recall_trap_005',
  manifest: MANIFEST_SELF_RECALL_UNIVERSE, // Contains 'col_solana_pump_live'
  evaluatedSourceId: 'col_solana_pump_live',
  claimBasis: 'INDEPENDENT_FIRST_PARTY_OBSERVATION',
  asOf: '2026-08-20T12:00:00.000Z',
  observations: OBSERVATIONS_STANDARD,
  independenceEvidence: ['ev_self_attestation'],
  independentFirstPartyObservation: true,
};

/** 6. No-Basis Trap (Refused when evidence is missing or invalid) */
export const RECALL_VECTOR_NO_BASIS_TRAP: RecallEstimateInput = {
  estimateId: 'rec_est_no_basis_trap_006',
  manifest: MANIFEST_FIRST_PARTY_EVAL,
  evaluatedSourceId: 'src_unknown_unverified',
  claimBasis: 'INDEPENDENT_PROVIDER_LINEAGE',
  asOf: '2026-08-20T12:00:00.000Z',
  observations: OBSERVATIONS_STANDARD,
  independenceEvidence: [], // Missing evidence
};

// -----------------------------------------------------------------------------
// 5. Retrospective Classification Samples (§63.9, FR-DISC-006, FR-DISC-010)
// -----------------------------------------------------------------------------

export const RETRO_SAMPLE_INDEPENDENT_NOT_DISCOVERED: RetrospectiveEvidence = {
  subjectId: 'asset_rep_sol_retro_missed_gem_001',
  outcomeProfileMatched: true,
  liveSourceIds: [],
  retrospectiveUniversePresent: true,
  lineageIndependenceDisclosed: true,
  evidenceRefs: ['sha256:retro_archive_node_evidence_001'],
};

export const EXPECTED_RETRO_CLASSIFICATION_NOT_DISCOVERED: RetrospectiveClassification = {
  classification: 'NOT_DISCOVERED',
  retrospectiveOnly: true,
  historicalDecisionBundleEligible: false,
  evidenceRefs: ['sha256:retro_archive_node_evidence_001'],
};

export const RETRO_SAMPLE_DISCOVERED_IN_LIVE: RetrospectiveEvidence = {
  subjectId: 'asset_rep_sol_retro_live_found_002',
  outcomeProfileMatched: true,
  liveSourceIds: ['col_solana_pump_live'], // Already found in live
  retrospectiveUniversePresent: true,
  lineageIndependenceDisclosed: true,
  evidenceRefs: ['sha256:live_sighting_ref_002'],
};

export const RETRO_SAMPLE_OUTCOME_NOT_MATCHED: RetrospectiveEvidence = {
  subjectId: 'asset_rep_sol_retro_low_volume_003',
  outcomeProfileMatched: false, // Ineligible outcome profile
  liveSourceIds: [],
  retrospectiveUniversePresent: true,
  lineageIndependenceDisclosed: true,
  evidenceRefs: ['sha256:retro_evidence_003'],
};

export const RETRO_SAMPLE_SHARED_LINEAGE_INELIGIBLE: RetrospectiveEvidence = {
  subjectId: 'asset_rep_sol_retro_shared_lineage_004',
  outcomeProfileMatched: true,
  liveSourceIds: [],
  retrospectiveUniversePresent: true,
  lineageIndependenceDisclosed: false, // Shared lineage / not independent
  evidenceRefs: ['sha256:retro_evidence_004'],
};

export const RETRO_SAMPLE_MISSING_EVIDENCE: RetrospectiveEvidence = {
  subjectId: 'asset_rep_sol_retro_no_refs_005',
  outcomeProfileMatched: true,
  liveSourceIds: [],
  retrospectiveUniversePresent: true,
  lineageIndependenceDisclosed: true,
  evidenceRefs: [], // Missing required evidence refs
};
