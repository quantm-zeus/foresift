/**
 * Outcome profile definitions and vectors (§8.3–§8.9, FR-EVAL-001, AC-040).
 * Defines canonical versioned outcome profiles:
 * - `HG-EM-1@1` (Early Meme Gem)
 * - `HG-OG-1@1` (Organic Growth Gem)
 * - `HG-SM-1@1` (Independent Wallet Accumulation)
 * - `HG-LR-1@1` (Lower-Risk Emerging Asset)
 * - `RW-CR-1@1` (Critical Risk Warning)
 * Covers population scopes, clauses, and stress pass matrices.
 */

export interface ProfileClause {
  clauseId: string;
  clauseType: 'SUCCESS' | 'FAILURE' | 'NEUTRAL';
  condition: string;
  thresholdValue: number;
  thresholdUnit: 'MULTIPLE' | 'PERCENT' | 'USD' | 'SECONDS';
  horizonSeconds: number;
}

export interface StressMatrixDimension {
  dimensionName: 'SLIPPAGE' | 'LATENCY_DELAY' | 'POOL_IMPACT' | 'FEE_SPIKE';
  baselineValue: number;
  stressValue: number;
  minPassRatePct: number;
}

export interface OutcomeProfileDefinition {
  profileId: string;
  profileName: string;
  version: string;
  family: 'HIGH_GROWTH' | 'RISK_WARNING';
  populationScope: string;
  description: string;
  horizons: readonly string[];
  clauses: readonly ProfileClause[];
  stressPassMatrix: readonly StressMatrixDimension[];
  isVersionLocked: boolean;
}

export const GOLDEN_PROFILES: readonly OutcomeProfileDefinition[] = [
  // 1. Early Meme Gem (HG-EM-1@1) (§8.3)
  {
    profileId: 'HG-EM-1@1',
    profileName: 'Early Meme Gem',
    version: '1.0.0',
    family: 'HIGH_GROWTH',
    populationScope: 'SOLANA_BONDING_CURVE_AND_NEW_POOLS',
    description:
      'Rapid upward movement in newly launched meme tokens within early lifecycle windows',
    horizons: ['5m', '15m', '1h', '4h'],
    clauses: [
      {
        clauseId: 'em_success_3x_15m',
        clauseType: 'SUCCESS',
        condition: 'PRICE_EXCEEDS_MULTIPLE_WITHIN_HORIZON',
        thresholdValue: 3.0,
        thresholdUnit: 'MULTIPLE',
        horizonSeconds: 900,
      },
      {
        clauseId: 'em_fail_rug_or_90pct_drop',
        clauseType: 'FAILURE',
        condition: 'DRAWDOWN_EXCEEDS_THRESHOLD_OR_POOL_DRAINED',
        thresholdValue: 90.0,
        thresholdUnit: 'PERCENT',
        horizonSeconds: 900,
      },
      {
        clauseId: 'em_neutral_flat',
        clauseType: 'NEUTRAL',
        condition: 'RETURN_WITHIN_BAND_AT_HORIZON',
        thresholdValue: 10.0,
        thresholdUnit: 'PERCENT',
        horizonSeconds: 900,
      },
    ],
    stressPassMatrix: [
      { dimensionName: 'SLIPPAGE', baselineValue: 1.0, stressValue: 5.0, minPassRatePct: 70.0 },
      { dimensionName: 'LATENCY_DELAY', baselineValue: 50, stressValue: 500, minPassRatePct: 65.0 },
      { dimensionName: 'POOL_IMPACT', baselineValue: 0.5, stressValue: 3.0, minPassRatePct: 60.0 },
      { dimensionName: 'FEE_SPIKE', baselineValue: 0.001, stressValue: 0.01, minPassRatePct: 80.0 },
    ],
    isVersionLocked: true,
  },

  // 2. Organic Growth Gem (HG-OG-1@1) (§8.4)
  {
    profileId: 'HG-OG-1@1',
    profileName: 'Organic Growth Gem',
    version: '1.0.0',
    family: 'HIGH_GROWTH',
    populationScope: 'SOLANA_GRADUATED_RAYDIUM_POOLS',
    description: 'Sustained liquidity and volume accumulation across multi-hour horizons',
    horizons: ['1h', '4h', '24h', '7d'],
    clauses: [
      {
        clauseId: 'og_success_2x_24h',
        clauseType: 'SUCCESS',
        condition: 'PRICE_EXCEEDS_MULTIPLE_WITH_VOLUME_CONFIRMATION',
        thresholdValue: 2.0,
        thresholdUnit: 'MULTIPLE',
        horizonSeconds: 86400,
      },
      {
        clauseId: 'og_fail_50pct_drawdown',
        clauseType: 'FAILURE',
        condition: 'DRAWDOWN_EXCEEDS_50PCT',
        thresholdValue: 50.0,
        thresholdUnit: 'PERCENT',
        horizonSeconds: 86400,
      },
    ],
    stressPassMatrix: [
      { dimensionName: 'SLIPPAGE', baselineValue: 0.5, stressValue: 2.0, minPassRatePct: 85.0 },
      {
        dimensionName: 'LATENCY_DELAY',
        baselineValue: 100,
        stressValue: 1000,
        minPassRatePct: 80.0,
      },
      { dimensionName: 'POOL_IMPACT', baselineValue: 0.2, stressValue: 1.5, minPassRatePct: 75.0 },
      {
        dimensionName: 'FEE_SPIKE',
        baselineValue: 0.001,
        stressValue: 0.005,
        minPassRatePct: 90.0,
      },
    ],
    isVersionLocked: true,
  },

  // 3. Independent Wallet Accumulation (HG-SM-1@1) (§8.5)
  {
    profileId: 'HG-SM-1@1',
    profileName: 'Independent Wallet Accumulation',
    version: '1.0.0',
    family: 'HIGH_GROWTH',
    populationScope: 'ALL_SUPPORTED_SOLANA_TOKENS',
    description:
      'Clusters of distinct non-funded wallets building positions without coordinated dump',
    horizons: ['4h', '24h', '48h'],
    clauses: [
      {
        clauseId: 'sm_success_wallet_count_and_retention',
        clauseType: 'SUCCESS',
        condition: 'UNIQUE_BUYERS_EXCEED_THRESHOLD_AND_PRICE_UP',
        thresholdValue: 50.0,
        thresholdUnit: 'PERCENT',
        horizonSeconds: 86400,
      },
      {
        clauseId: 'sm_fail_coordinated_sybil_dump',
        clauseType: 'FAILURE',
        condition: 'COMMON_FUNDING_SOURCE_SELL_DUMP',
        thresholdValue: 30.0,
        thresholdUnit: 'PERCENT',
        horizonSeconds: 86400,
      },
    ],
    stressPassMatrix: [
      { dimensionName: 'SLIPPAGE', baselineValue: 1.0, stressValue: 3.0, minPassRatePct: 80.0 },
      {
        dimensionName: 'LATENCY_DELAY',
        baselineValue: 100,
        stressValue: 500,
        minPassRatePct: 80.0,
      },
      { dimensionName: 'POOL_IMPACT', baselineValue: 0.5, stressValue: 2.0, minPassRatePct: 75.0 },
      { dimensionName: 'FEE_SPIKE', baselineValue: 0.001, stressValue: 0.01, minPassRatePct: 85.0 },
    ],
    isVersionLocked: true,
  },

  // 4. Lower-Risk Emerging Asset (HG-LR-1@1) (§8.6)
  {
    profileId: 'HG-LR-1@1',
    profileName: 'Lower-Risk Emerging Asset',
    version: '1.0.0',
    family: 'HIGH_GROWTH',
    populationScope: 'SOLANA_VERIFIED_POOLS_MIN_LIQUIDITY_50K',
    description: 'Higher liquidity baseline with locked authority and audited program metadata',
    horizons: ['1h', '4h', '24h', '7d'],
    clauses: [
      {
        clauseId: 'lr_success_50pct_gain_with_low_drawdown',
        clauseType: 'SUCCESS',
        condition: 'MODERATE_GAIN_LOW_VOLATILITY',
        thresholdValue: 1.5,
        thresholdUnit: 'MULTIPLE',
        horizonSeconds: 86400,
      },
      {
        clauseId: 'lr_fail_25pct_drop',
        clauseType: 'FAILURE',
        condition: 'DRAWDOWN_EXCEEDS_25PCT',
        thresholdValue: 25.0,
        thresholdUnit: 'PERCENT',
        horizonSeconds: 86400,
      },
    ],
    stressPassMatrix: [
      { dimensionName: 'SLIPPAGE', baselineValue: 0.2, stressValue: 1.0, minPassRatePct: 90.0 },
      { dimensionName: 'LATENCY_DELAY', baselineValue: 50, stressValue: 200, minPassRatePct: 90.0 },
      { dimensionName: 'POOL_IMPACT', baselineValue: 0.1, stressValue: 0.5, minPassRatePct: 85.0 },
      {
        dimensionName: 'FEE_SPIKE',
        baselineValue: 0.0005,
        stressValue: 0.002,
        minPassRatePct: 95.0,
      },
    ],
    isVersionLocked: true,
  },

  // 5. Critical Risk Warning (RW-CR-1@1) (§8.7)
  {
    profileId: 'RW-CR-1@1',
    profileName: 'Critical Risk Warning',
    version: '1.0.0',
    family: 'RISK_WARNING',
    populationScope: 'ALL_SUPPORTED_SOLANA_TOKENS',
    description:
      'Detection of imminent malicious drain, hidden mint authority, or extreme sell restriction',
    horizons: ['5m', '15m', '1h', '24h'],
    clauses: [
      {
        clauseId: 'cr_success_avoided_drain',
        clauseType: 'SUCCESS',
        condition: 'CONFIRMED_RUG_OR_FREEZE_WITHIN_HORIZON',
        thresholdValue: 1.0,
        thresholdUnit: 'MULTIPLE',
        horizonSeconds: 3600,
      },
      {
        clauseId: 'cr_fail_false_positive_clean_token',
        clauseType: 'FAILURE',
        condition: 'TOKEN_TRADES_CLEANLY_AND_GROWS_ORGANICALLY',
        thresholdValue: 0.0,
        thresholdUnit: 'PERCENT',
        horizonSeconds: 86400,
      },
    ],
    stressPassMatrix: [
      { dimensionName: 'SLIPPAGE', baselineValue: 1.0, stressValue: 5.0, minPassRatePct: 95.0 },
      { dimensionName: 'LATENCY_DELAY', baselineValue: 20, stressValue: 100, minPassRatePct: 90.0 },
      { dimensionName: 'POOL_IMPACT', baselineValue: 1.0, stressValue: 5.0, minPassRatePct: 90.0 },
      { dimensionName: 'FEE_SPIKE', baselineValue: 0.001, stressValue: 0.05, minPassRatePct: 95.0 },
    ],
    isVersionLocked: true,
  },
];
