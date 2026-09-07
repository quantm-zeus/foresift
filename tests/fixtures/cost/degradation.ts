/**
 * Degradation order and policy test fixtures (PRD §62.8, FR-COST-015, AC-104, AC-228).
 * Provides §62.8 sequencing vectors, protected preservation vectors, and never-pay-silently refusal fixtures.
 */
// @ts-expect-error - Domain vocabulary & policy pending in parallel wave (T001/T003)
import { DEFAULT_POLICY_V1, PROTECTED_STEPS, type DegradationStep } from '@foresift/domain';

export const CANONICAL_DEGRADATION_SEQUENCE: readonly DegradationStep[] = DEFAULT_POLICY_V1;

export const NON_CRITICAL_DEGRADATION_STEPS: readonly DegradationStep[] = DEFAULT_POLICY_V1.slice(0, 9);

export const CRITICAL_PROTECTED_STEPS: readonly DegradationStep[] = PROTECTED_STEPS;

export const DEGRADATION_SCENARIOS = {
  INITIAL_EXHAUSTION: {
    activeSteps: [] as DegradationStep[],
    expectedNextStep: 'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL' as DegradationStep,
  },
  INTERMEDIATE_PRESSURE: {
    activeSteps: [
      'SKIP_ENRICHMENT_NOTEBOOK_ANALOG_COUNTERFACTUAL',
      'REDUCE_SOCIAL_NARRATIVE_DEPTH',
      'REDUCE_WALLET_HISTORY_DEPTH',
    ] as DegradationStep[],
    expectedNextStep: 'REDUCE_DEEP_RESEARCH_CANDIDATE_COUNT' as DegradationStep,
  },
  CRITICAL_FLOOR_REACHED: {
    activeSteps: NON_CRITICAL_DEGRADATION_STEPS,
    expectedNextStep: 'PRESERVE_CRITICAL_OBLIGATIONS' as DegradationStep,
  },
  TERMINAL_EXHAUSTION: {
    activeSteps: [
      ...NON_CRITICAL_DEGRADATION_STEPS,
      'PRESERVE_CRITICAL_OBLIGATIONS',
    ] as DegradationStep[],
    expectedNextStep: 'RETURN_PARTIAL_INSUFFICIENT_DATA' as DegradationStep,
  },
};

export const PROTECTED_WORKLOADS_PRESERVED_FIXTURE = [
  'RISK_MONITORING',
  'ALERT_VERIFICATION',
  'FIRST_PARTY_COLLECTOR',
  'OUTCOME_COLLECTION',
  'INTERACTIVE_MCP',
  'EMERGENCY_BACKFILL',
] as const;
