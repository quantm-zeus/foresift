import {
  TokenControlClassification,
  TokenControlKind,
  TransferExtensionVerdict,
  type TokenControlFinding,
  type TokenExtensionSupport,
} from '@foresift/domain';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const TOKEN_ASSESSMENT_ANALYZER_VERSION = 'solsec-token-assessment@1';
export const TOKEN_ASSESSMENT_POLICY_VERSION = 'solsec-token-controls@1';

export interface SupportedTokenProgramLayout {
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutVersion: string;
}

/** The built-in matrix is deliberately exact. Callers must register any new layout explicitly. */
export const SUPPORTED_TOKEN_PROGRAM_LAYOUTS: readonly SupportedTokenProgramLayout[] = [
  { programId: SPL_TOKEN_PROGRAM_ID, programVersion: '1.0.0', layoutVersion: 'mint-v1' },
  { programId: TOKEN_2022_PROGRAM_ID, programVersion: '1.0.0', layoutVersion: 'mint-tlv-v1' },
];

export interface TokenExtensionSnapshot {
  readonly type: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface TokenAssessmentInput {
  readonly assetRepresentationId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutVersion: string;
  readonly mintAuthority?: string | null;
  readonly freezeAuthority?: string | null;
  readonly decimals?: number;
  readonly totalSupplyRaw?: string;
  readonly extensions?: readonly TokenExtensionSnapshot[];
  readonly analyzerVersion?: string;
  readonly policyVersion?: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly availableAt: string;
  readonly supportedProgramLayouts?: readonly SupportedTokenProgramLayout[];
}

export interface TokenAssessmentResult {
  readonly findings: readonly TokenControlFinding[];
  readonly supportRows: readonly TokenExtensionSupport[];
  readonly qualityCodes: readonly string[];
  readonly programSupported: boolean;
}

type MutableFinding = Omit<TokenControlFinding, 'findingId' | 'qualityCodes'> & {
  qualityCodes: readonly string[];
};

const EXTENSION_ALIASES: Readonly<Record<string, string>> = {
  permanentdelegate: 'PERMANENT_DELEGATE',
  transferfeeconfig: 'TRANSFER_FEE_CONFIGURATION',
  transferfeeconfiguration: 'TRANSFER_FEE_CONFIGURATION',
  transferhook: 'TRANSFER_HOOK_PROGRAM',
  transferhookprogram: 'TRANSFER_HOOK_PROGRAM',
  defaultaccountstate: 'DEFAULT_ACCOUNT_STATE',
  mintcloseauthority: 'CLOSE_AUTHORITY',
  closeauthority: 'CLOSE_AUTHORITY',
  nontransferable: 'NON_TRANSFERABLE',
  nontransferableaccount: 'NON_TRANSFERABLE',
  confidentialtransfermint: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferaccount: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferfeeconfig: 'CONFIDENTIAL_TRANSFER',
  confidentialtransferfeeamount: 'CONFIDENTIAL_TRANSFER',
  confidentialmintburn: 'CONFIDENTIAL_TRANSFER',
  metadatapointer: 'METADATA_AUTHORITY',
  tokenmetadata: 'METADATA_AUTHORITY',
  metadata: 'METADATA_AUTHORITY',
};

function normalizeExtensionName(value: string): string | undefined {
  return EXTENSION_ALIASES[value.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase()];
}

function tupleSupported(input: TokenAssessmentInput): boolean {
  const matrix = input.supportedProgramLayouts ?? SUPPORTED_TOKEN_PROGRAM_LAYOUTS;
  return matrix.some(
    (entry) =>
      entry.programId === input.programId &&
      entry.programVersion === input.programVersion &&
      entry.layoutVersion === input.layoutVersion,
  );
}

function authorityValue(data: Readonly<Record<string, unknown>>, ...keys: string[]): unknown {
  for (const key of keys) if (Object.hasOwn(data, key)) return data[key];
  return undefined;
}

function authorityClassification(value: unknown): TokenControlFinding['classification'] {
  if (value === null) return TokenControlClassification.REVOKED_AUTHORITY;
  if (typeof value === 'string' && value.length > 0)
    return TokenControlClassification.ADMINISTRATIVE_CONTROL;
  return TokenControlClassification.UNABLE_TO_VERIFY;
}

function stableRowId(prefix: string, input: TokenAssessmentInput, suffix: string): string {
  const parts = [
    input.assetRepresentationId,
    input.programId,
    input.programVersion,
    input.layoutVersion,
    input.availableAt,
    suffix,
  ];
  return `${prefix}:${parts.map((part) => encodeURIComponent(part)).join(':')}`;
}

function assertTemporalInput(input: TokenAssessmentInput): void {
  const observed = Date.parse(input.observedAt);
  const available = Date.parse(input.availableAt);
  if (!Number.isFinite(observed) || !Number.isFinite(available)) throw new Error('INVALID_TIMESTAMP');
  if (available < observed) throw new Error('AVAILABLE_AT_PRECEDES_OBSERVED_AT');
}

/**
 * Parse one already-decoded mint snapshot. No provider claims or inferred extension
 * behavior participate in this function; unknown data is retained and fails closed.
 */
export function assessTokenControls(input: TokenAssessmentInput): TokenAssessmentResult {
  assertTemporalInput(input);
  const analyzerVersion = input.analyzerVersion ?? TOKEN_ASSESSMENT_ANALYZER_VERSION;
  const policyVersion = input.policyVersion ?? TOKEN_ASSESSMENT_POLICY_VERSION;
  const findings: TokenControlFinding[] = [];
  const supportRows: TokenExtensionSupport[] = [];
  const topLevelQuality = new Set<string>();

  const addFinding = (
    control: TokenControlFinding['control'],
    classification: TokenControlFinding['classification'],
    value: unknown,
    qualityCodes: readonly string[] = ['VALID'],
    discriminator: string = control,
  ): void => {
    const row: MutableFinding = {
      assetRepresentationId: input.assetRepresentationId,
      programId: input.programId,
      programVersion: input.programVersion,
      layoutVersion: input.layoutVersion,
      control,
      classification,
      value,
      analyzerVersion,
      policyVersion,
      evidenceRef: input.evidenceRef,
      observedAt: input.observedAt,
      availableAt: input.availableAt,
      qualityCodes,
    };
    findings.push({
      ...row,
      findingId: stableRowId('token-finding', input, discriminator),
    });
    for (const code of qualityCodes) if (code !== 'VALID') topLevelQuality.add(code);
  };

  const addSupport = (extension: string, verdict: TokenExtensionSupport['verdict']): void => {
    supportRows.push({
      supportId: stableRowId('token-support', input, `${policyVersion}:${extension}`),
      assetRepresentationId: input.assetRepresentationId,
      programId: input.programId,
      programVersion: input.programVersion,
      layoutVersion: input.layoutVersion,
      extension,
      verdict,
      verdictPolicyVersion: policyVersion,
      analyzerVersion,
      evidenceRef: input.evidenceRef,
      observedAt: input.observedAt,
      availableAt: input.availableAt,
    });
  };

  const programSupported = tupleSupported(input);
  addFinding(
    TokenControlKind.PROGRAM_OWNER,
    programSupported
      ? TokenControlClassification.NEUTRAL_CONFIGURATION
      : TokenControlClassification.UNABLE_TO_VERIFY,
    { programId: input.programId, programVersion: input.programVersion, layoutVersion: input.layoutVersion },
    programSupported ? ['VALID'] : ['UNSUPPORTED_PROGRAM_VERSION'],
  );

  if (!programSupported) {
    addSupport('PROGRAM_OR_LAYOUT', TransferExtensionVerdict.UNKNOWN_REQUIRED);
    return {
      findings,
      supportRows,
      qualityCodes: [...topLevelQuality],
      programSupported: false,
    };
  }

  addFinding(
    TokenControlKind.MINT_AUTHORITY,
    authorityClassification(input.mintAuthority),
    input.mintAuthority,
    input.mintAuthority === undefined ? ['PARTIAL'] : ['VALID'],
  );
  addFinding(
    TokenControlKind.FREEZE_AUTHORITY,
    authorityClassification(input.freezeAuthority),
    input.freezeAuthority,
    input.freezeAuthority === undefined ? ['PARTIAL'] : ['VALID'],
  );
  addFinding(
    TokenControlKind.DECIMALS,
    Number.isInteger(input.decimals) && (input.decimals ?? -1) >= 0 && (input.decimals ?? 256) <= 255
      ? TokenControlClassification.NEUTRAL_CONFIGURATION
      : TokenControlClassification.UNABLE_TO_VERIFY,
    input.decimals,
    input.decimals === undefined ? ['DECIMAL_UNCERTAIN'] : ['VALID'],
  );
  addFinding(
    TokenControlKind.TOTAL_SUPPLY,
    typeof input.totalSupplyRaw === 'string' && /^\d+$/.test(input.totalSupplyRaw)
      ? TokenControlClassification.NEUTRAL_CONFIGURATION
      : TokenControlClassification.UNABLE_TO_VERIFY,
    input.totalSupplyRaw,
    input.totalSupplyRaw === undefined ? ['SUPPLY_UNCERTAIN'] : ['VALID'],
  );

  for (const [index, extension] of (input.extensions ?? []).entries()) {
    const canonical = normalizeExtensionName(extension.type);
    const data = extension.data ?? {};
    if (canonical === undefined) {
      addFinding(
        TokenControlKind.UNKNOWN_EXTENSION,
        TokenControlClassification.UNABLE_TO_VERIFY,
        { extensionType: extension.type, data },
        ['TOKEN_EXTENSION_UNKNOWN'],
        `UNKNOWN_EXTENSION:${index}:${extension.type}`,
      );
      addSupport(extension.type, TransferExtensionVerdict.UNKNOWN_REQUIRED);
      continue;
    }

    if (canonical === 'PERMANENT_DELEGATE') {
      const value = authorityValue(data, 'delegate', 'authority', 'permanentDelegate');
      addFinding(TokenControlKind.PERMANENT_DELEGATE, authorityClassification(value), value);
    } else if (canonical === 'TRANSFER_FEE_CONFIGURATION') {
      const configAuthority = authorityValue(data, 'configAuthority', 'transferFeeConfigAuthority', 'authority');
      const withheldAuthority = authorityValue(data, 'withdrawWithheldAuthority', 'withheldAuthority');
      addFinding(
        TokenControlKind.TRANSFER_FEE_CONFIGURATION,
        authorityClassification(configAuthority),
        data,
      );
      addFinding(
        TokenControlKind.TRANSFER_FEE_WITHHELD_AUTHORITY,
        authorityClassification(withheldAuthority),
        withheldAuthority,
      );
    } else if (canonical === 'TRANSFER_HOOK_PROGRAM') {
      const value = authorityValue(data, 'programId', 'hookProgramId', 'authority');
      addFinding(TokenControlKind.TRANSFER_HOOK_PROGRAM, authorityClassification(value), value);
    } else if (canonical === 'DEFAULT_ACCOUNT_STATE') {
      const value = authorityValue(data, 'state', 'defaultState');
      addFinding(
        TokenControlKind.DEFAULT_ACCOUNT_STATE,
        value === 'Frozen'
          ? TokenControlClassification.KNOWN_RISK
          : value === undefined
            ? TokenControlClassification.UNABLE_TO_VERIFY
            : TokenControlClassification.NEUTRAL_CONFIGURATION,
        value,
      );
    } else if (canonical === 'CLOSE_AUTHORITY') {
      const value = authorityValue(data, 'closeAuthority', 'authority');
      addFinding(TokenControlKind.CLOSE_AUTHORITY, authorityClassification(value), value);
    } else if (canonical === 'NON_TRANSFERABLE') {
      addFinding(
        TokenControlKind.NON_TRANSFERABLE,
        TokenControlClassification.KNOWN_RISK,
        data,
      );
    } else if (canonical === 'CONFIDENTIAL_TRANSFER') {
      const value = authorityValue(data, 'authority', 'confidentialTransferAuthority');
      addFinding(
        TokenControlKind.CONFIDENTIAL_TRANSFER,
        value === undefined
          ? TokenControlClassification.NEUTRAL_CONFIGURATION
          : authorityClassification(value),
        { extensionType: extension.type, ...data },
      );
    } else {
      const metadataAuthority = authorityValue(data, 'authority', 'metadataAuthority');
      const updateAuthority = authorityValue(data, 'updateAuthority');
      addFinding(
        TokenControlKind.METADATA_AUTHORITY,
        authorityClassification(metadataAuthority),
        metadataAuthority,
      );
      addFinding(
        TokenControlKind.UPDATE_AUTHORITY,
        authorityClassification(updateAuthority),
        updateAuthority,
      );
    }
  }

  return {
    findings,
    supportRows,
    qualityCodes: topLevelQuality.size === 0 ? ['VALID'] : [...topLevelQuality],
    programSupported: true,
  };
}

/** Point-in-time read helper: future-available evidence is invisible to a replay. */
export function tokenFindingsAvailableAt(
  findings: readonly TokenControlFinding[],
  replayAt: string,
): readonly TokenControlFinding[] {
  const cutoff = Date.parse(replayAt);
  if (!Number.isFinite(cutoff)) throw new Error('INVALID_REPLAY_TIMESTAMP');
  return findings.filter((finding) => Date.parse(finding.availableAt) <= cutoff);
}

export const analyzeTokenAssessment = assessTokenControls;
