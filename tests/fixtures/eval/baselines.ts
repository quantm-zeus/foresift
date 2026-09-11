/**
 * Baseline comparison vectors (§31.7, FR-EVAL-004, AC-042).
 * Covers:
 * - Canonical baseline comparator models
 * - Matching vs unmatched universe comparison requirements
 * - Cutoff timestamp alignment and frozen evaluation runs
 */

export const BASELINE_COMPARATORS = [
  'ALWAYS_BUY_ALL_NEW_POOLS',
  'RANDOM_EXPLORATION_CHOICE',
  'MARKET_CAP_WEIGHTED_TOP_N',
  'PREVIOUS_CHAMPION_MODEL_V0',
  'STATIC_RULE_HEURISTIC_V1',
] as const;

export type BaselineComparator = (typeof BASELINE_COMPARATORS)[number];

export interface BaselineComparisonCase {
  caseId: string;
  description: string;
  championModelId: string;
  baselineComparator: BaselineComparator;
  isIdenticalUniverse: boolean;
  isIdenticalTimeCutoff: boolean;
  championUniverseManifestHash: string;
  baselineUniverseManifestHash: string;
  championCutoffTimestamp: string;
  baselineCutoffTimestamp: string;
  championMetrics: {
    precision: number;
    recall: number;
    ndcg: number;
    expectancyUsd: number;
  };
  baselineMetrics: {
    precision: number;
    recall: number;
    ndcg: number;
    expectancyUsd: number;
  };
  expectedMaterialLift: number; // champion expectancy - baseline expectancy
  comparisonValid: boolean;
  refusalReason?: string;
}

export const GOLDEN_BASELINE_CASES: readonly BaselineComparisonCase[] = [
  // 1. Valid fair comparison on identical frozen universe and cutoff
  {
    caseId: 'base_comp_valid_champion_vs_prev',
    description:
      'Fair comparison of Champion V2 against Baseline V0 on identical frozen Q3 universe',
    championModelId: 'champ_v2_fast_meme',
    baselineComparator: 'PREVIOUS_CHAMPION_MODEL_V0',
    isIdenticalUniverse: true,
    isIdenticalTimeCutoff: true,
    championUniverseManifestHash: 'sha256:universe_q3_frozen_canonical_hash_001',
    baselineUniverseManifestHash: 'sha256:universe_q3_frozen_canonical_hash_001',
    championCutoffTimestamp: '2026-08-31T23:59:59.999Z',
    baselineCutoffTimestamp: '2026-08-31T23:59:59.999Z',
    championMetrics: {
      precision: 0.65,
      recall: 0.8,
      ndcg: 0.92,
      expectancyUsd: 1250.0,
    },
    baselineMetrics: {
      precision: 0.4,
      recall: 0.5,
      ndcg: 0.7,
      expectancyUsd: 400.0,
    },
    expectedMaterialLift: 850.0,
    comparisonValid: true,
  },

  // 2. Unmatched universe refusal (FR-EVAL-004, AC-042)
  {
    caseId: 'base_comp_refused_mismatched_universe',
    description: 'Illegal comparison where baseline ran on different universe subset',
    championModelId: 'champ_v2_fast_meme',
    baselineComparator: 'STATIC_RULE_HEURISTIC_V1',
    isIdenticalUniverse: false,
    isIdenticalTimeCutoff: true,
    championUniverseManifestHash: 'sha256:universe_q3_frozen_canonical_hash_001',
    baselineUniverseManifestHash: 'sha256:universe_selective_subset_hash_999',
    championCutoffTimestamp: '2026-08-31T23:59:59.999Z',
    baselineCutoffTimestamp: '2026-08-31T23:59:59.999Z',
    championMetrics: {
      precision: 0.65,
      recall: 0.8,
      ndcg: 0.92,
      expectancyUsd: 1250.0,
    },
    baselineMetrics: {
      precision: 0.35,
      recall: 0.45,
      ndcg: 0.65,
      expectancyUsd: 250.0,
    },
    expectedMaterialLift: 1000.0,
    comparisonValid: false,
    refusalReason: 'BASELINE_COMPARISON_REQUIRES_IDENTICAL_FROZEN_UNIVERSE',
  },

  // 3. Mismatched time cutoff refusal
  {
    caseId: 'base_comp_refused_mismatched_cutoff',
    description: 'Illegal comparison where champion and baseline had different cutoff timestamps',
    championModelId: 'champ_v2_fast_meme',
    baselineComparator: 'RANDOM_EXPLORATION_CHOICE',
    isIdenticalUniverse: true,
    isIdenticalTimeCutoff: false,
    championUniverseManifestHash: 'sha256:universe_q3_frozen_canonical_hash_001',
    baselineUniverseManifestHash: 'sha256:universe_q3_frozen_canonical_hash_001',
    championCutoffTimestamp: '2026-08-31T23:59:59.999Z',
    baselineCutoffTimestamp: '2026-08-15T00:00:00.000Z',
    championMetrics: {
      precision: 0.65,
      recall: 0.8,
      ndcg: 0.92,
      expectancyUsd: 1250.0,
    },
    baselineMetrics: {
      precision: 0.1,
      recall: 0.15,
      ndcg: 0.3,
      expectancyUsd: -100.0,
    },
    expectedMaterialLift: 1350.0,
    comparisonValid: false,
    refusalReason: 'BASELINE_COMPARISON_REQUIRES_IDENTICAL_TIME_CUTOFF',
  },
];
