/**
 * Sustainable Capacity Contract validation (PRD §62.4, §62.5; FR-COST-012, FR-COST-013, AC-227).
 *
 * A SustainableCapacityContract is the verified capacity statement a schedule is
 * admitted against: declared candidate load, provider and system envelopes, the
 * §62.4 protected reserve fractions, and the verification window. Validation is
 * fail-closed: any violated law throws `ForesiftError` rather than degrading.
 */
import { ErrorCode, ForesiftError } from './errors.ts';
import { reserveClass, type ReserveClass } from './capacity.ts';

/** Locally-registered code (errors.ts is outside this lane's write scope). */
const CONTRACT_INVALID = 'CONTRACT_INVARIANT_VIOLATED' as ErrorCode;

export interface CapacityCandidateLoad {
  newAssetsPerDayExpected: number;
  newAssetsPerDayStress: number;
  cheapMonitorRowsPerDay: number;
  promotedCandidatesPerDay: number;
  activeRiskCandidatesPerDay: number;
  highResolutionOutcomeCasesPerDay: number;
  interactiveInvestigationsPerDay: number;
}

export interface CapacityProviderEnvelopeItem {
  operationId: string;
  callsExpected: number;
  callsStress: number;
  quotaUnitsExpected: number;
  quotaUnitsStress: number;
  streamedBytesExpected?: number;
  streamedBytesStress?: number;
  retryAllowance: number;
  reserveClass?: ReserveClass;
}

export interface CapacitySystemEnvelope {
  modelInputTokens: number;
  modelOutputTokens: number;
  modelSpendUsd: number;
  workflowSteps: number;
  schedulerMessages: number;
  databaseReads: number;
  databaseWrites: number;
  databaseStorageBytes: number;
  objectOperations: number;
  objectStorageBytes: number;
  egressBytes: number;
  notificationSends: number;
  concurrency: number;
}

export interface SustainableCapacityContract {
  contractId: string;
  version: string;
  scheduleRef: string;
  profileRef: string;
  horizonDays: number;
  candidateLoad: CapacityCandidateLoad;
  providerEnvelope: CapacityProviderEnvelopeItem[];
  systemEnvelope: CapacitySystemEnvelope;
  retryAllowance: number;
  /** §62.4 protected reserve fractions keyed by ReserveClass; partial maps are allowed. */
  protectedReserves: Partial<Record<ReserveClass, number>>;
  minimumHeadroomFraction: number;
  safetyMarginFraction: number;
  degradationPolicyVersion: string;
  verifiedAt: string;
  expiresAt: string;
  result: ContractResultValue;
}

type ContractResultValue = 'PASS' | 'FAIL' | 'UNVERIFIED';

const HORIZON_MIN_DAYS = 30;

/**
 * IEEE754 slack for the reserve-sum law: the §62.4 default fractions
 * (0.20 + 0.15 + 0.10 × 4 + 0.15 + 0.05 × 2) must satisfy `sum <= 1` exactly.
 */
const FRACTION_SUM_EPSILON = 1e-9;

function fail(message: string, detail: Record<string, unknown> = {}): never {
  throw new ForesiftError(CONTRACT_INVALID, message, detail);
}

function requireNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) fail(`non-negative ${label} required`, { [label]: value });
  return value;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) fail(`finite ${label} required`, { [label]: value });
  return value;
}

/**
 * Validate a SustainableCapacityContract field-for-field. Returns the contract
 * unchanged when every law holds; throws `ForesiftError` on any violation.
 */
export function validateSustainableCapacityContract<T extends SustainableCapacityContract>(
  contract: T,
): T {
  if (typeof contract.contractId !== 'string' || contract.contractId.length === 0) {
    fail('contractId required');
  }
  if (typeof contract.version !== 'string' || contract.version.length === 0) {
    fail('version required');
  }
  if (typeof contract.scheduleRef !== 'string' || contract.scheduleRef.length === 0) {
    fail('scheduleRef required');
  }
  if (typeof contract.profileRef !== 'string' || contract.profileRef.length === 0) {
    fail('profileRef required');
  }

  // 30-day horizon law (§62.5)
  requireFinite(contract.horizonDays, 'horizonDays');
  if (contract.horizonDays < HORIZON_MIN_DAYS) {
    fail('horizonDays must be >= 30', { horizonDays: contract.horizonDays });
  }

  validateCandidateLoad(contract.candidateLoad);
  for (const item of contract.providerEnvelope) validateProviderEnvelopeItem(item);
  validateSystemEnvelope(contract.systemEnvelope);

  requireNonNegative(contract.retryAllowance, 'retryAllowance');

  validateProtectedReserves(contract.protectedReserves);

  requireFractionBounds(contract.minimumHeadroomFraction, 'minimumHeadroomFraction');
  requireFractionBounds(contract.safetyMarginFraction, 'safetyMarginFraction');

  if (typeof contract.degradationPolicyVersion !== 'string' || contract.degradationPolicyVersion.length === 0) {
    fail('degradationPolicyVersion required');
  }

  const verifiedAt = Date.parse(contract.verifiedAt);
  const expiresAt = Date.parse(contract.expiresAt);
  if (Number.isNaN(verifiedAt)) fail('verifiedAt must be an ISO timestamp', { verifiedAt: contract.verifiedAt });
  if (Number.isNaN(expiresAt)) fail('expiresAt must be an ISO timestamp', { expiresAt: contract.expiresAt });
  if (expiresAt <= verifiedAt) fail('expiresAt must be after verifiedAt');

  if (contract.result !== 'PASS' && contract.result !== 'FAIL' && contract.result !== 'UNVERIFIED') {
    fail('result must be PASS, FAIL, or UNVERIFIED', { result: contract.result });
  }

  return contract;
}

function validateCandidateLoad(load: CapacityCandidateLoad): void {
  requireFinite(load.newAssetsPerDayExpected, 'newAssetsPerDayExpected');
  requireFinite(load.newAssetsPerDayStress, 'newAssetsPerDayStress');
  if (load.newAssetsPerDayStress < load.newAssetsPerDayExpected) {
    fail('stress load must be >= expected load', {
      newAssetsPerDayExpected: load.newAssetsPerDayExpected,
      newAssetsPerDayStress: load.newAssetsPerDayStress,
    });
  }
  requireNonNegative(load.cheapMonitorRowsPerDay, 'cheapMonitorRowsPerDay');
  requireNonNegative(load.promotedCandidatesPerDay, 'promotedCandidatesPerDay');
  requireNonNegative(load.activeRiskCandidatesPerDay, 'activeRiskCandidatesPerDay');
  requireNonNegative(load.highResolutionOutcomeCasesPerDay, 'highResolutionOutcomeCasesPerDay');
  requireNonNegative(load.interactiveInvestigationsPerDay, 'interactiveInvestigationsPerDay');
}

function validateProviderEnvelopeItem(item: CapacityProviderEnvelopeItem): void {
  if (typeof item.operationId !== 'string' || item.operationId.length === 0) {
    fail('providerEnvelope item operationId required');
  }
  requireFinite(item.callsExpected, 'callsExpected');
  requireFinite(item.callsStress, 'callsStress');
  if (item.callsStress < item.callsExpected) {
    fail('callsStress must be >= callsExpected', { operationId: item.operationId });
  }
  requireFinite(item.quotaUnitsExpected, 'quotaUnitsExpected');
  requireFinite(item.quotaUnitsStress, 'quotaUnitsStress');
  if (item.quotaUnitsStress < item.quotaUnitsExpected) {
    fail('quotaUnitsStress must be >= quotaUnitsExpected', { operationId: item.operationId });
  }
  if (item.streamedBytesExpected !== undefined || item.streamedBytesStress !== undefined) {
    requireNonNegative(item.streamedBytesExpected ?? 0, 'streamedBytesExpected');
    requireNonNegative(item.streamedBytesStress ?? 0, 'streamedBytesStress');
    if ((item.streamedBytesStress ?? 0) < (item.streamedBytesExpected ?? 0)) {
      fail('streamedBytesStress must be >= streamedBytesExpected', { operationId: item.operationId });
    }
  }
  requireNonNegative(item.retryAllowance, 'retryAllowance');
  if (item.reserveClass !== undefined) reserveClass(item.reserveClass);
}

function validateSystemEnvelope(envelope: CapacitySystemEnvelope): void {
  const fields: (keyof CapacitySystemEnvelope)[] = [
    'modelInputTokens',
    'modelOutputTokens',
    'modelSpendUsd',
    'workflowSteps',
    'schedulerMessages',
    'databaseReads',
    'databaseWrites',
    'databaseStorageBytes',
    'objectOperations',
    'objectStorageBytes',
    'egressBytes',
    'notificationSends',
    'concurrency',
  ];
  for (const field of fields) requireNonNegative(envelope[field], String(field));
}

function validateProtectedReserves(reserves: Partial<Record<ReserveClass, number>>): void {
  let sum = 0;
  for (const [className, fraction] of Object.entries(reserves)) {
    reserveClass(className);
    if (!Number.isFinite(fraction) || fraction < 0) {
      fail('reserve fractions must be >= 0', { reserveClass: className, fraction });
    }
    if (fraction > 1) fail('reserve fractions must be <= 1', { reserveClass: className, fraction });
    sum += fraction;
  }
  if (sum > 1 + FRACTION_SUM_EPSILON) {
    fail('protected reserve fractions must sum to <= 1', { sum });
  }
}

function requireFractionBounds(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${label} must be within [0, 1]`, { [label]: value });
  }
}

/**
 * Activation gate (FR-COST-012): a contract is activatable only when its recorded
 * verification outcome is PASS. FAIL and UNVERIFIED contracts are accepted as valid
 * data by `validateSustainableCapacityContract` but never activatable.
 */
export function isContractActivatable(contract: SustainableCapacityContract): boolean {
  return contract.result === 'PASS';
}
