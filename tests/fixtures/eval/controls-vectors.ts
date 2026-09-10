/**
 * Negative controls and statistical integrity vectors (§31.13, §68.5, FR-MAT-004, AC-150).
 * Covers the 9 canonical §68.5 negative control families:
 * 1. Outcome-label permutation
 * 2. Feature timestamp shift
 * 3. Delayed-provider placebo
 * 4. Backfilled-availability placebo
 * 5. Synthetic null features
 * 6. Forbidden future/outcome-column scan
 * 7. Same-asset/entity/overlapping-window leakage scan
 * 8. Provider/source-ID-only predictor
 * 9. Randomized model-output / tool-selection control
 * Evaluates seed determinism, expected no-material-lift bounds, and incident emission triggers.
 */

export const NEGATIVE_CONTROL_TYPES = [
  'OUTCOME_LABEL_PERMUTATION',
  'FEATURE_TIMESTAMP_SHIFT',
  'DELAYED_PROVIDER_PLACEBO',
  'BACKFILLED_AVAILABILITY_PLACEBO',
  'SYNTHETIC_NULL_FEATURES',
  'FORBIDDEN_FUTURE_SCAN',
  'OVERLAPPING_WINDOW_LEAKAGE_SCAN',
  'PROVIDER_ID_ONLY_PREDICTOR',
  'RANDOMIZED_OUTPUT_CONTROL',
] as const;

export type NegativeControlType = (typeof NEGATIVE_CONTROL_TYPES)[number];

export interface ControlRunRecord {
  runId: string;
  controlType: NegativeControlType;
  seed: number;
  sampleCount: number;
  baselineExpectancyUsd: number;
  controlExpectancyUsd: number;
  measuredLiftUsd: number; // control - baseline
  maxAllowedLiftUsd: number; // typically near zero or confidence threshold
  hasMaterialLift: boolean;
  verdict: 'PASS_NO_MATERIAL_LIFT' | 'FAIL_MATERIAL_LIFT_LEAKAGE_DETECTED';
  shouldTriggerIncident: boolean;
  incidentType?: string;
  notes: string;
}

export const GOLDEN_CONTROL_CASES: readonly ControlRunRecord[] = [
  // 1. Label permutation control - PASS (no lift on permuted labels)
  {
    runId: 'ctrl_perm_clean_001',
    controlType: 'OUTCOME_LABEL_PERMUTATION',
    seed: 424242,
    sampleCount: 1000,
    baselineExpectancyUsd: 0.0,
    controlExpectancyUsd: -5.2,
    measuredLiftUsd: -5.2,
    maxAllowedLiftUsd: 15.0,
    hasMaterialLift: false,
    verdict: 'PASS_NO_MATERIAL_LIFT',
    shouldTriggerIncident: false,
    notes: 'Model shows 0 lift on randomized outcome labels as expected',
  },

  // 2. Feature timestamp shift control - PASS
  {
    runId: 'ctrl_shift_clean_002',
    controlType: 'FEATURE_TIMESTAMP_SHIFT',
    seed: 123456,
    sampleCount: 1000,
    baselineExpectancyUsd: 0.0,
    controlExpectancyUsd: 2.1,
    measuredLiftUsd: 2.1,
    maxAllowedLiftUsd: 15.0,
    hasMaterialLift: false,
    verdict: 'PASS_NO_MATERIAL_LIFT',
    shouldTriggerIncident: false,
    notes: 'Features shifted by +60s show no forward predictive advantage',
  },

  // 3. Delayed-provider placebo - PASS
  {
    runId: 'ctrl_delayed_placebo_clean_003',
    controlType: 'DELAYED_PROVIDER_PLACEBO',
    seed: 998877,
    sampleCount: 800,
    baselineExpectancyUsd: 0.0,
    controlExpectancyUsd: -12.0,
    measuredLiftUsd: -12.0,
    maxAllowedLiftUsd: 10.0,
    hasMaterialLift: false,
    verdict: 'PASS_NO_MATERIAL_LIFT',
    shouldTriggerIncident: false,
    notes: 'Artificial 5-minute latency delay degrades model edge completely',
  },

  // 4. Backfilled-availability placebo - LEAKAGE DETECTED (FAIL)
  {
    runId: 'ctrl_backfill_leakage_fail_004',
    controlType: 'BACKFILLED_AVAILABILITY_PLACEBO',
    seed: 554433,
    sampleCount: 800,
    baselineExpectancyUsd: 0.0,
    controlExpectancyUsd: 350.0, // Massive fake lift!
    measuredLiftUsd: 350.0,
    maxAllowedLiftUsd: 20.0,
    hasMaterialLift: true,
    verdict: 'FAIL_MATERIAL_LIFT_LEAKAGE_DETECTED',
    shouldTriggerIncident: true,
    incidentType: 'BACKFILLED_AVAILABILITY_LEAKAGE_INCIDENT',
    notes: 'Model accessed data unavailable at decision time, creating illusion of high return',
  },

  // 5. Synthetic null features - PASS
  {
    runId: 'ctrl_null_features_clean_005',
    controlType: 'SYNTHETIC_NULL_FEATURES',
    seed: 112233,
    sampleCount: 1200,
    baselineExpectancyUsd: 0.0,
    controlExpectancyUsd: -1.5,
    measuredLiftUsd: -1.5,
    maxAllowedLiftUsd: 15.0,
    hasMaterialLift: false,
    verdict: 'PASS_NO_MATERIAL_LIFT',
    shouldTriggerIncident: false,
    notes: 'Null Gaussian noise inputs generate no spurious signal',
  },

  // 6. Forbidden future / outcome-column scan - LEAKAGE DETECTED (FAIL)
  {
    runId: 'ctrl_future_scan_fail_006',
    controlType: 'FORBIDDEN_FUTURE_SCAN',
    seed: 778899,
    sampleCount: 500,
    baselineExpectancyUsd: 0.0,
    controlExpectancyUsd: 820.0,
    measuredLiftUsd: 820.0,
    maxAllowedLiftUsd: 5.0,
    hasMaterialLift: true,
    verdict: 'FAIL_MATERIAL_LIFT_LEAKAGE_DETECTED',
    shouldTriggerIncident: true,
    incidentType: 'LOOKAHEAD_FEATURE_LEAKAGE_INCIDENT',
    notes: 'Column scan detected target exit price in training feature matrix',
  },

  // 7. Provider-ID-only predictor - PASS
  {
    runId: 'ctrl_provider_id_clean_007',
    controlType: 'PROVIDER_ID_ONLY_PREDICTOR',
    seed: 334455,
    sampleCount: 1000,
    baselineExpectancyUsd: 0.0,
    controlExpectancyUsd: 3.4,
    measuredLiftUsd: 3.4,
    maxAllowedLiftUsd: 15.0,
    hasMaterialLift: false,
    verdict: 'PASS_NO_MATERIAL_LIFT',
    shouldTriggerIncident: false,
    notes: 'Model cannot learn spurious predictive edge solely from provider metadata ID',
  },
];
