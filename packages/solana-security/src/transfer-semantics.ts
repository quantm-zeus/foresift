import { TransferExtensionVerdict, type TokenExtensionSupport } from '@foresift/domain';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_ASSESSMENT_ANALYZER_VERSION,
} from './token-assessment.ts';

export const TRANSFER_VERDICT_POLICY_VERSION = 'solsec-transfer-semantics@1';

export interface TransferSemanticsPolicy {
  readonly version: string;
  readonly programVersions: Readonly<Record<string, readonly string[]>>;
  /** Canonical extension name -> modeled status when present. */
  readonly extensionVerdicts: Readonly<Record<string, 'KNOWN_MODELED' | 'KNOWN_UNMODELED'>>;
}

export const DEFAULT_TRANSFER_SEMANTICS_POLICY: TransferSemanticsPolicy = {
  version: TRANSFER_VERDICT_POLICY_VERSION,
  programVersions: {
    [SPL_TOKEN_PROGRAM_ID]: ['1.0.0'],
    [TOKEN_2022_PROGRAM_ID]: ['1.0.0'],
  },
  extensionVerdicts: {
    BASE_TRANSFER: 'KNOWN_MODELED',
    TRANSFER_FEE_CONFIGURATION: 'KNOWN_MODELED',
    TRANSFER_HOOK_PROGRAM: 'KNOWN_UNMODELED',
    DEFAULT_ACCOUNT_STATE: 'KNOWN_MODELED',
    NON_TRANSFERABLE: 'KNOWN_MODELED',
    CONFIDENTIAL_TRANSFER: 'KNOWN_UNMODELED',
  },
};

export interface TransferSemanticsInput {
  readonly assetRepresentationId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutVersion?: string;
  readonly extensions: readonly (string | { readonly type: string })[];
  readonly verdictPolicyVersion: string;
  readonly analyzerVersion?: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly availableAt: string;
  readonly policies?: readonly TransferSemanticsPolicy[];
}

const EXTENSION_NAMES: Readonly<Record<string, string>> = {
  base: 'BASE_TRANSFER',
  basetransfer: 'BASE_TRANSFER',
  transferfeeconfig: 'TRANSFER_FEE_CONFIGURATION',
  transferfeeconfiguration: 'TRANSFER_FEE_CONFIGURATION',
  transferhook: 'TRANSFER_HOOK_PROGRAM',
  transferhookprogram: 'TRANSFER_HOOK_PROGRAM',
  defaultaccountstate: 'DEFAULT_ACCOUNT_STATE',
  nontransferable: 'NON_TRANSFERABLE',
  nontransferableaccount: 'NON_TRANSFERABLE',
  confidentialtransfer: 'CONFIDENTIAL_TRANSFER',
  confidentialtransfermint: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferaccount: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferfeeconfig: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferfeeamount: 'CONFIDENTIAL_TRANSFER',
  confidentialmintburn: 'CONFIDENTIAL_TRANSFER',
};

function normalize(value: string): string | undefined {
  return EXTENSION_NAMES[value.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase()];
}

function stableSupportId(input: TransferSemanticsInput, extension: string): string {
  return `token-support:${[
    input.assetRepresentationId,
    input.programId,
    input.programVersion,
    input.layoutVersion ?? input.programVersion,
    input.verdictPolicyVersion,
    input.availableAt,
    extension,
  ]
    .map((value) => encodeURIComponent(value))
    .join(':')}`;
}

function makeRow(
  input: TransferSemanticsInput,
  extension: string,
  verdict: TokenExtensionSupport['verdict'],
): TokenExtensionSupport {
  return {
    supportId: stableSupportId(input, extension),
    assetRepresentationId: input.assetRepresentationId,
    programId: input.programId,
    programVersion: input.programVersion,
    layoutVersion: input.layoutVersion ?? input.programVersion,
    extension,
    verdict,
    verdictPolicyVersion: input.verdictPolicyVersion,
    analyzerVersion: input.analyzerVersion ?? TOKEN_ASSESSMENT_ANALYZER_VERSION,
    evidenceRef: input.evidenceRef,
    observedAt: input.observedAt,
    availableAt: input.availableAt,
  };
}

/**
 * Versioned support verdict over an exact program/version/extension tuple.
 * An absent or unknown policy, program version, or extension always fails closed.
 */
export function transferExtensionVerdict(params: {
  readonly programId: string;
  readonly programVersion: string;
  readonly extension: string;
  readonly present: boolean;
  readonly verdictPolicyVersion: string;
  readonly policies?: readonly TransferSemanticsPolicy[];
}): TokenExtensionSupport['verdict'] {
  if (!params.present) return TransferExtensionVerdict.NOT_PRESENT;
  const policy = (params.policies ?? [DEFAULT_TRANSFER_SEMANTICS_POLICY]).find(
    (candidate) => candidate.version === params.verdictPolicyVersion,
  );
  if (policy === undefined) return TransferExtensionVerdict.UNKNOWN_REQUIRED;
  if (!policy.programVersions[params.programId]?.includes(params.programVersion))
    return TransferExtensionVerdict.UNKNOWN_REQUIRED;
  const canonical = normalize(params.extension);
  if (canonical === undefined) return TransferExtensionVerdict.UNKNOWN_REQUIRED;
  return policy.extensionVerdicts[canonical] ?? TransferExtensionVerdict.UNKNOWN_REQUIRED;
}

/** Emits immutable-policy-keyed token_extension_support row shapes. */
export function evaluateTransferSemantics(
  input: TransferSemanticsInput,
): readonly TokenExtensionSupport[] {
  const observed = Date.parse(input.observedAt);
  const available = Date.parse(input.availableAt);
  if (!Number.isFinite(observed) || !Number.isFinite(available))
    throw new Error('INVALID_TIMESTAMP');
  if (available < observed) throw new Error('AVAILABLE_AT_PRECEDES_OBSERVED_AT');

  const policies = input.policies ?? [DEFAULT_TRANSFER_SEMANTICS_POLICY];
  const policy = policies.find((candidate) => candidate.version === input.verdictPolicyVersion);
  const rawExtensions = input.extensions.map((extension) =>
    typeof extension === 'string' ? extension : extension.type,
  );

  if (policy === undefined) {
    const names = rawExtensions.length === 0 ? ['POLICY'] : rawExtensions;
    return names.map((extension) =>
      makeRow(input, extension, TransferExtensionVerdict.UNKNOWN_REQUIRED),
    );
  }

  if (!policy.programVersions[input.programId]?.includes(input.programVersion)) {
    const names = rawExtensions.length === 0 ? ['PROGRAM_OR_VERSION'] : rawExtensions;
    return names.map((extension) =>
      makeRow(input, extension, TransferExtensionVerdict.UNKNOWN_REQUIRED),
    );
  }

  const presentCanonical = new Set<string>();
  const rows: TokenExtensionSupport[] = [];
  for (const raw of rawExtensions) {
    const canonical = normalize(raw);
    if (canonical === undefined) {
      rows.push(makeRow(input, raw, TransferExtensionVerdict.UNKNOWN_REQUIRED));
      continue;
    }
    if (presentCanonical.has(canonical)) continue;
    presentCanonical.add(canonical);
    rows.push(
      makeRow(
        input,
        canonical,
        policy.extensionVerdicts[canonical] ?? TransferExtensionVerdict.UNKNOWN_REQUIRED,
      ),
    );
  }

  // A complete support matrix distinguishes absence from unknown behavior.
  for (const extension of Object.keys(policy.extensionVerdicts).sort()) {
    if (!presentCanonical.has(extension))
      rows.push(makeRow(input, extension, TransferExtensionVerdict.NOT_PRESENT));
  }
  return rows;
}

export type TransferVerdictInput =
  | TokenExtensionSupport['verdict']
  | Pick<TokenExtensionSupport, 'verdict'>
  | readonly (TokenExtensionSupport['verdict'] | Pick<TokenExtensionSupport, 'verdict'>)[];

/** Pure FR-SOLSEC-004 blocking predicate; no cost or behavior is imputed. */
export function blocksCompleteExecutionModeling(verdict: TransferVerdictInput): boolean {
  if (Array.isArray(verdict))
    return verdict.some((item) =>
      blocksCompleteExecutionModeling(
        item as TokenExtensionSupport['verdict'] | Pick<TokenExtensionSupport, 'verdict'>,
      ),
    );
  const value =
    typeof verdict === 'string'
      ? verdict
      : (verdict as Pick<TokenExtensionSupport, 'verdict'>).verdict;
  return value === TransferExtensionVerdict.UNKNOWN_REQUIRED;
}

export const buildTokenExtensionSupportRows = evaluateTransferSemantics;
export const getTransferExtensionVerdict = transferExtensionVerdict;
