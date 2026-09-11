// Package entrypoint — versioned schema mirrors of the Foresift domain
// contracts (manifest schemaRefs for the data and DR families).
// Convention: every Foresift workspace package carries a tsconfig.json that
// extends ../../tsconfig.base.json and globs src/** + test/**, so new modules
// and tests require zero root-config edits.
export * from './data.ts';
export * from './dr.ts';
export * from './prov.ts';
export * from './sec.ts';
export * from './core.ts';
export * from './cost.ts';
export * from './col.ts';
export * from './disc.ts';
export * from './trace.ts';
export * from './trd.ts';
export * from './sup.ts';
export * from './solsec.ts';
export * from './exec.ts';
export * from './capacity.ts';
export * from './mat.ts';
export * from './eval.ts';
export * from './obj.ts';
export {
  SIG_SCHEMA_REGISTRY_VERSION,
  FunnelStageSchema,
  VectorKindSchema,
  ParetoStatusSchema,
  SelectionArmSchema,
  CutoffReasonSchema,
  CohortFallbackLevelSchema,
  LifecycleStateSchema,
  RecheckDecisionKindSchema,
  FeatureDefinitionSchema as SigFeatureDefinitionSchema,
  FeatureLineageSchema,
  CohortSnapshotSchema,
  FunnelStageRecordSchema,
  CandidateVectorComponentSchema,
  CandidateVectorRecordSchema,
  RankingAuditSchema,
  SelectionDecisionSchema,
  LifecycleTransitionSchema,
  RecheckBudgetSchema,
  RecheckDecisionSchema,
  SigSchemaRegistry,
  parseSigSchema,
  type SigFeatureDefinition,
  type FeatureLineage as SigFeatureLineage,
  type CohortSnapshot as SigCohortSnapshot,
  type FunnelStageRecord as SigFunnelStageRecord,
  type CandidateVectorRecord as SigCandidateVectorRecord,
  type RankingAudit as SigRankingAudit,
  type SelectionDecision as SigSelectionDecision,
  type LifecycleTransition as SigLifecycleTransition,
  type RecheckBudget as SigRecheckBudget,
  type RecheckDecision as SigRecheckDecision,
  type SigSchemaName,
} from './sig.ts';
