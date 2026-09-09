/**
 * Chain access declaration and consumption fixtures (FR-DISC-008 selective verification/backfill).
 * Bounded valid, unbounded refusal, paid-fallback refusal, reserve-incompatible refusal,
 * tolerance-breach incident, and silent-widening refusal vectors.
 * Traces: FR-DISC-008.
 */
import type { UtcTimestamp } from '@foresift/domain';

export type ChainAccessMode =
  | 'SELECTIVE_VERIFICATION'
  | 'BOUNDED_BACKFILL'
  | 'HISTORICAL_SAMPLE'
  | 'UNAUTHORIZED_BROAD_INGESTION';

export const ALL_CHAIN_ACCESS_MODES: readonly ChainAccessMode[] = [
  'SELECTIVE_VERIFICATION',
  'BOUNDED_BACKFILL',
  'HISTORICAL_SAMPLE',
  'UNAUTHORIZED_BROAD_INGESTION',
];

export type ChainAccessCostClass =
  | 'FREE_UNMETERED'
  | 'FREE_QUOTA'
  | 'PAID_EXPLICIT'
  | 'UNKNOWN_COST';

export const ALL_CHAIN_ACCESS_COST_CLASSES: readonly ChainAccessCostClass[] = [
  'FREE_UNMETERED',
  'FREE_QUOTA',
  'PAID_EXPLICIT',
  'UNKNOWN_COST',
];

export interface ChainAccessDeclarationFixture {
  readonly declarationId: string;
  readonly mode: ChainAccessMode;
  readonly costClass: ChainAccessCostClass;
  readonly purpose: string;
  readonly candidateIds: readonly string[];
  readonly startSlot?: string;
  readonly endSlot?: string;
  readonly maxCalls: number;
  readonly maxCredits: number;
  readonly toleranceFraction: number;
  readonly reserveId?: string;
  readonly paidPolicyApproved: boolean;
  readonly declaredAt: UtcTimestamp;
}

export interface ChainAccessConsumptionRecord {
  readonly declarationId: string;
  readonly actualCalls: number;
  readonly actualCredits: number;
  readonly breachDetected: boolean;
  readonly incidentId?: string;
  readonly consumedAt: UtcTimestamp;
}

// -----------------------------------------------------------------------------
// 1. Valid bounded selective verification & backfill vectors
// -----------------------------------------------------------------------------

export const BOUNDED_VALID_SELECTIVE_ACCESS: ChainAccessDeclarationFixture = {
  declarationId: 'cad_selective_verify_001',
  mode: 'SELECTIVE_VERIFICATION',
  costClass: 'FREE_QUOTA',
  purpose: 'Selective verification of promoted Pump candidate state',
  candidateIds: ['asset_rep_sol_pump_001', 'asset_rep_sol_raydium_002'],
  startSlot: '300100200',
  endSlot: '300100300',
  maxCalls: 10,
  maxCredits: 100,
  toleranceFraction: 0.05,
  paidPolicyApproved: false,
  declaredAt: '2026-08-20T10:00:00Z' as UtcTimestamp,
};

export const BOUNDED_VALID_BACKFILL_ACCESS: ChainAccessDeclarationFixture = {
  declarationId: 'cad_bounded_backfill_002',
  mode: 'BOUNDED_BACKFILL',
  costClass: 'FREE_QUOTA',
  purpose: 'Bounded gap recovery for slot window 300100101-300100104',
  candidateIds: [],
  startSlot: '300100101',
  endSlot: '300100104',
  maxCalls: 20,
  maxCredits: 200,
  toleranceFraction: 0.1,
  reserveId: 'EMERGENCY_BACKFILL',
  paidPolicyApproved: false,
  declaredAt: '2026-08-20T10:00:05Z' as UtcTimestamp,
};

// -----------------------------------------------------------------------------
// 2. Refusal vectors (FR-DISC-008 anti-patterns)
// -----------------------------------------------------------------------------

export const UNBOUNDED_SWEEP_REFUSAL_ACCESS = {
  declarationId: 'cad_refusal_unbounded_003',
  mode: 'SELECTIVE_VERIFICATION' as const,
  costClass: 'FREE_QUOTA' as const,
  purpose: 'Unbounded whole-chain sweep attempt',
  candidateIds: [], // Empty candidates and missing slot bounds -> refusal
  maxCalls: 1_000_000,
  maxCredits: 10_000_000,
  toleranceFraction: 0.5,
  paidPolicyApproved: false,
  declaredAt: '2026-08-20T10:00:00Z',
};

export const PAID_FALLBACK_REFUSAL_ACCESS = {
  declarationId: 'cad_refusal_paid_fallback_004',
  mode: 'SELECTIVE_VERIFICATION' as const,
  costClass: 'PAID_EXPLICIT' as const,
  purpose: 'Paid RPC fallback without explicit user-approved budget policy',
  candidateIds: ['asset_rep_sol_pump_001'],
  startSlot: '300100200',
  endSlot: '300100300',
  maxCalls: 50,
  maxCredits: 500,
  toleranceFraction: 0.05,
  paidPolicyApproved: false, // Refusal: paid access requires explicit policy approval
  declaredAt: '2026-08-20T10:00:00Z',
};

export const RESERVE_INCOMPATIBLE_REFUSAL_ACCESS = {
  declarationId: 'cad_refusal_reserve_mismatch_005',
  mode: 'HISTORICAL_SAMPLE' as const,
  costClass: 'FREE_QUOTA' as const,
  purpose: 'Background historical sample attempting to borrow emergency backfill reserve',
  candidateIds: ['asset_rep_sol_retro_008'],
  startSlot: '250000000',
  endSlot: '250100000',
  maxCalls: 100,
  maxCredits: 1000,
  toleranceFraction: 0.05,
  reserveId: 'EMERGENCY_BACKFILL', // Refusal: low-priority sample cannot drain emergency reserve
  paidPolicyApproved: false,
  declaredAt: '2026-08-20T10:00:00Z',
};

export const SILENT_WIDENING_REFUSAL_ACCESS = {
  declarationId: 'cad_refusal_silent_widening_006',
  mode: 'UNAUTHORIZED_BROAD_INGESTION' as const,
  costClass: 'FREE_QUOTA' as const,
  purpose: 'Direct-chain access attempting broad ingestion without population manifest',
  candidateIds: [],
  maxCalls: 500_000,
  maxCredits: 5_000_000,
  toleranceFraction: 0.2,
  paidPolicyApproved: false,
  declaredAt: '2026-08-20T10:00:00Z',
};

// -----------------------------------------------------------------------------
// 3. Tolerance breach incident consumption records
// -----------------------------------------------------------------------------

export const TOLERANCE_BREACH_INCIDENT_RECORD: ChainAccessConsumptionRecord = {
  declarationId: 'cad_selective_verify_001',
  actualCalls: 50, // Exceeds maxCalls (10) by 400%
  actualCredits: 500,
  breachDetected: true,
  incidentId: 'inc_chain_access_breach_001',
  consumedAt: '2026-08-20T10:01:00Z' as UtcTimestamp,
};

export const WITHIN_TOLERANCE_CONSUMPTION_RECORD: ChainAccessConsumptionRecord = {
  declarationId: 'cad_selective_verify_001',
  actualCalls: 10,
  actualCredits: 95,
  breachDetected: false,
  consumedAt: '2026-08-20T10:01:00Z' as UtcTimestamp,
};
