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

export const SOLSEC_SCHEMAS = {
  TokenControlFinding: TokenControlFindingSchema,
  TokenExtensionSupport: TokenExtensionSupportSchema,
} as const;
