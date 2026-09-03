/** Deterministic Solana security vocabulary (FR-SOLSEC-001..004). */

export const TokenControlClassification = {
  KNOWN_RISK: 'KNOWN_RISK',
  ADMINISTRATIVE_CONTROL: 'ADMINISTRATIVE_CONTROL',
  NEUTRAL_CONFIGURATION: 'NEUTRAL_CONFIGURATION',
  REVOKED_AUTHORITY: 'REVOKED_AUTHORITY',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type TokenControlClassification =
  (typeof TokenControlClassification)[keyof typeof TokenControlClassification];

export const TokenControlKind = {
  PROGRAM_OWNER: 'PROGRAM_OWNER',
  MINT_AUTHORITY: 'MINT_AUTHORITY',
  FREEZE_AUTHORITY: 'FREEZE_AUTHORITY',
  PERMANENT_DELEGATE: 'PERMANENT_DELEGATE',
  TRANSFER_FEE_CONFIGURATION: 'TRANSFER_FEE_CONFIGURATION',
  TRANSFER_FEE_WITHHELD_AUTHORITY: 'TRANSFER_FEE_WITHHELD_AUTHORITY',
  TRANSFER_HOOK_PROGRAM: 'TRANSFER_HOOK_PROGRAM',
  DEFAULT_ACCOUNT_STATE: 'DEFAULT_ACCOUNT_STATE',
  CLOSE_AUTHORITY: 'CLOSE_AUTHORITY',
  NON_TRANSFERABLE: 'NON_TRANSFERABLE',
  CONFIDENTIAL_TRANSFER: 'CONFIDENTIAL_TRANSFER',
  METADATA_AUTHORITY: 'METADATA_AUTHORITY',
  UPDATE_AUTHORITY: 'UPDATE_AUTHORITY',
  DECIMALS: 'DECIMALS',
  TOTAL_SUPPLY: 'TOTAL_SUPPLY',
  UNKNOWN_EXTENSION: 'UNKNOWN_EXTENSION',
} as const;
export type TokenControlKind = (typeof TokenControlKind)[keyof typeof TokenControlKind];

export const TransferExtensionVerdict = {
  KNOWN_MODELED: 'KNOWN_MODELED',
  KNOWN_UNMODELED: 'KNOWN_UNMODELED',
  UNKNOWN_REQUIRED: 'UNKNOWN_REQUIRED',
  NOT_PRESENT: 'NOT_PRESENT',
} as const;
export type TransferExtensionVerdict =
  (typeof TransferExtensionVerdict)[keyof typeof TransferExtensionVerdict];

export interface TokenControlFinding {
  readonly findingId: string;
  readonly assetRepresentationId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutVersion: string;
  readonly control: TokenControlKind;
  readonly classification: TokenControlClassification;
  readonly value: unknown;
  readonly analyzerVersion: string;
  readonly policyVersion: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly availableAt: string;
  readonly qualityCodes: readonly string[];
}

export interface TokenExtensionSupport {
  readonly supportId: string;
  readonly assetRepresentationId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly layoutVersion: string;
  readonly extension: string;
  readonly verdict: TransferExtensionVerdict;
  readonly verdictPolicyVersion: string;
  readonly analyzerVersion: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly availableAt: string;
}

export const PoolAssessmentState = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  DEGRADED_UNSUPPORTED: 'DEGRADED_UNSUPPORTED',
} as const;
export type PoolAssessmentState = (typeof PoolAssessmentState)[keyof typeof PoolAssessmentState];

export const PositionControlState = {
  BURNED: 'BURNED',
  LOCKED_WITH_EVIDENCE: 'LOCKED_WITH_EVIDENCE',
  OPEN: 'OPEN',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type PositionControlState = (typeof PositionControlState)[keyof typeof PositionControlState];

export const WithdrawalAuthorityState = {
  REVOKED: 'REVOKED',
  PRESENT: 'PRESENT',
  PRESENT_WITH_OBSERVED_ABUSE: 'PRESENT_WITH_OBSERVED_ABUSE',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type WithdrawalAuthorityState =
  (typeof WithdrawalAuthorityState)[keyof typeof WithdrawalAuthorityState];

export interface PoolSecurityAssessment {
  readonly assessmentId: string;
  readonly poolId: string;
  readonly state: PoolAssessmentState;
  readonly protocolFamily: string | null;
  readonly decoderVersion: string | null;
  readonly poolOwner: string | null;
  readonly positionControl: PositionControlState | null;
  readonly lockEvidenceRef: string | null;
  readonly withdrawalAuthority: WithdrawalAuthorityState | null;
  readonly migrationLineageRef: string | null;
  readonly quoteParityPassed: boolean | null;
  readonly liquidityConcentration: number | null;
  readonly recentLiquidityAddsRaw: string | null;
  readonly recentLiquidityRemovalsRaw: string | null;
  readonly largeSellImpactBps: number | null;
  readonly stateComplete: boolean;
  readonly qualityCodes: readonly string[];
  readonly analyzerVersion: string;
  readonly policyVersion: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly availableAt: string;
}
