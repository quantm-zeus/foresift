/**
 * Outcome maturity vectors (§12.8, §68.1, §68.3, FR-MAT-001, FR-MAT-002, FR-MAT-003, AC-123, AC-124).
 * Covers every maturity state, horizon progression, absorbing censor/invalid states,
 * no-reset regression cases, and the 5 censoring + 5 invalid reasons.
 */

export const MATURITY_STATES = [
  'PENDING',
  'PARTIALLY_MATURED',
  'FULLY_MATURED',
  'CENSORED',
  'INVALID_DATA',
] as const;

export type MaturityState = (typeof MATURITY_STATES)[number];

export const CENSOR_REASONS = [
  'RIGHTS_DRIVEN_DELETION',
  'PERMANENT_IDENTITY_AMBIGUITY',
  'UNRECOVERABLE_OBSERVATION_GAP',
  'UNSUPPORTED_HISTORICAL_POOL_STATE',
  'CHAIN_OR_ARCHIVE_UNAVAILABLE',
] as const;

export type CensorReason = (typeof CENSOR_REASONS)[number];

export const INVALID_REASONS = [
  'CORRUPTED_SAMPLING_ASSIGNMENT',
  'IMPOSSIBLE_TIME_ORDER',
  'FAILED_POOL_PARITY',
  'UNRESOLVABLE_DECIMALS',
  'UNESTABLISHED_EVIDENCE_AVAILABILITY',
] as const;

export type InvalidReason = (typeof INVALID_REASONS)[number];

export interface MaturityVectorCase {
  caseId: string;
  profileId: string;
  horizon: string;
  executionScenario: string;
  initialState: MaturityState;
  finalState: MaturityState;
  censorReason?: CensorReason;
  invalidReason?: InvalidReason;
  transitions: readonly {
    step: number;
    from: MaturityState;
    to: MaturityState;
    valid: boolean;
    trigger: string;
  }[];
  isTerminal: boolean;
  canResetOnPolicyChange: boolean;
  canResetOnProviderOutage: boolean;
  eligibleForFinalDenominator: boolean;
  notes: string;
}

export const GOLDEN_MATURITY_VECTORS: readonly MaturityVectorCase[] = [
  // 1. Normal standard progression: PENDING -> PARTIALLY_MATURED -> FULLY_MATURED
  {
    caseId: 'mat_progression_standard_5m',
    profileId: 'HG-EM-1@1',
    horizon: '5m',
    executionScenario: 'EXACT_COORDINATE_FAST',
    initialState: 'PENDING',
    finalState: 'FULLY_MATURED',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'PARTIALLY_MATURED',
        valid: true,
        trigger: 'INTERMEDIATE_WINDOW_ELAPSED',
      },
      {
        step: 2,
        from: 'PARTIALLY_MATURED',
        to: 'FULLY_MATURED',
        valid: true,
        trigger: 'HORIZON_COMPLETED_ALL_OBSERVED',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: true,
    notes: 'Standard successful progression to full maturity',
  },
  {
    caseId: 'mat_progression_standard_1h',
    profileId: 'HG-OG-1@1',
    horizon: '1h',
    executionScenario: 'SLIPPAGE_TOLERANT_ADAPTER',
    initialState: 'PENDING',
    finalState: 'PARTIALLY_MATURED',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'PARTIALLY_MATURED',
        valid: true,
        trigger: 'INTERMEDIATE_15M_OBSERVED',
      },
    ],
    isTerminal: false,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'In-flight partial observation at intermediate window',
  },
  {
    caseId: 'mat_progression_standard_24h',
    profileId: 'HG-LR-1@1',
    horizon: '24h',
    executionScenario: 'CANONICAL_POOL_CONSTRAINED',
    initialState: 'PENDING',
    finalState: 'PENDING',
    transitions: [],
    isTerminal: false,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Freshly registered outcome, horizon just started',
  },

  // 2. Absorbing Censored Cases across the 5 censor reasons (§68.3)
  {
    caseId: 'mat_censor_rights_deletion',
    profileId: 'HG-EM-1@1',
    horizon: '1h',
    executionScenario: 'DEFAULT',
    initialState: 'PENDING',
    finalState: 'CENSORED',
    censorReason: 'RIGHTS_DRIVEN_DELETION',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'CENSORED',
        valid: true,
        trigger: 'RIGHTS_DELETION_RECEIVED',
      },
      {
        step: 2,
        from: 'CENSORED',
        to: 'FULLY_MATURED',
        valid: false,
        trigger: 'ILLEGAL_RESURRECTION_ATTEMPT',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Rights deletion censors the outcome; terminal absorbing state',
  },
  {
    caseId: 'mat_censor_identity_ambiguity',
    profileId: 'HG-SM-1@1',
    horizon: '4h',
    executionScenario: 'EXACT_ROUTE',
    initialState: 'PENDING',
    finalState: 'CENSORED',
    censorReason: 'PERMANENT_IDENTITY_AMBIGUITY',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'CENSORED',
        valid: true,
        trigger: 'MINT_COLLISION_UNRESOLVABLE',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Permanent token identity ambiguity causes censoring',
  },
  {
    caseId: 'mat_censor_observation_gap',
    profileId: 'HG-OG-1@1',
    horizon: '24h',
    executionScenario: 'SLIPPAGE_TOLERANT_ADAPTER',
    initialState: 'PARTIALLY_MATURED',
    finalState: 'CENSORED',
    censorReason: 'UNRECOVERABLE_OBSERVATION_GAP',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'PARTIALLY_MATURED',
        valid: true,
        trigger: 'INTERMEDIATE_TICKS',
      },
      {
        step: 2,
        from: 'PARTIALLY_MATURED',
        to: 'CENSORED',
        valid: true,
        trigger: 'COLLECTOR_GAP_UNRECOVERABLE',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Collector lost contiguous window during observation',
  },
  {
    caseId: 'mat_censor_unsupported_pool_state',
    profileId: 'HG-LR-1@1',
    horizon: '1h',
    executionScenario: 'CANONICAL_POOL_CONSTRAINED',
    initialState: 'PENDING',
    finalState: 'CENSORED',
    censorReason: 'UNSUPPORTED_HISTORICAL_POOL_STATE',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'CENSORED',
        valid: true,
        trigger: 'CORRUPTED_POOL_LAYOUT_V1',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Historical pool layout state unsupported by decoders',
  },
  {
    caseId: 'mat_censor_chain_archive_unavailable',
    profileId: 'RW-CR-1@1',
    horizon: '7d',
    executionScenario: 'MULTI_ROUTE',
    initialState: 'PENDING',
    finalState: 'CENSORED',
    censorReason: 'CHAIN_OR_ARCHIVE_UNAVAILABLE',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'CENSORED',
        valid: true,
        trigger: 'RPC_ARCHIVE_DROPPED_SLOT',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Historical ledger archive missing for slot window',
  },

  // 3. Absorbing Invalid Cases across the 5 invalid reasons (§68.3)
  {
    caseId: 'mat_invalid_corrupted_sampling',
    profileId: 'HG-EM-1@1',
    horizon: '15m',
    executionScenario: 'DEFAULT',
    initialState: 'PENDING',
    finalState: 'INVALID_DATA',
    invalidReason: 'CORRUPTED_SAMPLING_ASSIGNMENT',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'INVALID_DATA',
        valid: true,
        trigger: 'PROBABILITY_OUT_OF_BOUNDS_NAN',
      },
      {
        step: 2,
        from: 'INVALID_DATA',
        to: 'PENDING',
        valid: false,
        trigger: 'ILLEGAL_RESET_ATTEMPT',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Sampling inclusion probability was NaN / invalid',
  },
  {
    caseId: 'mat_invalid_impossible_time_order',
    profileId: 'HG-OG-1@1',
    horizon: '5m',
    executionScenario: 'EXACT_COORDINATE_FAST',
    initialState: 'PENDING',
    finalState: 'INVALID_DATA',
    invalidReason: 'IMPOSSIBLE_TIME_ORDER',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'INVALID_DATA',
        valid: true,
        trigger: 'EXIT_TIME_BEFORE_ACTION_TIME',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Timestamp of outcome event precedes action time',
  },
  {
    caseId: 'mat_invalid_failed_pool_parity',
    profileId: 'HG-SM-1@1',
    horizon: '1h',
    executionScenario: 'CANONICAL_POOL_CONSTRAINED',
    initialState: 'PENDING',
    finalState: 'INVALID_DATA',
    invalidReason: 'FAILED_POOL_PARITY',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'INVALID_DATA',
        valid: true,
        trigger: 'RESERVE_INVARIANT_VIOLATED',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Pool math failed invariant / constant product check',
  },
  {
    caseId: 'mat_invalid_unresolvable_decimals',
    profileId: 'HG-LR-1@1',
    horizon: '4h',
    executionScenario: 'EXACT_ROUTE',
    initialState: 'PENDING',
    finalState: 'INVALID_DATA',
    invalidReason: 'UNRESOLVABLE_DECIMALS',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'INVALID_DATA',
        valid: true,
        trigger: 'CONFLICTING_MINT_DECIMALS_NO_CONSENSUS',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Conflicting decimal places unable to normalize price',
  },
  {
    caseId: 'mat_invalid_unestablished_evidence',
    profileId: 'RW-CR-1@1',
    horizon: '24h',
    executionScenario: 'MULTI_ROUTE',
    initialState: 'PENDING',
    finalState: 'INVALID_DATA',
    invalidReason: 'UNESTABLISHED_EVIDENCE_AVAILABILITY',
    transitions: [
      {
        step: 1,
        from: 'PENDING',
        to: 'INVALID_DATA',
        valid: true,
        trigger: 'RECEIPT_TIMESTAMP_UNVERIFIED',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: false,
    notes: 'Execution evidence availability cannot be established',
  },

  // 4. No-Reset Regression Cases (§68.1, FR-MAT-001)
  {
    caseId: 'mat_no_reset_after_policy_update',
    profileId: 'HG-EM-1@1',
    horizon: '5m',
    executionScenario: 'DEFAULT',
    initialState: 'FULLY_MATURED',
    finalState: 'FULLY_MATURED',
    transitions: [
      {
        step: 1,
        from: 'FULLY_MATURED',
        to: 'PENDING',
        valid: false,
        trigger: 'EVAL_POLICY_VERSION_BUMP',
      },
      {
        step: 2,
        from: 'FULLY_MATURED',
        to: 'PARTIALLY_MATURED',
        valid: false,
        trigger: 'RECONFIGURATION',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: true,
    notes: 'Matured outcome retains full maturity across policy version increments',
  },
  {
    caseId: 'mat_no_reset_after_provider_outage',
    profileId: 'HG-OG-1@1',
    horizon: '1h',
    executionScenario: 'EXACT_COORDINATE_FAST',
    initialState: 'FULLY_MATURED',
    finalState: 'FULLY_MATURED',
    transitions: [
      {
        step: 1,
        from: 'FULLY_MATURED',
        to: 'CENSORED',
        valid: false,
        trigger: 'RPC_OUTAGE_POST_MATURITY',
      },
    ],
    isTerminal: true,
    canResetOnPolicyChange: false,
    canResetOnProviderOutage: false,
    eligibleForFinalDenominator: true,
    notes: 'Subsequent provider downtime does not retroactively censor matured outcomes',
  },
];
