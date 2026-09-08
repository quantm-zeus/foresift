/** Closed signal-intelligence vocabularies shared across package boundaries. */

export const FunnelStage = {
  FREE_DISCOVERY_UNIVERSE_ATTRIBUTION: 'FREE_DISCOVERY_UNIVERSE_ATTRIBUTION',
  IDENTITY_VALIDATION: 'IDENTITY_VALIDATION',
  CAPABILITY_DATA_QUALITY_GATE: 'CAPABILITY_DATA_QUALITY_GATE',
  ELIGIBILITY_GATES: 'ELIGIBILITY_GATES',
  ZERO_COST_COARSE_GATE: 'ZERO_COST_COARSE_GATE',
  CHEAP_BATCH_MONITORING_PERSISTENCE_GATE: 'CHEAP_BATCH_MONITORING_PERSISTENCE_GATE',
  SELECTIVE_FREE_QUOTA_VERIFICATION: 'SELECTIVE_FREE_QUOTA_VERIFICATION',
  ECONOMIC_NORMALIZATION_SECURITY: 'ECONOMIC_NORMALIZATION_SECURITY',
  FEATURE_UPDATE: 'FEATURE_UPDATE',
  REGIME_ROUTE_RESOLUTION: 'REGIME_ROUTE_RESOLUTION',
  NARRATIVE_CROSS_CHAIN_CONTEXT: 'NARRATIVE_CROSS_CHAIN_CONTEXT',
  VECTOR_CONSTRUCTION: 'VECTOR_CONSTRUCTION',
  CROWDING_DECAY_PRECHECK: 'CROWDING_DECAY_PRECHECK',
  PARETO_FILTERING: 'PARETO_FILTERING',
  RESEARCH_PRIORITY_RANKING: 'RESEARCH_PRIORITY_RANKING',
  DIVERSITY_SELECTION: 'DIVERSITY_SELECTION',
  AGENT_RESEARCH: 'AGENT_RESEARCH',
  THESIS_WHY_NOW: 'THESIS_WHY_NOW',
  EVIDENCE_VALIDATION_ROBUSTNESS: 'EVIDENCE_VALIDATION_ROBUSTNESS',
  EXECUTION_TRADABILITY_GATE: 'EXECUTION_TRADABILITY_GATE',
  ALERT_POLICY: 'ALERT_POLICY',
} as const;

export type FunnelStage = (typeof FunnelStage)[keyof typeof FunnelStage];
export const ALL_FUNNEL_STAGES: readonly FunnelStage[] = Object.values(FunnelStage);

export const VectorKind = {
  OPPORTUNITY: 'OPPORTUNITY',
  RISK: 'RISK',
  DATA_QUALITY: 'DATA_QUALITY',
  URGENCY: 'URGENCY',
  NOVELTY: 'NOVELTY',
  TRADABILITY: 'TRADABILITY',
  SOURCE_INDEPENDENCE: 'SOURCE_INDEPENDENCE',
} as const;

export type VectorKind = (typeof VectorKind)[keyof typeof VectorKind];
export const ALL_VECTOR_KINDS: readonly VectorKind[] = Object.values(VectorKind);

export const SigErrorCode = {
  SIG_STAGE_UNKNOWN: 'SIG_STAGE_UNKNOWN',
  SIG_VECTOR_KIND_UNKNOWN: 'SIG_VECTOR_KIND_UNKNOWN',
} as const;

export type SigErrorCode = (typeof SigErrorCode)[keyof typeof SigErrorCode];

export class SigError extends RangeError {
  readonly code: SigErrorCode;

  constructor(code: SigErrorCode, value: string) {
    super(`${code}: ${JSON.stringify(value)}`);
    this.name = 'SigError';
    this.code = code;
  }
}

export function parseFunnelStage(value: string): FunnelStage {
  if (!(ALL_FUNNEL_STAGES as readonly string[]).includes(value)) {
    throw new SigError(SigErrorCode.SIG_STAGE_UNKNOWN, value);
  }
  return value as FunnelStage;
}

export function parseVectorKind(value: string): VectorKind {
  if (!(ALL_VECTOR_KINDS as readonly string[]).includes(value)) {
    throw new SigError(SigErrorCode.SIG_VECTOR_KIND_UNKNOWN, value);
  }
  return value as VectorKind;
}
