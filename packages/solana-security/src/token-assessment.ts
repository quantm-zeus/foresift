import {
  parseChainId,
  SecuritySeverity,
  TokenControl,
  TokenControlState,
  TransferSemanticsSupport,
  type QualityCode,
} from '@foresift/domain';
import { canonicalJson, sha256Text } from '@foresift/persistence';
import type {
  TokenControlFinding,
  TokenExtensionSupport,
  TokenProgramAssessment,
} from '@foresift/shared-schemas';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const TOKEN_ASSESSMENT_ANALYZER_VERSION = 'solsec-token-assessment@1';
export const TOKEN_ASSESSMENT_POLICY_VERSION = 'solsec-token-controls@1';

export interface SupportedTokenProgramLayout {
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutVersion: string;
}
export const SUPPORTED_TOKEN_PROGRAM_LAYOUTS: readonly SupportedTokenProgramLayout[] = [
  { programId: SPL_TOKEN_PROGRAM_ID, programVersion: '1.0.0', layoutVersion: 'mint-v1' },
  { programId: TOKEN_2022_PROGRAM_ID, programVersion: '1.0.0', layoutVersion: 'mint-tlv-v1' },
];
export interface TokenExtensionSnapshot {
  readonly type: string | number;
  readonly data?: Readonly<Record<string, unknown>>;
}
export interface TokenAssessmentInput {
  readonly assetRepresentationId: string;
  readonly chainId?: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutVersion: string;
  readonly mintAuthority?: string | null;
  readonly freezeAuthority?: string | null;
  readonly decimals: number;
  readonly totalSupplyRaw: string;
  readonly extensions?: readonly TokenExtensionSnapshot[];
  readonly analyzerVersion?: string;
  readonly policyVersion?: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly availableAt: string;
  readonly supportedProgramLayouts?: readonly SupportedTokenProgramLayout[];
}
export interface TokenAssessmentResult {
  readonly assessment: TokenProgramAssessment;
  readonly findings: readonly TokenControlFinding[];
  readonly supportRows: readonly TokenExtensionSupport[];
  readonly qualityCodes: readonly string[];
  readonly programSupported: boolean;
}

const ALIASES: Readonly<Record<string, TokenControl>> = {
  permanentdelegate: TokenControl.PERMANENT_DELEGATE,
  transferfeeconfig: TokenControl.TRANSFER_FEE,
  transferfeeconfiguration: TokenControl.TRANSFER_FEE,
  transferhook: TokenControl.TRANSFER_HOOK,
  transferhookprogram: TokenControl.TRANSFER_HOOK,
  defaultaccountstate: TokenControl.DEFAULT_STATE,
  mintcloseauthority: TokenControl.CLOSE,
  closeauthority: TokenControl.CLOSE,
  nontransferable: TokenControl.NON_TRANSFERABLE,
  nontransferableaccount: TokenControl.NON_TRANSFERABLE,
  confidentialtransfermint: TokenControl.CONFIDENTIAL_TRANSFER,
  confidentialtransferaccount: TokenControl.CONFIDENTIAL_TRANSFER,
  confidentialtransferfeeconfig: TokenControl.CONFIDENTIAL_TRANSFER,
  confidentialtransferfeeamount: TokenControl.CONFIDENTIAL_TRANSFER,
  confidentialmintburn: TokenControl.CONFIDENTIAL_TRANSFER,
  metadatapointer: TokenControl.METADATA_UPDATE,
  tokenmetadata: TokenControl.METADATA_UPDATE,
  metadata: TokenControl.METADATA_UPDATE,
};
const normalize = (value: string): TokenControl | undefined =>
  ALIASES[value.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase()];
const hash = (value: unknown): string => sha256Text(canonicalJson(value));
function authorityState(
  value: unknown,
  activeState: TokenControlState = TokenControlState.ADMINISTRATIVE_CONTROL,
): TokenControlState {
  if (value === null) return TokenControlState.REVOKED_AUTHORITY;
  return typeof value === 'string' && value.trim().length > 0
    ? activeState
    : TokenControlState.UNABLE_TO_VERIFY;
}
function field(data: Readonly<Record<string, unknown>>, ...keys: string[]): unknown {
  for (const key of keys) if (Object.hasOwn(data, key)) return data[key];
  return undefined;
}
function assertInput(input: TokenAssessmentInput): void {
  const observedAt = Date.parse(input.observedAt);
  const availableAt = Date.parse(input.availableAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(availableAt))
    throw new Error('INVALID_ASSESSMENT_TIMESTAMP');
  if (availableAt < observedAt) throw new Error('AVAILABLE_AT_PRECEDES_OBSERVED_AT');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 255)
    throw new Error('INVALID_DECIMALS');
  if (!/^\d+$/.test(input.totalSupplyRaw)) throw new Error('INVALID_TOTAL_SUPPLY');
}

/** Deterministically analyzes decoded SPL/Token-2022 state without provider input. */
export function assessTokenControls(input: TokenAssessmentInput): TokenAssessmentResult {
  assertInput(input);
  const analyzerVersion = input.analyzerVersion ?? TOKEN_ASSESSMENT_ANALYZER_VERSION;
  const policyVersion = input.policyVersion ?? TOKEN_ASSESSMENT_POLICY_VERSION;
  const assessmentId = `token-assessment:${[input.assetRepresentationId, input.programId, input.programVersion, input.layoutVersion, analyzerVersion, policyVersion, input.availableAt].map(encodeURIComponent).join(':')}`;
  const programSupported = (input.supportedProgramLayouts ?? SUPPORTED_TOKEN_PROGRAM_LAYOUTS).some(
    (entry) =>
      entry.programId === input.programId &&
      entry.programVersion === input.programVersion &&
      entry.layoutVersion === input.layoutVersion,
  );
  const quality = new Set<QualityCode>();
  const findings = new Map<TokenControl, TokenControlFinding>();
  const supportRows: TokenExtensionSupport[] = [];
  const addFinding = (
    control: TokenControl,
    state: TokenControlState,
    authority: unknown,
    data: unknown,
    codes: readonly QualityCode[] = ['VALID'],
    severity: SecuritySeverity | null = state === TokenControlState.KNOWN_RISK
      ? SecuritySeverity.HIGH
      : null,
  ): void => {
    for (const code of codes) if (code !== 'VALID') quality.add(code);
    findings.set(control, {
      findingId: `token-finding:${encodeURIComponent(assessmentId)}:${control}`,
      assessmentId,
      control,
      controlState: state,
      severity,
      authorityAddress: typeof authority === 'string' && authority.length > 0 ? authority : null,
      extensionDataHash: data === undefined ? null : hash(data),
      evidenceIds: [input.evidenceRef, `analyzer:${analyzerVersion}`, `policy:${policyVersion}`],
      observedAt: input.observedAt,
      availableAt: input.availableAt,
      qualityCodes: [...codes],
    });
  };
  const addSupport = (
    type: string,
    data: unknown,
    support: TransferSemanticsSupport,
    codes: readonly QualityCode[],
  ): void => {
    supportRows.push({
      assessmentId,
      extensionType: type,
      extensionDataHash: hash(data),
      support,
      verdictPolicyVersion: policyVersion,
      observedAt: input.observedAt,
      availableAt: input.availableAt,
      qualityCodes: [...codes],
    });
  };

  if (!programSupported) {
    quality.add('UNSUPPORTED_PROGRAM_VERSION');
    const tuple = {
      programId: input.programId,
      programVersion: input.programVersion,
      layoutVersion: input.layoutVersion,
    };
    addFinding(
      TokenControl.UNKNOWN_EXTENSION,
      TokenControlState.UNABLE_TO_VERIFY,
      undefined,
      tuple,
      ['UNSUPPORTED_PROGRAM_VERSION'],
    );
    addSupport('PROGRAM_OR_LAYOUT', tuple, TransferSemanticsSupport.UNKNOWN_REQUIRED, [
      'UNSUPPORTED_PROGRAM_VERSION',
    ]);
  } else {
    // Appendix Q.1 caveat: an active authority is administrative evidence, not
    // automatically malicious. Only the controls whose activation is itself
    // the known risk (frozen default state, non-transferable) and the
    // unknown-extension gap carry risk states here; freeze, permanent
    // delegate, and hook severity are decided by the versioned severity
    // policy over status/holder/observed-behavior evidence.
    const mintState = authorityState(input.mintAuthority);
    addFinding(
      TokenControl.MINT,
      mintState,
      input.mintAuthority,
      undefined,
      input.mintAuthority === undefined ? ['PARTIAL'] : ['VALID'],
      mintState === TokenControlState.ADMINISTRATIVE_CONTROL ? SecuritySeverity.MEDIUM : null,
    );
    addFinding(
      TokenControl.FREEZE,
      authorityState(input.freezeAuthority),
      input.freezeAuthority,
      undefined,
      input.freezeAuthority === undefined ? ['PARTIAL'] : ['VALID'],
    );
    const unknown: TokenExtensionSnapshot[] = [];
    for (const extension of input.extensions ?? []) {
      const extensionType = String(extension.type);
      const control = normalize(extensionType);
      const data = extension.data ?? {};
      if (control === undefined) {
        unknown.push(extension);
        addSupport(extensionType, extension, TransferSemanticsSupport.UNKNOWN_REQUIRED, [
          'TOKEN_EXTENSION_UNKNOWN',
        ]);
        continue;
      }
      let authority: unknown;
      if (control === TokenControl.PERMANENT_DELEGATE)
        authority = field(data, 'delegate', 'authority', 'permanentDelegate');
      if (control === TokenControl.TRANSFER_FEE)
        authority = field(
          data,
          'withdrawWithheldAuthority',
          'withheldAuthority',
          'configAuthority',
          'transferFeeConfigAuthority',
          'authority',
        );
      if (control === TokenControl.TRANSFER_HOOK)
        authority = field(data, 'programId', 'hookProgramId', 'authority');
      if (control === TokenControl.CLOSE) authority = field(data, 'closeAuthority', 'authority');
      if (control === TokenControl.METADATA_UPDATE)
        authority = field(data, 'updateAuthority', 'metadataAuthority', 'authority');

      let state: TokenControlState = TokenControlState.NEUTRAL_CONFIGURATION;
      let severity: SecuritySeverity = SecuritySeverity.NONE;
      if (control === TokenControl.PERMANENT_DELEGATE) {
        state = authorityState(authority);
        severity =
          state === TokenControlState.ADMINISTRATIVE_CONTROL
            ? SecuritySeverity.HIGH
            : SecuritySeverity.NONE;
      }
      if (control === TokenControl.TRANSFER_FEE) {
        const basisPoints = field(data, 'feeBasisPoints', 'transferFeeBasisPoints');
        const maximumFee = field(data, 'maxFee', 'maximumFee');
        const zeroFee =
          (basisPoints === 0 || basisPoints === '0') &&
          (maximumFee === undefined || maximumFee === 0 || maximumFee === '0');
        state = zeroFee ? TokenControlState.NEUTRAL_CONFIGURATION : authorityState(authority);
        severity =
          state === TokenControlState.ADMINISTRATIVE_CONTROL
            ? SecuritySeverity.MEDIUM
            : SecuritySeverity.NONE;
      }
      if (control === TokenControl.TRANSFER_HOOK) {
        state = authorityState(authority);
        severity =
          state === TokenControlState.ADMINISTRATIVE_CONTROL
            ? SecuritySeverity.HIGH
            : SecuritySeverity.NONE;
      }
      if (control === TokenControl.CLOSE) {
        state = authorityState(authority);
        severity =
          state === TokenControlState.ADMINISTRATIVE_CONTROL
            ? SecuritySeverity.MEDIUM
            : SecuritySeverity.NONE;
      }
      if (control === TokenControl.METADATA_UPDATE) {
        state = authorityState(authority);
        severity =
          state === TokenControlState.ADMINISTRATIVE_CONTROL
            ? SecuritySeverity.LOW
            : SecuritySeverity.NONE;
      }
      if (control === TokenControl.NON_TRANSFERABLE) {
        state = TokenControlState.KNOWN_RISK;
        severity = SecuritySeverity.HIGH;
      }
      if (control === TokenControl.CONFIDENTIAL_TRANSFER) severity = SecuritySeverity.LOW;
      if (control === TokenControl.DEFAULT_STATE) {
        const value = field(data, 'state', 'defaultState');
        state =
          value === 'Frozen'
            ? TokenControlState.KNOWN_RISK
            : value === undefined
              ? TokenControlState.UNABLE_TO_VERIFY
              : TokenControlState.NEUTRAL_CONFIGURATION;
        severity =
          state === TokenControlState.KNOWN_RISK ? SecuritySeverity.HIGH : SecuritySeverity.NONE;
      }
      addFinding(control, state, authority, { extensionType, ...data }, ['VALID'], severity);
    }
    if (unknown.length > 0)
      addFinding(
        TokenControl.UNKNOWN_EXTENSION,
        TokenControlState.UNABLE_TO_VERIFY,
        undefined,
        unknown,
        ['TOKEN_EXTENSION_UNKNOWN'],
        SecuritySeverity.HIGH,
      );
  }
  const qualityCodes: QualityCode[] = quality.size === 0 ? ['VALID'] : [...quality];
  const assessment: TokenProgramAssessment = {
    assessmentId,
    assetRepresentationId: input.assetRepresentationId,
    chainId: parseChainId(input.chainId ?? 'solana:mainnet'),
    programOwner: input.programId,
    programVersion: `${input.programVersion}/${input.layoutVersion}`,
    analyzerVersion,
    decimals: input.decimals,
    totalSupplyRaw: input.totalSupplyRaw,
    transferSemanticsSupport: supportRows.some(
      (row) => row.support === TransferSemanticsSupport.UNKNOWN_REQUIRED,
    )
      ? TransferSemanticsSupport.UNKNOWN_REQUIRED
      : TransferSemanticsSupport.KNOWN_MODELED,
    deterministicEvidenceIds: [input.evidenceRef],
    observedAt: input.observedAt,
    availableAt: input.availableAt,
    qualityCodes,
    schemaRegistryVersion: 1,
  };
  return {
    assessment,
    findings: [...findings.values()],
    supportRows,
    qualityCodes,
    programSupported,
  };
}

export function tokenFindingsAvailableAt(
  findings: readonly TokenControlFinding[],
  replayAt: string,
): readonly TokenControlFinding[] {
  const cutoff = Date.parse(replayAt);
  if (!Number.isFinite(cutoff)) throw new Error('INVALID_REPLAY_TIMESTAMP');
  return findings.filter((finding) => Date.parse(finding.availableAt) <= cutoff);
}
export const analyzeTokenAssessment = assessTokenControls;
