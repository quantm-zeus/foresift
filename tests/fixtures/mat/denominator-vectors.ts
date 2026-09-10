/**
 * Denominator policy vectors (§68.2, FR-MAT-002, FR-MAT-010, AC-123, AC-124).
 * Covers every FR-MAT-010 excluded class from final denominators:
 * - INVALID_DATA
 * - CENSORED
 * - PARTIALLY_MATURED
 * - LOW_RESOLUTION
 * - RIGHTS_BLOCKED
 * - UNOBSERVED
 * - SIGNAL_ONLY
 * Includes hand-computed expected denominators, breakdown counts, and refusal rules.
 */

export const DENOMINATOR_EXCLUSION_CLASSES = [
  'INVALID_DATA',
  'CENSORED',
  'PARTIALLY_MATURED',
  'LOW_RESOLUTION',
  'RIGHTS_BLOCKED',
  'UNOBSERVED',
  'SIGNAL_ONLY',
] as const;

export type DenominatorExclusionClass = (typeof DENOMINATOR_EXCLUSION_CLASSES)[number];

export interface OutcomeRecord {
  outcomeId: string;
  assetId: string;
  profileId: string;
  horizon: string;
  maturityState: 'PENDING' | 'PARTIALLY_MATURED' | 'FULLY_MATURED' | 'CENSORED' | 'INVALID_DATA';
  resolution: 'HIGH_RESOLUTION' | 'LOW_RESOLUTION_COARSE';
  rightsStatus: 'CLEAR' | 'RIGHTS_BLOCKED';
  observedState: 'OBSERVED' | 'UNOBSERVED';
  labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' | 'OBJECTIVE_SIGNAL_OUTCOME' | 'SUBJECTIVE_USER_UTILITY';
  isTradableSuccess: boolean;
  exclusionClass?: DenominatorExclusionClass;
}

export interface DenominatorDatasetCase {
  datasetId: string;
  description: string;
  totalRegistered: number;
  records: readonly OutcomeRecord[];
  expectedBreakdown: Record<DenominatorExclusionClass, number>;
  expectedFullyMaturedTradableCount: number;
  expectedFinalDenominator: number;
  expectedProvisionalDenominator: number;
  expectedRefusalOnIncomplete: boolean;
  refusalReason?: string;
}

export const GOLDEN_DENOMINATOR_DATASETS: readonly DenominatorDatasetCase[] = [
  {
    datasetId: 'denom_mixed_standard_100',
    description: 'Mixed population of 100 registered outcomes across all 7 exclusion classes and fully matured items',
    totalRegistered: 100,
    records: [
      // 40 fully matured valid high-res tradable outcomes (the valid denominator)
      ...Array.from({ length: 40 }, (_, i) => ({
        outcomeId: `out_matured_valid_${i + 1}`,
        assetId: `asset_valid_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'FULLY_MATURED' as const,
        resolution: 'HIGH_RESOLUTION' as const,
        rightsStatus: 'CLEAR' as const,
        observedState: 'OBSERVED' as const,
        labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
        isTradableSuccess: i % 2 === 0, // 20 success, 20 failure
      })),

      // 10 INVALID_DATA
      ...Array.from({ length: 10 }, (_, i) => ({
        outcomeId: `out_invalid_${i + 1}`,
        assetId: `asset_invalid_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'INVALID_DATA' as const,
        resolution: 'HIGH_RESOLUTION' as const,
        rightsStatus: 'CLEAR' as const,
        observedState: 'OBSERVED' as const,
        labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
        isTradableSuccess: false,
        exclusionClass: 'INVALID_DATA' as const,
      })),

      // 10 CENSORED
      ...Array.from({ length: 10 }, (_, i) => ({
        outcomeId: `out_censored_${i + 1}`,
        assetId: `asset_censored_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'CENSORED' as const,
        resolution: 'HIGH_RESOLUTION' as const,
        rightsStatus: 'CLEAR' as const,
        observedState: 'OBSERVED' as const,
        labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
        isTradableSuccess: false,
        exclusionClass: 'CENSORED' as const,
      })),

      // 10 PARTIALLY_MATURED
      ...Array.from({ length: 10 }, (_, i) => ({
        outcomeId: `out_partial_${i + 1}`,
        assetId: `asset_partial_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'PARTIALLY_MATURED' as const,
        resolution: 'HIGH_RESOLUTION' as const,
        rightsStatus: 'CLEAR' as const,
        observedState: 'OBSERVED' as const,
        labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
        isTradableSuccess: false,
        exclusionClass: 'PARTIALLY_MATURED' as const,
      })),

      // 10 LOW_RESOLUTION (coarse only)
      ...Array.from({ length: 10 }, (_, i) => ({
        outcomeId: `out_lowres_${i + 1}`,
        assetId: `asset_lowres_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'FULLY_MATURED' as const,
        resolution: 'LOW_RESOLUTION_COARSE' as const,
        rightsStatus: 'CLEAR' as const,
        observedState: 'OBSERVED' as const,
        labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
        isTradableSuccess: false,
        exclusionClass: 'LOW_RESOLUTION' as const,
      })),

      // 8 RIGHTS_BLOCKED
      ...Array.from({ length: 8 }, (_, i) => ({
        outcomeId: `out_rights_${i + 1}`,
        assetId: `asset_rights_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'FULLY_MATURED' as const,
        resolution: 'HIGH_RESOLUTION' as const,
        rightsStatus: 'RIGHTS_BLOCKED' as const,
        observedState: 'OBSERVED' as const,
        labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
        isTradableSuccess: false,
        exclusionClass: 'RIGHTS_BLOCKED' as const,
      })),

      // 7 UNOBSERVED (unobserved due to capacity/quota exhaustion)
      ...Array.from({ length: 7 }, (_, i) => ({
        outcomeId: `out_unobserved_${i + 1}`,
        assetId: `asset_unobserved_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'PENDING' as const,
        resolution: 'HIGH_RESOLUTION' as const,
        rightsStatus: 'CLEAR' as const,
        observedState: 'UNOBSERVED' as const,
        labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
        isTradableSuccess: false,
        exclusionClass: 'UNOBSERVED' as const,
      })),

      // 5 SIGNAL_ONLY (objective signal outcome without tradability evidence)
      ...Array.from({ length: 5 }, (_, i) => ({
        outcomeId: `out_signal_only_${i + 1}`,
        assetId: `asset_signal_only_${i + 1}`,
        profileId: 'HG-EM-1@1',
        horizon: '1h',
        maturityState: 'FULLY_MATURED' as const,
        resolution: 'HIGH_RESOLUTION' as const,
        rightsStatus: 'CLEAR' as const,
        observedState: 'OBSERVED' as const,
        labelPlane: 'OBJECTIVE_SIGNAL_OUTCOME' as const,
        isTradableSuccess: false,
        exclusionClass: 'SIGNAL_ONLY' as const,
      })),
    ],
    expectedBreakdown: {
      INVALID_DATA: 10,
      CENSORED: 10,
      PARTIALLY_MATURED: 10,
      LOW_RESOLUTION: 10,
      RIGHTS_BLOCKED: 8,
      UNOBSERVED: 7,
      SIGNAL_ONLY: 5,
    },
    expectedFullyMaturedTradableCount: 40,
    expectedFinalDenominator: 40,
    expectedProvisionalDenominator: 100,
    expectedRefusalOnIncomplete: false,
  },

  {
    datasetId: 'denom_all_pending_refusal',
    description: 'Dataset where all outcomes are still pending / partial — final metrics MUST refuse',
    totalRegistered: 25,
    records: Array.from({ length: 25 }, (_, i) => ({
      outcomeId: `out_pending_${i + 1}`,
      assetId: `asset_pending_${i + 1}`,
      profileId: 'HG-OG-1@1',
      horizon: '24h',
      maturityState: (i % 2 === 0 ? 'PENDING' : 'PARTIALLY_MATURED') as 'PENDING' | 'PARTIALLY_MATURED',
      resolution: 'HIGH_RESOLUTION' as const,
      rightsStatus: 'CLEAR' as const,
      observedState: 'OBSERVED' as const,
      labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
      isTradableSuccess: false,
      exclusionClass: (i % 2 === 0 ? 'UNOBSERVED' : 'PARTIALLY_MATURED') as DenominatorExclusionClass,
    })),
    expectedBreakdown: {
      INVALID_DATA: 0,
      CENSORED: 0,
      PARTIALLY_MATURED: 12,
      LOW_RESOLUTION: 0,
      RIGHTS_BLOCKED: 0,
      UNOBSERVED: 13,
      SIGNAL_ONLY: 0,
    },
    expectedFullyMaturedTradableCount: 0,
    expectedFinalDenominator: 0,
    expectedProvisionalDenominator: 25,
    expectedRefusalOnIncomplete: true,
    refusalReason: 'ZERO_FULLY_MATURED_OUTCOMES_FOR_FINAL_DENOMINATOR',
  },

  {
    datasetId: 'denom_pure_clean_matured',
    description: 'Dataset where 100% of outcomes are fully matured and valid (no exclusions)',
    totalRegistered: 50,
    records: Array.from({ length: 50 }, (_, i) => ({
      outcomeId: `out_clean_${i + 1}`,
      assetId: `asset_clean_${i + 1}`,
      profileId: 'RW-CR-1@1',
      horizon: '4h',
      maturityState: 'FULLY_MATURED' as const,
      resolution: 'HIGH_RESOLUTION' as const,
      rightsStatus: 'CLEAR' as const,
      observedState: 'OBSERVED' as const,
      labelPlane: 'OBJECTIVE_TRADABLE_OUTCOME' as const,
      isTradableSuccess: i < 30, // 30 success, 20 failure
    })),
    expectedBreakdown: {
      INVALID_DATA: 0,
      CENSORED: 0,
      PARTIALLY_MATURED: 0,
      LOW_RESOLUTION: 0,
      RIGHTS_BLOCKED: 0,
      UNOBSERVED: 0,
      SIGNAL_ONLY: 0,
    },
    expectedFullyMaturedTradableCount: 50,
    expectedFinalDenominator: 50,
    expectedProvisionalDenominator: 50,
    expectedRefusalOnIncomplete: false,
  },
];
