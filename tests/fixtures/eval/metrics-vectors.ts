/**
 * Metric golden vectors and hand-computed expectations (§31.6, FR-EVAL-003, AC-040, AC-041).
 * Covers all required metric families:
 * - Precision@k, Recall@k, NDCG@k
 * - Mean Rank, MRR (Mean Reciprocal Rank)
 * - Lead Time (median lead time, min, max, p90)
 * - MFE (Max Favorable Excursion), MAE (Max Adverse Excursion)
 * - Survival rates over horizon windows
 * - Divergence (expected vs realized execution return)
 * - Maturity rates (% fully matured, % pending, % partial, % censored, % invalid)
 * - Expectancy, Max Drawdown, CVaR 95%
 */

export interface CandidateMetricEntry {
  candidateId: string;
  rank: number;
  score: number;
  isTrueGem: boolean; // Ground truth relevance
  isDiscoveredByAlert: boolean;
  leadTimeSeconds: number;
  realizedReturnPct: number;
  expectedReturnPct: number;
  mfePct: number; // Max favorable excursion
  maePct: number; // Max adverse excursion
  survivedHorizon15m: boolean;
  survivedHorizon1h: boolean;
  survivedHorizon4h: boolean;
  maturityState: 'FULLY_MATURED' | 'PARTIALLY_MATURED' | 'PENDING' | 'CENSORED' | 'INVALID_DATA';
}

export interface MetricScenarioExpectation {
  scenarioId: string;
  description: string;
  universeGemCount: number; // Total true gems in universe (for recall denominator)
  topK: number;
  entries: readonly CandidateMetricEntry[];
  expected: {
    precisionAtK: number;
    recallAtK: number;
    ndcgAtK: number;
    meanRank: number;
    mrr: number;
    medianLeadTimeSeconds: number;
    p90LeadTimeSeconds: number;
    meanMfePct: number;
    meanMaePct: number;
    survivalRate15m: number;
    survivalRate1h: number;
    survivalRate4h: number;
    meanDivergencePct: number;
    maturityRates: {
      fullyMaturedPct: number;
      partiallyMaturedPct: number;
      pendingPct: number;
      censoredPct: number;
      invalidPct: number;
    };
    deterministicExpectancyPct: number;
    maxDrawdownPct: number;
    cvar95Pct: number;
  };
}

export const GOLDEN_METRIC_VECTORS: readonly MetricScenarioExpectation[] = [
  {
    scenarioId: 'metrics_top5_ranked_run',
    description:
      'Golden run of 10 ranked candidates evaluating Top-5 performance with 4 universe true gems',
    universeGemCount: 4,
    topK: 5,
    entries: [
      // Rank 1: Gem, accurate lead time, +150% return
      {
        candidateId: 'cand_1',
        rank: 1,
        score: 0.95,
        isTrueGem: true,
        isDiscoveredByAlert: true,
        leadTimeSeconds: 120,
        realizedReturnPct: 150.0,
        expectedReturnPct: 140.0,
        mfePct: 180.0,
        maePct: -10.0,
        survivedHorizon15m: true,
        survivedHorizon1h: true,
        survivedHorizon4h: true,
        maturityState: 'FULLY_MATURED',
      },
      // Rank 2: Gem, +80% return
      {
        candidateId: 'cand_2',
        rank: 2,
        score: 0.88,
        isTrueGem: true,
        isDiscoveredByAlert: true,
        leadTimeSeconds: 180,
        realizedReturnPct: 80.0,
        expectedReturnPct: 75.0,
        mfePct: 100.0,
        maePct: -15.0,
        survivedHorizon15m: true,
        survivedHorizon1h: true,
        survivedHorizon4h: true,
        maturityState: 'FULLY_MATURED',
      },
      // Rank 3: False Positive (Not a gem), -30% return
      {
        candidateId: 'cand_3',
        rank: 3,
        score: 0.82,
        isTrueGem: false,
        isDiscoveredByAlert: true,
        leadTimeSeconds: 300,
        realizedReturnPct: -30.0,
        expectedReturnPct: 50.0,
        mfePct: 15.0,
        maePct: -45.0,
        survivedHorizon15m: true,
        survivedHorizon1h: false,
        survivedHorizon4h: false,
        maturityState: 'FULLY_MATURED',
      },
      // Rank 4: Gem, +200% return
      {
        candidateId: 'cand_4',
        rank: 4,
        score: 0.76,
        isTrueGem: true,
        isDiscoveredByAlert: true,
        leadTimeSeconds: 90,
        realizedReturnPct: 200.0,
        expectedReturnPct: 180.0,
        mfePct: 250.0,
        maePct: -5.0,
        survivedHorizon15m: true,
        survivedHorizon1h: true,
        survivedHorizon4h: true,
        maturityState: 'FULLY_MATURED',
      },
      // Rank 5: False Positive, -50% return
      {
        candidateId: 'cand_5',
        rank: 5,
        score: 0.7,
        isTrueGem: false,
        isDiscoveredByAlert: true,
        leadTimeSeconds: 240,
        realizedReturnPct: -50.0,
        expectedReturnPct: 30.0,
        mfePct: 5.0,
        maePct: -60.0,
        survivedHorizon15m: true,
        survivedHorizon1h: false,
        survivedHorizon4h: false,
        maturityState: 'FULLY_MATURED',
      },
      // Rank 6..10 outside Top-5
      {
        candidateId: 'cand_6',
        rank: 6,
        score: 0.65,
        isTrueGem: false,
        isDiscoveredByAlert: false,
        leadTimeSeconds: 400,
        realizedReturnPct: -20.0,
        expectedReturnPct: 0.0,
        mfePct: 10.0,
        maePct: -30.0,
        survivedHorizon15m: false,
        survivedHorizon1h: false,
        survivedHorizon4h: false,
        maturityState: 'FULLY_MATURED',
      },
      {
        candidateId: 'cand_7',
        rank: 7,
        score: 0.55,
        isTrueGem: true, // 4th universe gem missed in top-5!
        isDiscoveredByAlert: false,
        leadTimeSeconds: 600,
        realizedReturnPct: 120.0,
        expectedReturnPct: 0.0,
        mfePct: 150.0,
        maePct: -10.0,
        survivedHorizon15m: true,
        survivedHorizon1h: true,
        survivedHorizon4h: true,
        maturityState: 'FULLY_MATURED',
      },
      {
        candidateId: 'cand_8',
        rank: 8,
        score: 0.4,
        isTrueGem: false,
        isDiscoveredByAlert: false,
        leadTimeSeconds: 900,
        realizedReturnPct: -80.0,
        expectedReturnPct: 0.0,
        mfePct: 0.0,
        maePct: -80.0,
        survivedHorizon15m: false,
        survivedHorizon1h: false,
        survivedHorizon4h: false,
        maturityState: 'FULLY_MATURED',
      },
      {
        candidateId: 'cand_9',
        rank: 9,
        score: 0.3,
        isTrueGem: false,
        isDiscoveredByAlert: false,
        leadTimeSeconds: 1200,
        realizedReturnPct: -100.0,
        expectedReturnPct: 0.0,
        mfePct: 0.0,
        maePct: -100.0,
        survivedHorizon15m: false,
        survivedHorizon1h: false,
        survivedHorizon4h: false,
        maturityState: 'FULLY_MATURED',
      },
      {
        candidateId: 'cand_10',
        rank: 10,
        score: 0.1,
        isTrueGem: false,
        isDiscoveredByAlert: false,
        leadTimeSeconds: 1500,
        realizedReturnPct: -95.0,
        expectedReturnPct: 0.0,
        mfePct: 2.0,
        maePct: -95.0,
        survivedHorizon15m: false,
        survivedHorizon1h: false,
        survivedHorizon4h: false,
        maturityState: 'FULLY_MATURED',
      },
    ],
    expected: {
      // Top 5: candidates 1, 2, 3, 4, 5. True gems in top 5 = cand_1, cand_2, cand_4 (3 items)
      // precision@5 = 3 / 5 = 0.60
      precisionAtK: 0.6,
      // recall@5 = 3 gems found / 4 total gems in universe = 0.75
      recallAtK: 0.75,
      // DCG@5 = (2^1 - 1)/log2(2) + (2^1 - 1)/log2(3) + 0 + (2^1 - 1)/log2(5) + 0
      //        = 1/1 + 1/1.58496 + 0 + 1/2.32193 = 1 + 0.63093 + 0.43068 = 2.06161
      // IDCG@5 = 1/1 + 1/1.58496 + 1/2.0 = 1 + 0.63093 + 0.5 = 2.13093
      // NDCG@5 = 2.06161 / 2.13093 = 0.96747
      ndcgAtK: 0.9675,
      // Mean Rank of True Gems in top 5: ranks 1, 2, 4 -> mean = (1 + 2 + 4) / 3 = 2.3333
      meanRank: 2.3333,
      // MRR of first relevant item: rank 1 -> 1 / 1 = 1.0
      mrr: 1.0,
      // Lead times in top 5: [120, 180, 300, 90, 240] -> sorted: [90, 120, 180, 240, 300]
      // Median = 180s, p90 = 300s
      medianLeadTimeSeconds: 180.0,
      p90LeadTimeSeconds: 300.0,
      // Mean MFE in top 5: (180 + 100 + 15 + 250 + 5) / 5 = 550 / 5 = 110.0%
      meanMfePct: 110.0,
      // Mean MAE in top 5: (-10 + -15 + -45 + -5 + -60) / 5 = -135 / 5 = -27.0%
      meanMaePct: -27.0,
      // Survival rates top 5: 15m (5/5 = 1.0), 1h (3/5 = 0.60), 4h (3/5 = 0.60)
      survivalRate15m: 1.0,
      survivalRate1h: 0.6,
      survivalRate4h: 0.6,
      // Divergence (realized - expected) in top 5:
      // cand1: +10, cand2: +5, cand3: -80, cand4: +20, cand5: -80
      // mean = (10 + 5 - 80 + 20 - 80) / 5 = -125 / 5 = -25.0%
      meanDivergencePct: -25.0,
      maturityRates: {
        fullyMaturedPct: 100.0,
        partiallyMaturedPct: 0.0,
        pendingPct: 0.0,
        censoredPct: 0.0,
        invalidPct: 0.0,
      },
      // Deterministic Expectancy in top 5: (150 + 80 - 30 + 200 - 50) / 5 = 350 / 5 = +70.0%
      deterministicExpectancyPct: 70.0,
      // Max Drawdown: peak portfolio dip across sequence = -50.0%
      maxDrawdownPct: 50.0,
      // CVaR 95%: worst loss tail = -50.0%
      cvar95Pct: -50.0,
    },
  },
];
