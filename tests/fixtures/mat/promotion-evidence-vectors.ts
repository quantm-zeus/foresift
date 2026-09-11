/**
 * Promotion evidence vectors (FR-MAT-008, FR-MAT-009, FR-MAT-011, FR-MAT-012, AC-152).
 * Covers:
 * - Exact-configuration match vs mismatch (notional, delay, adapter, route, exit policy)
 * - Coarse-only evidence refusals (cannot substitute for high-res execution data)
 * - Adverse vs optimistic path ordering resolution (FR-MAT-009)
 * - Expiry / cancellation / invalidation side-effects with post-expiry gain exclusion (FR-MAT-011)
 * - Capacity-limited opportunities with notional / capacity disclosures (FR-MAT-012)
 */

export interface ExecutionConfiguration {
  notionalUsd: number;
  delayPolicy: 'ZERO_DELAY_IDEAL' | 'DELIBERATE_100MS_DELAY' | 'CONFIRMATION_SLOT_DELAY';
  adapter: 'RAYDIUM_AMM' | 'PUMP_BONDING_CURVE' | 'ORCA_WHIRLPOOL' | 'JUPITER_ROUTED';
  route: readonly string[];
  exitPolicy: 'TRAILING_STOP_10PCT' | 'FIXED_TARGET_30PCT' | 'TIME_HORIZON_1H';
}

export interface PromotionEvidenceCase {
  caseId: string;
  description: string;
  requestedConfig: ExecutionConfiguration;
  evidenceConfig: ExecutionConfiguration;
  evidenceResolution: 'HIGH_RESOLUTION_EXECUTION_TRACE' | 'COARSE_PRICE_FEED_ONLY';
  evidenceMaturityState: 'FULLY_MATURED' | 'PARTIALLY_MATURED' | 'PENDING';
  isExactMatch: boolean;
  mismatchFields: readonly string[];
  supportsPromotion: boolean;
  refusalReason?: string;
  notes: string;
}

export const GOLDEN_PROMOTION_CONFIG_CASES: readonly PromotionEvidenceCase[] = [
  // 1. Exact match with fully matured high-res evidence -> PROMOTION ALLOWED
  {
    caseId: 'promo_exact_match_success',
    description: 'Exact match across all 5 execution dimensions with fully matured high-res trace',
    requestedConfig: {
      notionalUsd: 1000.0,
      delayPolicy: 'DELIBERATE_100MS_DELAY',
      adapter: 'RAYDIUM_AMM',
      route: ['SOL', 'WSOL', 'TOKEN_ABC'],
      exitPolicy: 'FIXED_TARGET_30PCT',
    },
    evidenceConfig: {
      notionalUsd: 1000.0,
      delayPolicy: 'DELIBERATE_100MS_DELAY',
      adapter: 'RAYDIUM_AMM',
      route: ['SOL', 'WSOL', 'TOKEN_ABC'],
      exitPolicy: 'FIXED_TARGET_30PCT',
    },
    evidenceResolution: 'HIGH_RESOLUTION_EXECUTION_TRACE',
    evidenceMaturityState: 'FULLY_MATURED',
    isExactMatch: true,
    mismatchFields: [],
    supportsPromotion: true,
    notes: 'Meets FR-MAT-008 requirements for production promotion evidence',
  },

  // 2. Notional mismatch (small notional cannot generalize to large without proof)
  {
    caseId: 'promo_mismatch_notional',
    description: 'Requested $10,000 notional backed only by $100 notional execution evidence',
    requestedConfig: {
      notionalUsd: 10000.0,
      delayPolicy: 'DELIBERATE_100MS_DELAY',
      adapter: 'RAYDIUM_AMM',
      route: ['SOL', 'TOKEN_ABC'],
      exitPolicy: 'FIXED_TARGET_30PCT',
    },
    evidenceConfig: {
      notionalUsd: 100.0,
      delayPolicy: 'DELIBERATE_100MS_DELAY',
      adapter: 'RAYDIUM_AMM',
      route: ['SOL', 'TOKEN_ABC'],
      exitPolicy: 'FIXED_TARGET_30PCT',
    },
    evidenceResolution: 'HIGH_RESOLUTION_EXECUTION_TRACE',
    evidenceMaturityState: 'FULLY_MATURED',
    isExactMatch: false,
    mismatchFields: ['notionalUsd'],
    supportsPromotion: false,
    refusalReason: 'NOTIONAL_MISMATCH_SIMULATION_REQUIRED',
    notes: 'FR-MAT-012 prevents small-notional evidence from supporting large-capital promotion',
  },

  // 3. Adapter / Route mismatch
  {
    caseId: 'promo_mismatch_adapter_route',
    description: 'Requested Raydium AMM direct but evidence used Jupiter multi-hop routing',
    requestedConfig: {
      notionalUsd: 500.0,
      delayPolicy: 'CONFIRMATION_SLOT_DELAY',
      adapter: 'RAYDIUM_AMM',
      route: ['SOL', 'TOKEN_XYZ'],
      exitPolicy: 'TRAILING_STOP_10PCT',
    },
    evidenceConfig: {
      notionalUsd: 500.0,
      delayPolicy: 'CONFIRMATION_SLOT_DELAY',
      adapter: 'JUPITER_ROUTED',
      route: ['SOL', 'USDC', 'TOKEN_XYZ'],
      exitPolicy: 'TRAILING_STOP_10PCT',
    },
    evidenceResolution: 'HIGH_RESOLUTION_EXECUTION_TRACE',
    evidenceMaturityState: 'FULLY_MATURED',
    isExactMatch: false,
    mismatchFields: ['adapter', 'route'],
    supportsPromotion: false,
    refusalReason: 'EXECUTION_ADAPTER_ROUTE_MISMATCH',
    notes: 'Routing differences introduce slippage/fee variances not captured in evidence',
  },

  // 4. Coarse-only evidence refusal (FR-MAT-008)
  {
    caseId: 'promo_coarse_only_refusal',
    description: 'Coarse price feed candle cannot substitute for high-res tick execution trace',
    requestedConfig: {
      notionalUsd: 1000.0,
      delayPolicy: 'ZERO_DELAY_IDEAL',
      adapter: 'PUMP_BONDING_CURVE',
      route: ['SOL', 'MEME_COIN'],
      exitPolicy: 'FIXED_TARGET_30PCT',
    },
    evidenceConfig: {
      notionalUsd: 1000.0,
      delayPolicy: 'ZERO_DELAY_IDEAL',
      adapter: 'PUMP_BONDING_CURVE',
      route: ['SOL', 'MEME_COIN'],
      exitPolicy: 'FIXED_TARGET_30PCT',
    },
    evidenceResolution: 'COARSE_PRICE_FEED_ONLY',
    evidenceMaturityState: 'FULLY_MATURED',
    isExactMatch: true,
    mismatchFields: [],
    supportsPromotion: false,
    refusalReason: 'COARSE_SIGNAL_CANNOT_SUBSTITUTE_FOR_HIGH_RES_EXECUTION',
    notes: 'FR-MAT-008 strictly forbids coarse price data from supporting promotion',
  },
];

// -----------------------------------------------------------------------------
// Adverse vs Optimistic Path Ordering Vectors (FR-MAT-009)
// -----------------------------------------------------------------------------

export interface PathOrderingCase {
  caseId: string;
  description: string;
  intervalStart: string;
  intervalEnd: string;
  targetPriceUsd: number;
  stopPriceUsd: number;
  intervalHighUsd: number;
  intervalLowUsd: number;
  bothFeasibleInInterval: boolean;
  exactTimestampOrderKnown: boolean;
  actualFirstTouch?: 'TARGET_FIRST' | 'STOP_FIRST';
  primaryVerdict: 'ADVERSE_STOP_OUT' | 'TARGET_REACHED';
  optimisticVerdict: 'TARGET_REACHED';
  pathAmbiguityReported: boolean;
  allowedAsPrimaryPromotionEvidence: boolean;
}

export const GOLDEN_PATH_ORDERING_CASES: readonly PathOrderingCase[] = [
  {
    caseId: 'path_ambiguity_adverse_primacy',
    description:
      'Coarse interval touches both target (+30%) and stop (-15%) without intra-interval timestamps',
    intervalStart: '2026-08-20T10:00:00.000Z',
    intervalEnd: '2026-08-20T10:15:00.000Z',
    targetPriceUsd: 1.3,
    stopPriceUsd: 0.85,
    intervalHighUsd: 1.4, // Target touched
    intervalLowUsd: 0.8, // Stop touched
    bothFeasibleInInterval: true,
    exactTimestampOrderKnown: false,
    primaryVerdict: 'ADVERSE_STOP_OUT',
    optimisticVerdict: 'TARGET_REACHED',
    pathAmbiguityReported: true,
    allowedAsPrimaryPromotionEvidence: false,
  },
  {
    caseId: 'path_unambiguous_high_res_proven',
    description: 'High-res ticks establish target was touched at 10:03 before stop at 10:12',
    intervalStart: '2026-08-20T10:00:00.000Z',
    intervalEnd: '2026-08-20T10:15:00.000Z',
    targetPriceUsd: 1.3,
    stopPriceUsd: 0.85,
    intervalHighUsd: 1.4,
    intervalLowUsd: 0.8,
    bothFeasibleInInterval: true,
    exactTimestampOrderKnown: true,
    actualFirstTouch: 'TARGET_FIRST',
    primaryVerdict: 'TARGET_REACHED',
    optimisticVerdict: 'TARGET_REACHED',
    pathAmbiguityReported: false,
    allowedAsPrimaryPromotionEvidence: true,
  },
];

// -----------------------------------------------------------------------------
// Expiry and Post-Expiry Gain Vectors (FR-MAT-011)
// -----------------------------------------------------------------------------

export interface ExpirySideEffectCase {
  caseId: string;
  alertId: string;
  alertCreatedAt: string;
  alertExpiresAt: string;
  invalidationTriggeredAt?: string;
  invalidationReason?: string;
  postExpiryPeakPriceTime: string;
  postExpiryGainMultiple: number; // e.g. 5x gain after expiry
  actionableSuccessRecorded: boolean;
  gainExcludedReason: string;
  thesisState: 'EXPIRED' | 'INVALIDATED' | 'ACTIVE';
}

export const GOLDEN_EXPIRY_CASES: readonly ExpirySideEffectCase[] = [
  {
    caseId: 'expiry_post_window_pump_excluded',
    alertId: 'alert_em_001',
    alertCreatedAt: '2026-08-20T10:00:00.000Z',
    alertExpiresAt: '2026-08-20T11:00:00.000Z', // 1h horizon
    postExpiryPeakPriceTime: '2026-08-20T13:30:00.000Z', // 2.5h after expiry
    postExpiryGainMultiple: 10.0, // 1000% gain post-expiry
    actionableSuccessRecorded: false,
    gainExcludedReason: 'POST_EXPIRY_GAINS_EXCLUDED_FROM_ACTIONABLE_SUCCESS',
    thesisState: 'EXPIRED',
  },
  {
    caseId: 'expiry_thesis_invalidated_rug',
    alertId: 'alert_og_002',
    alertCreatedAt: '2026-08-20T12:00:00.000Z',
    alertExpiresAt: '2026-08-20T16:00:00.000Z',
    invalidationTriggeredAt: '2026-08-20T12:30:00.000Z',
    invalidationReason: 'MINT_AUTHORITY_REVOKED_FALSE_CLAIM',
    postExpiryPeakPriceTime: '2026-08-20T15:00:00.000Z',
    postExpiryGainMultiple: 2.0,
    actionableSuccessRecorded: false,
    gainExcludedReason: 'THESIS_INVALIDATED_PRIOR_TO_TARGET',
    thesisState: 'INVALIDATED',
  },
];

// -----------------------------------------------------------------------------
// Capacity-Limited Opportunities Vectors (FR-MAT-012)
// -----------------------------------------------------------------------------

export interface CapacityLimitedCase {
  caseId: string;
  assetId: string;
  poolLiquidityUsd: number;
  maxExecutableNotionalUsd: number;
  totalDeployablePortfolioCapacityUsd: number;
  testedNotionalUsd: number;
  testedExecutionReturnPct: number;
  simulatedLargeNotionalUsd: number;
  simulatedLargeNotionalReturnPct: number; // Degraded due to price impact
  generalizationPermittedWithoutSimulation: boolean;
  requiredCapacityDisclosure: {
    poolDepthUsd: number;
    maxSingleTradeUsd: number;
    portfolioCapacityUsd: number;
  };
}

export const GOLDEN_CAPACITY_CASES: readonly CapacityLimitedCase[] = [
  {
    caseId: 'cap_micro_pool_limited',
    assetId: 'token_micro_pump_001',
    poolLiquidityUsd: 15000.0,
    maxExecutableNotionalUsd: 250.0,
    totalDeployablePortfolioCapacityUsd: 1000.0,
    testedNotionalUsd: 100.0,
    testedExecutionReturnPct: 45.0, // +45% at $100
    simulatedLargeNotionalUsd: 5000.0,
    simulatedLargeNotionalReturnPct: -18.0, // -18% at $5k due to massive 60% price impact
    generalizationPermittedWithoutSimulation: false,
    requiredCapacityDisclosure: {
      poolDepthUsd: 15000.0,
      maxSingleTradeUsd: 250.0,
      portfolioCapacityUsd: 1000.0,
    },
  },
];
