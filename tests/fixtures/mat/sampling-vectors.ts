/**
 * Stratified sampling and Horvitz-Thompson weighting vectors (§31.8, §68.10, FR-MAT-007, AC-128).
 * Covers:
 * - Strata across 8 dimensions
 * - Inclusion probabilities and sample assignments
 * - Horvitz-Thompson weighted estimates with hand-calculated expected values
 * - Weight-stability violation cases (positivity, extreme weights)
 * - Max-weight ceiling truncation cases
 * - Population claim diagnostics requirements
 */

export const STRATIFICATION_DIMENSIONS = [
  'asset_category',
  'pool_liquidity_depth',
  'creation_age_bucket',
  'launch_venue',
  'activity_volume_tier',
  'deployer_reputation',
  'holder_dispersion',
  'calendar_regime',
] as const;

export interface SampledUnit {
  unitId: string;
  stratumId: string;
  stratumDimensions: Record<string, string>;
  inclusionProbability: number; // pi_i
  samplingWeight: number; // 1 / pi_i
  rawSuccessValue: number; // 1 for win, 0 for loss
  rawUtilityUsd: number;
  isTruncated: boolean;
  truncatedWeight?: number;
}

export interface SamplingScenarioCase {
  scenarioId: string;
  description: string;
  populationSize: number; // N
  sampleSize: number; // n
  units: readonly SampledUnit[];
  maxWeightCeiling: number;
  expectedNaiveMean: number;
  expectedHorvitzThompsonWeightedMean: number;
  expectedWeightedTotalUtility: number;
  hasWeightStabilityViolation: boolean;
  hasPositivityViolation: boolean;
  allowsUniverseWideClaim: boolean;
  requiredClaimLimitation?: string;
  diagnostics: {
    effectiveSampleSize: number;
    maxWeight: number;
    weightVariance: number;
    weightSum: number;
  };
}

export const GOLDEN_SAMPLING_VECTORS: readonly SamplingScenarioCase[] = [
  {
    scenarioId: 'sampling_valid_stratified_8dim',
    description: 'Clean balanced 4-stratum design across the 8 dimensions with stable weights',
    populationSize: 1000,
    sampleSize: 8,
    maxWeightCeiling: 250.0,
    units: [
      // Stratum A: high depth, early age (pi = 0.02 -> weight = 50)
      {
        unitId: 'unit_a1',
        stratumId: 'stratum_a',
        stratumDimensions: {
          asset_category: 'MEME',
          pool_liquidity_depth: 'HIGH',
          creation_age_bucket: 'FRESH_1H',
          launch_venue: 'PUMP_FUN',
          activity_volume_tier: 'HIGH',
          deployer_reputation: 'CLEAN',
          holder_dispersion: 'DISPERSED',
          calendar_regime: 'ACTIVE_HOURS',
        },
        inclusionProbability: 0.02,
        samplingWeight: 50.0,
        rawSuccessValue: 1,
        rawUtilityUsd: 120.0,
        isTruncated: false,
      },
      {
        unitId: 'unit_a2',
        stratumId: 'stratum_a',
        stratumDimensions: {
          asset_category: 'MEME',
          pool_liquidity_depth: 'HIGH',
          creation_age_bucket: 'FRESH_1H',
          launch_venue: 'PUMP_FUN',
          activity_volume_tier: 'HIGH',
          deployer_reputation: 'CLEAN',
          holder_dispersion: 'DISPERSED',
          calendar_regime: 'ACTIVE_HOURS',
        },
        inclusionProbability: 0.02,
        samplingWeight: 50.0,
        rawSuccessValue: 0,
        rawUtilityUsd: -50.0,
        isTruncated: false,
      },

      // Stratum B: medium depth, intermediate age (pi = 0.01 -> weight = 100)
      {
        unitId: 'unit_b1',
        stratumId: 'stratum_b',
        stratumDimensions: {
          asset_category: 'DEFI',
          pool_liquidity_depth: 'MEDIUM',
          creation_age_bucket: 'INTERMEDIATE_24H',
          launch_venue: 'RAYDIUM',
          activity_volume_tier: 'MEDIUM',
          deployer_reputation: 'UNKNOWN',
          holder_dispersion: 'MODERATE',
          calendar_regime: 'ACTIVE_HOURS',
        },
        inclusionProbability: 0.01,
        samplingWeight: 100.0,
        rawSuccessValue: 1,
        rawUtilityUsd: 200.0,
        isTruncated: false,
      },
      {
        unitId: 'unit_b2',
        stratumId: 'stratum_b',
        stratumDimensions: {
          asset_category: 'DEFI',
          pool_liquidity_depth: 'MEDIUM',
          creation_age_bucket: 'INTERMEDIATE_24H',
          launch_venue: 'RAYDIUM',
          activity_volume_tier: 'MEDIUM',
          deployer_reputation: 'UNKNOWN',
          holder_dispersion: 'MODERATE',
          calendar_regime: 'ACTIVE_HOURS',
        },
        inclusionProbability: 0.01,
        samplingWeight: 100.0,
        rawSuccessValue: 1,
        rawUtilityUsd: 150.0,
        isTruncated: false,
      },

      // Stratum C: low depth, mature age (pi = 0.005 -> weight = 200)
      {
        unitId: 'unit_c1',
        stratumId: 'stratum_c',
        stratumDimensions: {
          asset_category: 'MEME',
          pool_liquidity_depth: 'LOW',
          creation_age_bucket: 'MATURE_7D',
          launch_venue: 'PUMP_FUN',
          activity_volume_tier: 'LOW',
          deployer_reputation: 'SUSPICIOUS',
          holder_dispersion: 'CONCENTRATED',
          calendar_regime: 'WEEKEND',
        },
        inclusionProbability: 0.005,
        samplingWeight: 200.0,
        rawSuccessValue: 0,
        rawUtilityUsd: -100.0,
        isTruncated: false,
      },
      {
        unitId: 'unit_c2',
        stratumId: 'stratum_c',
        stratumDimensions: {
          asset_category: 'MEME',
          pool_liquidity_depth: 'LOW',
          creation_age_bucket: 'MATURE_7D',
          launch_venue: 'PUMP_FUN',
          activity_volume_tier: 'LOW',
          deployer_reputation: 'SUSPICIOUS',
          holder_dispersion: 'CONCENTRATED',
          calendar_regime: 'WEEKEND',
        },
        inclusionProbability: 0.005,
        samplingWeight: 200.0,
        rawSuccessValue: 0,
        rawUtilityUsd: -100.0,
        isTruncated: false,
      },

      // Stratum D: high depth, mature age (pi = 0.01 -> weight = 100)
      {
        unitId: 'unit_d1',
        stratumId: 'stratum_d',
        stratumDimensions: {
          asset_category: 'L1_ECO',
          pool_liquidity_depth: 'HIGH',
          creation_age_bucket: 'MATURE_7D',
          launch_venue: 'DIRECT',
          activity_volume_tier: 'HIGH',
          deployer_reputation: 'KNOWN_CLEAN',
          holder_dispersion: 'DISPERSED',
          calendar_regime: 'ACTIVE_HOURS',
        },
        inclusionProbability: 0.01,
        samplingWeight: 100.0,
        rawSuccessValue: 1,
        rawUtilityUsd: 80.0,
        isTruncated: false,
      },
      {
        unitId: 'unit_d2',
        stratumId: 'stratum_d',
        stratumDimensions: {
          asset_category: 'L1_ECO',
          pool_liquidity_depth: 'HIGH',
          creation_age_bucket: 'MATURE_7D',
          launch_venue: 'DIRECT',
          activity_volume_tier: 'HIGH',
          deployer_reputation: 'KNOWN_CLEAN',
          holder_dispersion: 'DISPERSED',
          calendar_regime: 'ACTIVE_HOURS',
        },
        inclusionProbability: 0.01,
        samplingWeight: 100.0,
        rawSuccessValue: 0,
        rawUtilityUsd: -30.0,
        isTruncated: false,
      },
    ],
    // Sum weights = 50+50 + 100+100 + 200+200 + 100+100 = 800
    // Naive success = (1+0 + 1+1 + 0+0 + 1+0) / 8 = 4 / 8 = 0.50
    // Weighted success = (50*1 + 50*0 + 100*1 + 100*1 + 200*0 + 200*0 + 100*1 + 100*0) / 800
    //                  = (50 + 0 + 100 + 100 + 0 + 0 + 100 + 0) / 800 = 350 / 800 = 0.4375
    // Weighted utility sum = 50*120 + 50*(-50) + 100*200 + 100*150 + 200*(-100) + 200*(-100) + 100*80 + 100*(-30)
    //                      = 6000 - 2500 + 20000 + 15000 - 20000 - 20000 + 8000 - 3000 = 3500 USD
    expectedNaiveMean: 0.5,
    expectedHorvitzThompsonWeightedMean: 0.4375,
    expectedWeightedTotalUtility: 3500.0,
    hasWeightStabilityViolation: false,
    hasPositivityViolation: false,
    allowsUniverseWideClaim: true,
    diagnostics: {
      effectiveSampleSize: 5.6888,
      maxWeight: 200.0,
      weightVariance: 2857.14,
      weightSum: 800.0,
    },
  },

  {
    scenarioId: 'sampling_extreme_weight_violation',
    description: 'Sample with near-zero inclusion probability causing unstable exploding weight',
    populationSize: 5000,
    sampleSize: 4,
    maxWeightCeiling: 100.0,
    units: [
      {
        unitId: 'unit_ext_1',
        stratumId: 'stratum_std',
        stratumDimensions: { asset_category: 'MEME' },
        inclusionProbability: 0.05,
        samplingWeight: 20.0,
        rawSuccessValue: 1,
        rawUtilityUsd: 50.0,
        isTruncated: false,
      },
      {
        unitId: 'unit_ext_2',
        stratumId: 'stratum_std',
        stratumDimensions: { asset_category: 'MEME' },
        inclusionProbability: 0.05,
        samplingWeight: 20.0,
        rawSuccessValue: 1,
        rawUtilityUsd: 50.0,
        isTruncated: false,
      },
      {
        unitId: 'unit_ext_3',
        stratumId: 'stratum_std',
        stratumDimensions: { asset_category: 'MEME' },
        inclusionProbability: 0.05,
        samplingWeight: 20.0,
        rawSuccessValue: 0,
        rawUtilityUsd: -50.0,
        isTruncated: false,
      },
      {
        unitId: 'unit_ext_4',
        stratumId: 'stratum_rare',
        stratumDimensions: { asset_category: 'RARE_MICRO_CAP' },
        inclusionProbability: 0.0001, // Extreme weight = 10,000!
        samplingWeight: 10000.0,
        rawSuccessValue: 0,
        rawUtilityUsd: -100.0,
        isTruncated: true,
        truncatedWeight: 100.0,
      },
    ],
    expectedNaiveMean: 0.5,
    expectedHorvitzThompsonWeightedMean: 0.003976, // Dominated by unit 4 unweighted
    expectedWeightedTotalUtility: -999950.0,
    hasWeightStabilityViolation: true,
    hasPositivityViolation: true,
    allowsUniverseWideClaim: false,
    requiredClaimLimitation: 'SAMPLE_STRATUM_COVERAGE_ONLY_WEIGHT_STABILITY_REFUSED',
    diagnostics: {
      effectiveSampleSize: 1.0119,
      maxWeight: 10000.0,
      weightVariance: 24700000.0,
      weightSum: 10060.0,
    },
  },
];
