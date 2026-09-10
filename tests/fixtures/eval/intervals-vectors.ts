/**
 * Correlated uncertainty and clustered confidence interval vectors (§68.6, FR-MAT-005, AC-151).
 * Covers:
 * - Correlated token fixtures with multi-level cluster structure (deployer, funding wallet, launchpad batch)
 * - Naive vs Clustered confidence interval divergence
 * - Effective Sample Size (ESS) calculation and promotion gating
 * - Sensitivity to alternate clustering definitions
 */

export interface TokenObservationInCluster {
  tokenId: string;
  clusterId: string; // e.g. deployer entity
  subClusterId: string; // e.g. launchpad batch
  realizedUtilityUsd: number;
  isSuccess: boolean;
}

export interface IntervalEvaluationCase {
  caseId: string;
  description: string;
  totalTokenCount: number; // Naive N
  clusterCount: number; // K
  clusterDefinition: 'DEPLOYER_ENTITY' | 'FUNDING_WALLET_CLUSTER' | 'CALENDAR_NARRATIVE_WAVE';
  alternateClusterDefinition: 'LAUNCHPAD_BATCH' | 'POOL_ROUTER' | 'FUNDING_WALLET_CLUSTER';
  observations: readonly TokenObservationInCluster[];
  naiveMetrics: {
    meanUtilityUsd: number;
    standardError: number;
    ci95Lower: number;
    ci95Upper: number;
    ciWidth: number;
  };
  clusteredMetrics: {
    meanUtilityUsd: number;
    clusterRobustStandardError: number;
    ci95Lower: number;
    ci95Upper: number;
    ciWidth: number;
    effectiveSampleSize: number; // ESS
  };
  alternateClusteredMetrics: {
    meanUtilityUsd: number;
    clusterRobustStandardError: number;
    ci95Lower: number;
    ci95Upper: number;
    ciWidth: number;
    effectiveSampleSize: number;
  };
  divergenceFactor: number; // clustered CI width / naive CI width
  minRequiredEssForPromotion: number;
  passesEssPromotionGate: boolean;
  promotionRefusalReason?: string;
  notes: string;
}

export const GOLDEN_INTERVAL_CASES: readonly IntervalEvaluationCase[] = [
  // 1. Highly correlated cluster case (100 tokens created by just 5 deployers)
  {
    caseId: 'int_correlated_deployer_clusters',
    description: '100 tokens concentrated across 5 deployers; intra-cluster correlation rho = 0.85',
    totalTokenCount: 100,
    clusterCount: 5,
    clusterDefinition: 'DEPLOYER_ENTITY',
    alternateClusterDefinition: 'FUNDING_WALLET_CLUSTER',
    observations: [
      // Cluster 1: Deployer Alpha (20 tokens, all positive correlation ~ $100 utility)
      ...Array.from({ length: 20 }, (_, i) => ({
        tokenId: `token_c1_${i + 1}`,
        clusterId: 'deployer_alpha',
        subClusterId: 'batch_alpha_1',
        realizedUtilityUsd: 100.0 + (i % 3) * 5.0,
        isSuccess: true,
      })),
      // Cluster 2: Deployer Beta (20 tokens, all positive correlation ~ $80 utility)
      ...Array.from({ length: 20 }, (_, i) => ({
        tokenId: `token_c2_${i + 1}`,
        clusterId: 'deployer_beta',
        subClusterId: 'batch_beta_1',
        realizedUtilityUsd: 80.0 - (i % 3) * 4.0,
        isSuccess: true,
      })),
      // Cluster 3: Deployer Gamma (20 tokens, all negative correlation ~ -$50 utility)
      ...Array.from({ length: 20 }, (_, i) => ({
        tokenId: `token_c3_${i + 1}`,
        clusterId: 'deployer_gamma',
        subClusterId: 'batch_gamma_1',
        realizedUtilityUsd: -50.0 + (i % 3) * 2.0,
        isSuccess: false,
      })),
      // Cluster 4: Deployer Delta (20 tokens, all negative correlation ~ -$70 utility)
      ...Array.from({ length: 20 }, (_, i) => ({
        tokenId: `token_c4_${i + 1}`,
        clusterId: 'deployer_delta',
        subClusterId: 'batch_delta_1',
        realizedUtilityUsd: -70.0 + (i % 2) * 5.0,
        isSuccess: false,
      })),
      // Cluster 5: Deployer Epsilon (20 tokens, all positive correlation ~ $60 utility)
      ...Array.from({ length: 20 }, (_, i) => ({
        tokenId: `token_c5_${i + 1}`,
        clusterId: 'deployer_epsilon',
        subClusterId: 'batch_epsilon_1',
        realizedUtilityUsd: 60.0 + (i % 4) * 3.0,
        isSuccess: true,
      })),
    ],
    naiveMetrics: {
      meanUtilityUsd: 24.2,
      standardError: 7.15,
      ci95Lower: 10.18,
      ci95Upper: 38.22,
      ciWidth: 28.04,
    },
    clusteredMetrics: {
      meanUtilityUsd: 24.2,
      clusterRobustStandardError: 28.5, // Much larger standard error due to cluster correlation!
      ci95Lower: -31.66,
      ci95Upper: 80.06,
      ciWidth: 111.72,
      effectiveSampleSize: 6.2, // N=100 collapses to ESS=6.2!
    },
    alternateClusteredMetrics: {
      meanUtilityUsd: 24.2,
      clusterRobustStandardError: 26.8,
      ci95Lower: -28.32,
      ci95Upper: 76.72,
      ciWidth: 105.04,
      effectiveSampleSize: 6.8,
    },
    divergenceFactor: 3.98, // Clustered CI is ~4x wider than naive CI
    minRequiredEssForPromotion: 30.0,
    passesEssPromotionGate: false,
    promotionRefusalReason: 'INSUFFICIENT_EFFECTIVE_SAMPLE_SIZE_FOR_PROMOTION_CLAIM',
    notes: 'FR-MAT-005: Low effective sample size (ESS=6.2 < 30) blocks promotion despite N=100 tokens',
  },

  // 2. High ESS independent token case - PASSES GATE
  {
    caseId: 'int_high_ess_independent_clusters',
    description: '200 tokens across 80 independent deployer clusters with low intra-cluster correlation',
    totalTokenCount: 200,
    clusterCount: 80,
    clusterDefinition: 'DEPLOYER_ENTITY',
    alternateClusterDefinition: 'FUNDING_WALLET_CLUSTER',
    observations: Array.from({ length: 200 }, (_, i) => ({
      tokenId: `token_ind_${i + 1}`,
      clusterId: `deployer_${(i % 80) + 1}`,
      subClusterId: `batch_${(i % 80) + 1}`,
      realizedUtilityUsd: (i % 2 === 0 ? 50.0 : -20.0) + (i % 5) * 2.0,
      isSuccess: i % 2 === 0,
    })),
    naiveMetrics: {
      meanUtilityUsd: 19.0,
      standardError: 2.5,
      ci95Lower: 14.1,
      ci95Upper: 23.9,
      ciWidth: 9.8,
    },
    clusteredMetrics: {
      meanUtilityUsd: 19.0,
      clusterRobustStandardError: 3.1,
      ci95Lower: 12.92,
      ci95Upper: 25.08,
      ciWidth: 12.16,
      effectiveSampleSize: 72.4, // ESS is 72.4, robust!
    },
    alternateClusteredMetrics: {
      meanUtilityUsd: 19.0,
      clusterRobustStandardError: 3.0,
      ci95Lower: 13.12,
      ci95Upper: 24.88,
      ciWidth: 11.76,
      effectiveSampleSize: 75.1,
    },
    divergenceFactor: 1.24,
    minRequiredEssForPromotion: 30.0,
    passesEssPromotionGate: true,
    notes: 'High cluster dispersion yields adequate ESS (72.4 >= 30) and narrow robust confidence band',
  },
];
