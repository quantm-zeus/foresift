/** Runtime boundary schemas for deterministic Solana security evidence. */
import { z } from 'zod';
import {
  ALL_LIQUIDITY_REMOVAL_RISKS,
  ALL_LP_CONTROL_STATES,
  ALL_POOL_SUPPORT_STATES,
  ALL_PROVIDER_VERDICTS,
  ALL_QUOTE_PARITY_STATES,
  ALL_SECURITY_CONFLICT_CLASSES,
  ALL_SECURITY_SEVERITIES,
  ALL_STATE_COMPLETENESSES,
  ALL_SYSTEM_ADDRESS_REVIEW_STATES,
  ALL_SYSTEM_ADDRESS_ROLES,
  ALL_TOKEN_CONTROLS,
  ALL_TOKEN_CONTROL_STATES,
  ALL_TRANSFER_SEMANTICS_SUPPORTS,
  ALL_WITHDRAWAL_AUTHORITY_STATES,
  PoolSupportState,
  SecurityConflictClass,
  SystemAddressReviewState,
  SystemAddressRole,
  TokenControlState,
  type LiquidityRemovalRisk,
  type LpControlState,
  type ProviderVerdict,
  type QuoteParityState,
  type SecuritySeverity,
  type StateCompleteness,
  type TokenControl,
  type TransferSemanticsSupport,
  type WithdrawalAuthorityState,
} from '@foresift/domain';
import {
  ChainIdSchema,
  DecimalStringSchema,
  DigitStringSchema,
  QualityCodesSchema,
  UtcTimestampSchema,
} from './data.ts';

export const SOLSEC_SCHEMA_REGISTRY_VERSION = 1;

const nonEmptyId = z.string().min(1);
export const Sha256RefSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'expected sha256:<64 lowercase hex characters>');

const tokenControlValues = [...ALL_TOKEN_CONTROLS] as [TokenControl, ...TokenControl[]];
const tokenControlStateValues = [...ALL_TOKEN_CONTROL_STATES] as [
  TokenControlState,
  ...TokenControlState[],
];
const securitySeverityValues = [...ALL_SECURITY_SEVERITIES] as [
  SecuritySeverity,
  ...SecuritySeverity[],
];
const transferSupportValues = [...ALL_TRANSFER_SEMANTICS_SUPPORTS] as [
  TransferSemanticsSupport,
  ...TransferSemanticsSupport[],
];
const poolSupportValues = [...ALL_POOL_SUPPORT_STATES] as [PoolSupportState, ...PoolSupportState[]];
const lpControlValues = [...ALL_LP_CONTROL_STATES] as [LpControlState, ...LpControlState[]];
const withdrawalAuthorityValues = [...ALL_WITHDRAWAL_AUTHORITY_STATES] as [
  WithdrawalAuthorityState,
  ...WithdrawalAuthorityState[],
];
const liquidityRiskValues = [...ALL_LIQUIDITY_REMOVAL_RISKS] as [
  LiquidityRemovalRisk,
  ...LiquidityRemovalRisk[],
];
const quoteParityValues = [...ALL_QUOTE_PARITY_STATES] as [QuoteParityState, ...QuoteParityState[]];
const completenessValues = [...ALL_STATE_COMPLETENESSES] as [
  StateCompleteness,
  ...StateCompleteness[],
];
const providerVerdictValues = [...ALL_PROVIDER_VERDICTS] as [ProviderVerdict, ...ProviderVerdict[]];
const conflictClassValues = [...ALL_SECURITY_CONFLICT_CLASSES] as [
  SecurityConflictClass,
  ...SecurityConflictClass[],
];
const systemRoleValues = [...ALL_SYSTEM_ADDRESS_ROLES] as [
  SystemAddressRole,
  ...SystemAddressRole[],
];
const reviewStateValues = [...ALL_SYSTEM_ADDRESS_REVIEW_STATES] as [
  SystemAddressReviewState,
  ...SystemAddressReviewState[],
];

export const TokenControlSchema = z.enum(tokenControlValues);
export const TokenControlStateSchema = z.enum(tokenControlStateValues);
export const SecuritySeveritySchema = z.enum(securitySeverityValues);
export const TransferSemanticsSupportSchema = z.enum(transferSupportValues);
export const PoolSupportStateSchema = z.enum(poolSupportValues);
export const LpControlStateSchema = z.enum(lpControlValues);
export const WithdrawalAuthorityStateSchema = z.enum(withdrawalAuthorityValues);
export const LiquidityRemovalRiskSchema = z.enum(liquidityRiskValues);
export const QuoteParityStateSchema = z.enum(quoteParityValues);
export const StateCompletenessSchema = z.enum(completenessValues);
export const ProviderVerdictSchema = z.enum(providerVerdictValues);
export const SecurityConflictClassSchema = z.enum(conflictClassValues);
export const SystemAddressRoleSchema = z.enum(systemRoleValues);
export const SystemAddressReviewStateSchema = z.enum(reviewStateValues);

function availableAfterObserved(value: { observedAt: string; availableAt: string }): boolean {
  return Date.parse(value.availableAt) >= Date.parse(value.observedAt);
}

export const TokenProgramAssessmentSchema = z
  .object({
    assessmentId: nonEmptyId,
    assetRepresentationId: nonEmptyId,
    chainId: ChainIdSchema,
    programOwner: nonEmptyId,
    programVersion: nonEmptyId,
    analyzerVersion: nonEmptyId,
    decimals: z.number().int().min(0).max(255),
    totalSupplyRaw: DigitStringSchema,
    transferSemanticsSupport: TransferSemanticsSupportSchema,
    deterministicEvidenceIds: z.array(nonEmptyId).min(1),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema.min(1),
    schemaRegistryVersion: z.literal(SOLSEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine(availableAfterObserved, { message: 'availableAt must not precede observedAt' });
export type TokenProgramAssessment = z.infer<typeof TokenProgramAssessmentSchema>;

export const TokenControlFindingSchema = z
  .object({
    findingId: nonEmptyId,
    assessmentId: nonEmptyId,
    control: TokenControlSchema,
    controlState: TokenControlStateSchema,
    severity: SecuritySeveritySchema.nullable(),
    authorityAddress: z.string().min(1).nullable(),
    extensionDataHash: Sha256RefSchema.nullable(),
    evidenceIds: z.array(nonEmptyId).min(1),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema.min(1),
  })
  .strict()
  .refine(availableAfterObserved, { message: 'availableAt must not precede observedAt' })
  .refine(
    (value) => value.controlState !== TokenControlState.KNOWN_RISK || value.severity !== null,
    { message: 'KNOWN_RISK requires severity' },
  );
export type TokenControlFinding = z.infer<typeof TokenControlFindingSchema>;

export const TokenExtensionSupportSchema = z
  .object({
    assessmentId: nonEmptyId,
    extensionType: nonEmptyId,
    extensionDataHash: Sha256RefSchema,
    support: TransferSemanticsSupportSchema,
    verdictPolicyVersion: nonEmptyId,
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema.min(1),
  })
  .strict()
  .refine(availableAfterObserved, { message: 'availableAt must not precede observedAt' });
export type TokenExtensionSupport = z.infer<typeof TokenExtensionSupportSchema>;

export const PoolSecurityAssessmentSchema = z
  .object({
    assessmentId: nonEmptyId,
    poolId: nonEmptyId,
    adapterId: nonEmptyId,
    adapterVersion: nonEmptyId,
    adapterSupportState: PoolSupportStateSchema,
    lpControlState: LpControlStateSchema.nullable(),
    withdrawalAuthorityState: WithdrawalAuthorityStateSchema.nullable(),
    liquidityRemovalRisk: LiquidityRemovalRiskSchema.nullable(),
    quoteParityState: QuoteParityStateSchema.nullable(),
    stateCompleteness: StateCompletenessSchema.nullable(),
    migrationLineageId: z.string().min(1).nullable(),
    liquidityConcentration: DecimalStringSchema.nullable(),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    evidenceIds: z.array(nonEmptyId).min(1),
    qualityCodes: QualityCodesSchema.min(1),
    schemaRegistryVersion: z.literal(SOLSEC_SCHEMA_REGISTRY_VERSION),
  })
  .strict()
  .refine(availableAfterObserved, { message: 'availableAt must not precede observedAt' })
  .refine(
    (value) => value.liquidityConcentration === null || Number(value.liquidityConcentration) <= 1,
    { message: 'liquidityConcentration must be at most 1' },
  )
  .refine(
    (value) =>
      value.adapterSupportState !== PoolSupportState.DEGRADED_UNSUPPORTED ||
      (value.lpControlState === null &&
        value.withdrawalAuthorityState === null &&
        value.liquidityRemovalRisk === null &&
        value.quoteParityState === null &&
        value.stateCompleteness === null &&
        value.migrationLineageId === null &&
        value.liquidityConcentration === null),
    { message: 'DEGRADED_UNSUPPORTED cannot carry resolved-state fields' },
  )
  .refine(
    (value) =>
      value.adapterSupportState !== PoolSupportState.RESOLVED ||
      (value.lpControlState !== null &&
        value.withdrawalAuthorityState !== null &&
        value.liquidityRemovalRisk !== null &&
        value.quoteParityState !== null &&
        value.stateCompleteness !== null),
    { message: 'RESOLVED requires pool security state fields' },
  );
export type PoolSecurityAssessment = z.infer<typeof PoolSecurityAssessmentSchema>;

export const SecurityProviderReportSchema = z
  .object({
    reportId: nonEmptyId,
    assessmentId: nonEmptyId,
    sourceId: nonEmptyId,
    providerReportId: nonEmptyId,
    providerVersion: nonEmptyId,
    verdict: ProviderVerdictSchema,
    rawPayloadRef: Sha256RefSchema,
    findingIds: z.array(nonEmptyId),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: QualityCodesSchema.min(1),
  })
  .strict()
  .refine(availableAfterObserved, { message: 'availableAt must not precede observedAt' });
export type SecurityProviderReport = z.infer<typeof SecurityProviderReportSchema>;

export const SecurityConflictSchema = z
  .object({
    conflictId: nonEmptyId,
    assessmentId: nonEmptyId,
    providerReportId: nonEmptyId,
    conflictClass: SecurityConflictClassSchema,
    deterministicFindingIds: z.array(nonEmptyId).min(1),
    resolution: z.literal('DETERMINISTIC'),
    resolvedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.availableAt) >= Date.parse(value.resolvedAt), {
    message: 'availableAt must not precede resolvedAt',
  })
  .refine(
    (value) =>
      value.conflictClass !== SecurityConflictClass.PROVIDER_OPTIMISM_OVERRIDDEN ||
      value.deterministicFindingIds.length > 0,
    { message: 'provider optimism can only be overridden by deterministic findings' },
  );
export type SecurityConflict = z.infer<typeof SecurityConflictSchema>;

export const SystemAddressRegistryEntrySchema = z
  .object({
    registryEntryId: nonEmptyId,
    chainId: ChainIdSchema,
    address: nonEmptyId,
    role: SystemAddressRoleSchema,
    validFrom: UtcTimestampSchema,
    validUntil: UtcTimestampSchema.nullable(),
    sourceId: nonEmptyId,
    confidence: z.number().finite().min(0).max(1),
    reviewState: SystemAddressReviewStateSchema,
    registryVersion: z.number().int().positive(),
    evidenceIds: z.array(nonEmptyId).min(1),
  })
  .strict()
  .refine(
    (value) =>
      value.validUntil === null || Date.parse(value.validUntil) > Date.parse(value.validFrom),
    { message: 'validUntil must be later than validFrom' },
  )
  .refine(
    (value) =>
      value.reviewState !== SystemAddressReviewState.REVIEWED ||
      value.role === SystemAddressRole.UNKNOWN_INFRASTRUCTURE ||
      value.confidence >= 0.8,
    { message: 'reviewed known roles require confidence of at least 0.80' },
  );
export type SystemAddressRegistryEntry = z.infer<typeof SystemAddressRegistryEntrySchema>;

export const SystemAddressExclusionAppliedSchema = z
  .object({
    exclusionId: nonEmptyId,
    registryEntryId: nonEmptyId,
    economicEventId: nonEmptyId,
    excluded: z.boolean(),
    rawFlowRef: Sha256RefSchema,
    appliedAt: UtcTimestampSchema,
    registryVersion: z.number().int().positive(),
    qualityCodes: QualityCodesSchema.min(1),
  })
  .strict();
export type SystemAddressExclusionApplied = z.infer<typeof SystemAddressExclusionAppliedSchema>;

export const SOLSEC_SCHEMAS = {
  TokenProgramAssessment: TokenProgramAssessmentSchema,
  TokenControlFinding: TokenControlFindingSchema,
  TokenExtensionSupport: TokenExtensionSupportSchema,
  PoolSecurityAssessment: PoolSecurityAssessmentSchema,
  SecurityProviderReport: SecurityProviderReportSchema,
  SecurityConflict: SecurityConflictSchema,
  SystemAddressRegistryEntry: SystemAddressRegistryEntrySchema,
  SystemAddressExclusionApplied: SystemAddressExclusionAppliedSchema,
} as const;

export function parseSolsecSchema<T extends keyof typeof SOLSEC_SCHEMAS>(
  name: T,
  payload: unknown,
): z.infer<(typeof SOLSEC_SCHEMAS)[T]> {
  return SOLSEC_SCHEMAS[name].parse(payload) as z.infer<(typeof SOLSEC_SCHEMAS)[T]>;
}
