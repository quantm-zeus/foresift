/**
 * Missed Opportunity Analyzer and Error Taxonomy vectors (§31.10, §31.11, FR-EVAL-005, AC-041).
 * Covers every member of the reachable error taxonomy:
 * 1. EARLY_FILTER_DROP
 * 2. SCORE_THRESHOLD_MISS
 * 3. DELAY_DEGRADATION_MISS
 * 4. LIQUIDITY_DISQUALIFIED
 * 5. SECURITY_FALSE_POSITIVE
 * 6. UNOBSERVED_INGESTION_GAP
 * 7. CAPACITY_BLOCKED
 * Plus delay decompositions and counterfactual action times.
 */

export const ERROR_TAXONOMY_MEMBERS = [
  'EARLY_FILTER_DROP',
  'SCORE_THRESHOLD_MISS',
  'DELAY_DEGRADATION_MISS',
  'LIQUIDITY_DISQUALIFIED',
  'SECURITY_FALSE_POSITIVE',
  'UNOBSERVED_INGESTION_GAP',
  'CAPACITY_BLOCKED',
] as const;

export type ErrorTaxonomyMember = (typeof ERROR_TAXONOMY_MEMBERS)[number];

export interface DelayDecomposition {
  ingestionDelayMs: number;
  scoringDelayMs: number;
  deliveryDelayMs: number;
  executionDelayMs: number;
  totalDelayMs: number;
}

export interface MissedOpportunityCase {
  caseId: string;
  assetId: string;
  profileId: string;
  actualGemReturnMultiple: number; // e.g. 5x gain achieved in real market
  taxonomyClassification: ErrorTaxonomyMember;
  delayDecomposition: DelayDecomposition;
  detectionTime: string;
  optimalActionTime: string;
  counterfactualActionTime: string;
  counterfactualOutcomeMultiple: number; // Return if alerted at counterfactual action time
  rootCauseDetails: string;
  actionableRemediation: string;
}

export const GOLDEN_MISSED_OPPORTUNITY_CASES: readonly MissedOpportunityCase[] = [
  // 1. EARLY_FILTER_DROP: Dropped by heuristic pre-filter before scoring
  {
    caseId: 'miss_01_early_filter',
    assetId: 'asset_meme_miss_001',
    profileId: 'HG-EM-1@1',
    actualGemReturnMultiple: 4.5,
    taxonomyClassification: 'EARLY_FILTER_DROP',
    delayDecomposition: {
      ingestionDelayMs: 15,
      scoringDelayMs: 0,
      deliveryDelayMs: 0,
      executionDelayMs: 0,
      totalDelayMs: 15,
    },
    detectionTime: '2026-08-20T10:00:00.015Z',
    optimalActionTime: '2026-08-20T10:00:00.000Z',
    counterfactualActionTime: '2026-08-20T10:00:00.050Z',
    counterfactualOutcomeMultiple: 4.2,
    rootCauseDetails:
      'Pre-filter dropped token because deployer had 0 prior history (naive zero-shot filter)',
    actionableRemediation: 'Relax strict deployer history rule for bonding curve initializations',
  },

  // 2. SCORE_THRESHOLD_MISS: Scored 0.68 when alert threshold was 0.70
  {
    caseId: 'miss_02_score_threshold',
    assetId: 'asset_og_miss_002',
    profileId: 'HG-OG-1@1',
    actualGemReturnMultiple: 3.2,
    taxonomyClassification: 'SCORE_THRESHOLD_MISS',
    delayDecomposition: {
      ingestionDelayMs: 25,
      scoringDelayMs: 60,
      deliveryDelayMs: 0,
      executionDelayMs: 0,
      totalDelayMs: 85,
    },
    detectionTime: '2026-08-20T11:00:00.085Z',
    optimalActionTime: '2026-08-20T11:00:00.000Z',
    counterfactualActionTime: '2026-08-20T11:00:00.100Z',
    counterfactualOutcomeMultiple: 3.0,
    rootCauseDetails: 'Model assigned score 0.68, narrowly missing 0.70 alert threshold',
    actionableRemediation: 'Calibrate threshold dynamically per market volatility regime',
  },

  // 3. DELAY_DEGRADATION_MISS: Alert generated 4 seconds too late; price had already pumped 80%
  {
    caseId: 'miss_03_delay_degradation',
    assetId: 'asset_meme_miss_003',
    profileId: 'HG-EM-1@1',
    actualGemReturnMultiple: 6.0,
    taxonomyClassification: 'DELAY_DEGRADATION_MISS',
    delayDecomposition: {
      ingestionDelayMs: 1200,
      scoringDelayMs: 2000,
      deliveryDelayMs: 800,
      executionDelayMs: 500,
      totalDelayMs: 4500,
    },
    detectionTime: '2026-08-20T12:00:04.500Z',
    optimalActionTime: '2026-08-20T12:00:00.000Z',
    counterfactualActionTime: '2026-08-20T12:00:00.200Z',
    counterfactualOutcomeMultiple: 5.8,
    rootCauseDetails: 'Heavy queue lag in scoring pipeline delayed alert past entry window',
    actionableRemediation: 'Deploy dedicated priority inference worker for high-growth queue',
  },

  // 4. LIQUIDITY_DISQUALIFIED: Initial pool was $4,500 (< $5,000 limit), but grew to $100k
  {
    caseId: 'miss_04_liquidity_disqualified',
    assetId: 'asset_lr_miss_004',
    profileId: 'HG-LR-1@1',
    actualGemReturnMultiple: 2.8,
    taxonomyClassification: 'LIQUIDITY_DISQUALIFIED',
    delayDecomposition: {
      ingestionDelayMs: 20,
      scoringDelayMs: 40,
      deliveryDelayMs: 0,
      executionDelayMs: 0,
      totalDelayMs: 60,
    },
    detectionTime: '2026-08-20T13:00:00.060Z',
    optimalActionTime: '2026-08-20T13:00:00.000Z',
    counterfactualActionTime: '2026-08-20T13:00:00.100Z',
    counterfactualOutcomeMultiple: 2.6,
    rootCauseDetails: 'Static minimum liquidity rule rejected pool during early accumulation',
    actionableRemediation: 'Use slope-of-liquidity-growth rather than static snapshot threshold',
  },

  // 5. SECURITY_FALSE_POSITIVE: False flag on mint authority (contract was renounced via timelock)
  {
    caseId: 'miss_05_security_fp',
    assetId: 'asset_og_miss_005',
    profileId: 'HG-OG-1@1',
    actualGemReturnMultiple: 5.0,
    taxonomyClassification: 'SECURITY_FALSE_POSITIVE',
    delayDecomposition: {
      ingestionDelayMs: 30,
      scoringDelayMs: 50,
      deliveryDelayMs: 0,
      executionDelayMs: 0,
      totalDelayMs: 80,
    },
    detectionTime: '2026-08-20T14:00:00.080Z',
    optimalActionTime: '2026-08-20T14:00:00.000Z',
    counterfactualActionTime: '2026-08-20T14:00:00.100Z',
    counterfactualOutcomeMultiple: 4.8,
    rootCauseDetails: 'Security checker failed to parse multi-sig timelock authority structure',
    actionableRemediation: 'Update Solana authority decoder for Squads V4 multi-sig contracts',
  },

  // 6. UNOBSERVED_INGESTION_GAP: RPC websocket drop lost the creation transaction
  {
    caseId: 'miss_06_ingestion_gap',
    assetId: 'asset_meme_miss_006',
    profileId: 'HG-EM-1@1',
    actualGemReturnMultiple: 8.0,
    taxonomyClassification: 'UNOBSERVED_INGESTION_GAP',
    delayDecomposition: {
      ingestionDelayMs: 60000, // 1 minute late backfill
      scoringDelayMs: 50,
      deliveryDelayMs: 0,
      executionDelayMs: 0,
      totalDelayMs: 60050,
    },
    detectionTime: '2026-08-20T15:01:00.050Z',
    optimalActionTime: '2026-08-20T15:00:00.000Z',
    counterfactualActionTime: '2026-08-20T15:00:00.050Z',
    counterfactualOutcomeMultiple: 7.5,
    rootCauseDetails: 'Primary RPC dropped connection for 45 seconds; backfilled too late',
    actionableRemediation:
      'Add dual-stream redundant websocket ingestion with zero-lag deduplication',
  },

  // 7. CAPACITY_BLOCKED: Portfolio max concurrent positions reached (5/5 positions open)
  {
    caseId: 'miss_07_capacity_blocked',
    assetId: 'asset_sm_miss_007',
    profileId: 'HG-SM-1@1',
    actualGemReturnMultiple: 3.5,
    taxonomyClassification: 'CAPACITY_BLOCKED',
    delayDecomposition: {
      ingestionDelayMs: 20,
      scoringDelayMs: 40,
      deliveryDelayMs: 10,
      executionDelayMs: 0,
      totalDelayMs: 70,
    },
    detectionTime: '2026-08-20T16:00:00.070Z',
    optimalActionTime: '2026-08-20T16:00:00.000Z',
    counterfactualActionTime: '2026-08-20T16:00:00.100Z',
    counterfactualOutcomeMultiple: 3.3,
    rootCauseDetails: 'Strategy reached max capital deployment ceiling; trade execution refused',
    actionableRemediation: 'Implement dynamic position recycling to replace weakest open position',
  },
];
