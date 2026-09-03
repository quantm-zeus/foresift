import { z } from 'zod';
import { UtcTimestampSchema } from './data.ts';

export const TokenControlClassificationSchema = z.enum([
  'KNOWN_RISK',
  'ADMINISTRATIVE_CONTROL',
  'NEUTRAL_CONFIGURATION',
  'REVOKED_AUTHORITY',
  'UNABLE_TO_VERIFY',
]);
export const TokenControlKindSchema = z.enum([
  'PROGRAM_OWNER',
  'MINT_AUTHORITY',
  'FREEZE_AUTHORITY',
  'PERMANENT_DELEGATE',
  'TRANSFER_FEE_CONFIGURATION',
  'TRANSFER_FEE_WITHHELD_AUTHORITY',
  'TRANSFER_HOOK_PROGRAM',
  'DEFAULT_ACCOUNT_STATE',
  'CLOSE_AUTHORITY',
  'NON_TRANSFERABLE',
  'CONFIDENTIAL_TRANSFER',
  'METADATA_AUTHORITY',
  'UPDATE_AUTHORITY',
  'DECIMALS',
  'TOTAL_SUPPLY',
  'UNKNOWN_EXTENSION',
]);

export const TokenControlFindingSchema = z
  .object({
    findingId: z.string().min(1),
    assetRepresentationId: z.string().min(1),
    programId: z.string().min(1),
    programVersion: z.string().min(1),
    layoutVersion: z.string().min(1),
    control: TokenControlKindSchema,
    classification: TokenControlClassificationSchema,
    value: z.unknown(),
    analyzerVersion: z.string().min(1),
    policyVersion: z.string().min(1),
    evidenceRef: z.string().min(1),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
    qualityCodes: z.array(z.string().min(1)),
  })
  .strict()
  .refine((value) => Date.parse(value.availableAt) >= Date.parse(value.observedAt), {
    message: 'availableAt cannot precede observedAt',
  });
export type TokenControlFinding = z.infer<typeof TokenControlFindingSchema>;

export const TransferExtensionVerdictSchema = z.enum([
  'KNOWN_MODELED',
  'KNOWN_UNMODELED',
  'UNKNOWN_REQUIRED',
  'NOT_PRESENT',
]);
export const TokenExtensionSupportSchema = z
  .object({
    supportId: z.string().min(1),
    assetRepresentationId: z.string().min(1),
    programId: z.string().min(1),
    programVersion: z.string().min(1),
    layoutVersion: z.string().min(1),
    extension: z.string().min(1),
    verdict: TransferExtensionVerdictSchema,
    verdictPolicyVersion: z.string().min(1),
    analyzerVersion: z.string().min(1),
    evidenceRef: z.string().min(1),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.availableAt) >= Date.parse(value.observedAt), {
    message: 'availableAt cannot precede observedAt',
  });
export type TokenExtensionSupport = z.infer<typeof TokenExtensionSupportSchema>;

export const PoolSecurityAssessmentSchema = z
  .object({
    assessmentId: z.string().min(1),
    poolId: z.string().min(1),
    state: z.enum(['COMPLETE', 'PARTIAL', 'DEGRADED_UNSUPPORTED']),
    protocolFamily: z.string().min(1).nullable(),
    decoderVersion: z.string().min(1).nullable(),
    poolOwner: z.string().min(1).nullable(),
    positionControl: z
      .enum(['BURNED', 'LOCKED_WITH_EVIDENCE', 'OPEN', 'UNABLE_TO_VERIFY'])
      .nullable(),
    lockEvidenceRef: z.string().min(1).nullable(),
    withdrawalAuthority: z
      .enum(['REVOKED', 'PRESENT', 'PRESENT_WITH_OBSERVED_ABUSE', 'UNABLE_TO_VERIFY'])
      .nullable(),
    migrationLineageRef: z.string().min(1).nullable(),
    quoteParityPassed: z.boolean().nullable(),
    liquidityConcentration: z.number().min(0).max(1).nullable(),
    recentLiquidityAddsRaw: z.string().regex(/^\d+$/).nullable(),
    recentLiquidityRemovalsRaw: z.string().regex(/^\d+$/).nullable(),
    largeSellImpactBps: z.number().nonnegative().nullable(),
    stateComplete: z.boolean(),
    qualityCodes: z.array(z.string().min(1)).min(1),
    analyzerVersion: z.string().min(1),
    policyVersion: z.string().min(1),
    evidenceRef: z.string().min(1),
    observedAt: UtcTimestampSchema,
    availableAt: UtcTimestampSchema,
  })
  .strict()
  .refine((value) => Date.parse(value.availableAt) >= Date.parse(value.observedAt), {
    message: 'availableAt cannot precede observedAt',
  })
  .refine(
    (value) =>
      value.state !== 'DEGRADED_UNSUPPORTED' ||
      (value.protocolFamily === null &&
        value.decoderVersion === null &&
        value.poolOwner === null &&
        value.positionControl === null &&
        value.lockEvidenceRef === null &&
        value.withdrawalAuthority === null &&
        value.migrationLineageRef === null &&
        value.quoteParityPassed === null &&
        value.liquidityConcentration === null &&
        value.recentLiquidityAddsRaw === null &&
        value.recentLiquidityRemovalsRaw === null &&
        value.largeSellImpactBps === null &&
        !value.stateComplete),
    { message: 'unsupported pool designs cannot contain resolved-state fields' },
  );
export type PoolSecurityAssessment = z.infer<typeof PoolSecurityAssessmentSchema>;

export const SOLSEC_SCHEMAS = {
  TokenControlFinding: TokenControlFindingSchema,
  TokenExtensionSupport: TokenExtensionSupportSchema,
  PoolSecurityAssessment: PoolSecurityAssessmentSchema,
} as const;
