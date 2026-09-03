import { TransferSemanticsSupport } from '@foresift/domain';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type { TokenExtensionSupport } from '@foresift/shared-schemas';
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from './token-assessment.ts';

export const TRANSFER_VERDICT_POLICY_VERSION = 'solsec-transfer-semantics@1';
export interface TransferSemanticsPolicy {
  readonly version: string;
  readonly programVersions: Readonly<Record<string, readonly string[]>>;
  readonly extensionVerdicts: Readonly<Record<string, 'KNOWN_MODELED' | 'KNOWN_UNMODELED'>>;
}
export const DEFAULT_TRANSFER_SEMANTICS_POLICY: TransferSemanticsPolicy = {
  version: TRANSFER_VERDICT_POLICY_VERSION,
  programVersions: { [SPL_TOKEN_PROGRAM_ID]: ['1.0.0'], [TOKEN_2022_PROGRAM_ID]: ['1.0.0'] },
  extensionVerdicts: {
    BASE_TRANSFER: 'KNOWN_MODELED',
    TRANSFER_FEE: 'KNOWN_MODELED',
    TRANSFER_HOOK: 'KNOWN_UNMODELED',
    DEFAULT_STATE: 'KNOWN_MODELED',
    NON_TRANSFERABLE: 'KNOWN_MODELED',
    CONFIDENTIAL_TRANSFER: 'KNOWN_UNMODELED',
  },
};
export interface TransferSemanticsInput {
  readonly assessmentId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly extensions: readonly (string | { readonly type: string; readonly data?: unknown })[];
  readonly verdictPolicyVersion: string;
  readonly observedAt: string;
  readonly availableAt: string;
  readonly policies?: readonly TransferSemanticsPolicy[];
}
const NAMES: Readonly<Record<string, string>> = {
  base: 'BASE_TRANSFER',
  basetransfer: 'BASE_TRANSFER',
  transferfeeconfig: 'TRANSFER_FEE',
  transferfeeconfiguration: 'TRANSFER_FEE',
  transferhook: 'TRANSFER_HOOK',
  transferhookprogram: 'TRANSFER_HOOK',
  defaultaccountstate: 'DEFAULT_STATE',
  nontransferable: 'NON_TRANSFERABLE',
  nontransferableaccount: 'NON_TRANSFERABLE',
  confidentialtransfer: 'CONFIDENTIAL_TRANSFER',
  confidentialtransfermint: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferaccount: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferfeeconfig: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferfeeamount: 'CONFIDENTIAL_TRANSFER',
  confidentialmintburn: 'CONFIDENTIAL_TRANSFER',
};
const normalize = (value: string): string | undefined =>
  NAMES[value.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase()];

export function transferExtensionVerdict(params: {
  readonly programId: string;
  readonly programVersion: string;
  readonly extension: string;
  readonly present: boolean;
  readonly verdictPolicyVersion: string;
  readonly policies?: readonly TransferSemanticsPolicy[];
}): TransferSemanticsSupport {
  if (!params.present) return TransferSemanticsSupport.NOT_PRESENT;
  const policy = (params.policies ?? [DEFAULT_TRANSFER_SEMANTICS_POLICY]).find(
    (item) => item.version === params.verdictPolicyVersion,
  );
  if (
    policy === undefined ||
    !policy.programVersions[params.programId]?.includes(params.programVersion)
  )
    return TransferSemanticsSupport.UNKNOWN_REQUIRED;
  const canonical = normalize(params.extension);
  return canonical === undefined
    ? TransferSemanticsSupport.UNKNOWN_REQUIRED
    : (policy.extensionVerdicts[canonical] ?? TransferSemanticsSupport.UNKNOWN_REQUIRED);
}

export function evaluateTransferSemantics(
  input: TransferSemanticsInput,
): readonly TokenExtensionSupport[] {
  if (Date.parse(input.availableAt) < Date.parse(input.observedAt))
    throw new Error('AVAILABLE_AT_PRECEDES_OBSERVED_AT');
  const policies = input.policies ?? [DEFAULT_TRANSFER_SEMANTICS_POLICY];
  const policy = policies.find((item) => item.version === input.verdictPolicyVersion);
  const raw = input.extensions.map((extension) =>
    typeof extension === 'string'
      ? { type: extension, data: extension }
      : { type: extension.type, data: extension.data ?? extension },
  );
  const names =
    raw.length === 0 && policy === undefined
      ? [{ type: 'POLICY', data: input.verdictPolicyVersion }]
      : raw;
  const rows: TokenExtensionSupport[] = [];
  const present = new Set<string>();
  for (const extension of names) {
    const canonical = normalize(extension.type);
    if (canonical !== undefined && present.has(canonical)) continue;
    if (canonical !== undefined) present.add(canonical);
    const support = transferExtensionVerdict({
      programId: input.programId,
      programVersion: input.programVersion,
      extension: extension.type,
      present: true,
      verdictPolicyVersion: input.verdictPolicyVersion,
      policies,
    });
    rows.push({
      assessmentId: input.assessmentId,
      extensionType: canonical ?? extension.type,
      extensionDataHash: sha256Text(canonicalJson(extension.data)),
      support,
      verdictPolicyVersion: input.verdictPolicyVersion,
      observedAt: input.observedAt,
      availableAt: input.availableAt,
      qualityCodes:
        support === TransferSemanticsSupport.UNKNOWN_REQUIRED
          ? ['TOKEN_EXTENSION_UNKNOWN']
          : ['VALID'],
    });
  }
  if (
    policy !== undefined &&
    policy.programVersions[input.programId]?.includes(input.programVersion)
  ) {
    for (const extension of Object.keys(policy.extensionVerdicts).sort())
      if (!present.has(extension))
        rows.push({
          assessmentId: input.assessmentId,
          extensionType: extension,
          extensionDataHash: sha256Text(canonicalJson({ present: false, extension })),
          support: TransferSemanticsSupport.NOT_PRESENT,
          verdictPolicyVersion: input.verdictPolicyVersion,
          observedAt: input.observedAt,
          availableAt: input.availableAt,
          qualityCodes: ['VALID'],
        });
  }
  if (rows.length === 0)
    rows.push({
      assessmentId: input.assessmentId,
      extensionType: 'PROGRAM_OR_VERSION',
      extensionDataHash: sha256Text(
        canonicalJson({ programId: input.programId, programVersion: input.programVersion }),
      ),
      support: TransferSemanticsSupport.UNKNOWN_REQUIRED,
      verdictPolicyVersion: input.verdictPolicyVersion,
      observedAt: input.observedAt,
      availableAt: input.availableAt,
      qualityCodes: ['UNSUPPORTED_PROGRAM_VERSION'],
    });
  return rows;
}

export type TransferVerdictInput =
  | TransferSemanticsSupport
  | Pick<TokenExtensionSupport, 'support'>
  | readonly (TransferSemanticsSupport | Pick<TokenExtensionSupport, 'support'>)[];
export function blocksCompleteExecutionModeling(verdict: TransferVerdictInput): boolean {
  if (Array.isArray(verdict))
    return verdict.some((item) =>
      blocksCompleteExecutionModeling(
        item as TransferSemanticsSupport | Pick<TokenExtensionSupport, 'support'>,
      ),
    );
  const value =
    typeof verdict === 'string'
      ? verdict
      : (verdict as Pick<TokenExtensionSupport, 'support'>).support;
  return value === TransferSemanticsSupport.UNKNOWN_REQUIRED;
}
export const buildTokenExtensionSupportRows = evaluateTransferSemantics;
export const getTransferExtensionVerdict = transferExtensionVerdict;
