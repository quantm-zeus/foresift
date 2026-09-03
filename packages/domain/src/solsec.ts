/**
 * Deterministic Solana token, pool, provider, and system-address vocabularies.
 *
 * These parsers are deliberately fail-closed. Values received across a trust
 * boundary must be parsed; unknown future values are never treated as safe.
 * Traces: FR-SOLSEC-001, FR-SOLSEC-002, FR-SOLSEC-003, FR-SOLSEC-004,
 * FR-SOLSEC-005, FR-SOLSEC-006.
 */

export const TokenControl = {
  MINT: 'MINT',
  FREEZE: 'FREEZE',
  PERMANENT_DELEGATE: 'PERMANENT_DELEGATE',
  TRANSFER_FEE: 'TRANSFER_FEE',
  TRANSFER_HOOK: 'TRANSFER_HOOK',
  CLOSE: 'CLOSE',
  METADATA_UPDATE: 'METADATA_UPDATE',
  DEFAULT_STATE: 'DEFAULT_STATE',
  NON_TRANSFERABLE: 'NON_TRANSFERABLE',
  CONFIDENTIAL_TRANSFER: 'CONFIDENTIAL_TRANSFER',
  UNKNOWN_EXTENSION: 'UNKNOWN_EXTENSION',
} as const;
export type TokenControl = (typeof TokenControl)[keyof typeof TokenControl];

export const TokenControlState = {
  KNOWN_RISK: 'KNOWN_RISK',
  ADMINISTRATIVE_CONTROL: 'ADMINISTRATIVE_CONTROL',
  NEUTRAL_CONFIGURATION: 'NEUTRAL_CONFIGURATION',
  REVOKED_AUTHORITY: 'REVOKED_AUTHORITY',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type TokenControlState = (typeof TokenControlState)[keyof typeof TokenControlState];

export const SecuritySeverity = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
} as const;
export type SecuritySeverity = (typeof SecuritySeverity)[keyof typeof SecuritySeverity];

export const TransferSemanticsSupport = {
  KNOWN_MODELED: 'KNOWN_MODELED',
  KNOWN_UNMODELED: 'KNOWN_UNMODELED',
  UNKNOWN_REQUIRED: 'UNKNOWN_REQUIRED',
  NOT_PRESENT: 'NOT_PRESENT',
} as const;
export type TransferSemanticsSupport =
  (typeof TransferSemanticsSupport)[keyof typeof TransferSemanticsSupport];

export const PoolSupportState = {
  RESOLVED: 'RESOLVED',
  DEGRADED_UNSUPPORTED: 'DEGRADED_UNSUPPORTED',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type PoolSupportState = (typeof PoolSupportState)[keyof typeof PoolSupportState];

export const LpControlState = {
  BURNED: 'BURNED',
  LOCKED: 'LOCKED',
  OPEN: 'OPEN',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type LpControlState = (typeof LpControlState)[keyof typeof LpControlState];

export const WithdrawalAuthorityState = {
  REVOKED: 'REVOKED',
  PRESENT: 'PRESENT',
  PRESENT_WITH_OBSERVED_ABUSE: 'PRESENT_WITH_OBSERVED_ABUSE',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type WithdrawalAuthorityState =
  (typeof WithdrawalAuthorityState)[keyof typeof WithdrawalAuthorityState];

export const LiquidityRemovalRisk = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNKNOWN: 'UNKNOWN',
} as const;
export type LiquidityRemovalRisk = (typeof LiquidityRemovalRisk)[keyof typeof LiquidityRemovalRisk];

export const QuoteParityState = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type QuoteParityState = (typeof QuoteParityState)[keyof typeof QuoteParityState];

export const StateCompleteness = {
  COMPLETE: 'COMPLETE',
  INCOMPLETE: 'INCOMPLETE',
  DEGRADED: 'DEGRADED',
} as const;
export type StateCompleteness = (typeof StateCompleteness)[keyof typeof StateCompleteness];

/** Appendix Q.2 roles. */
export const SystemAddressRole = {
  PROGRAM: 'PROGRAM',
  ROUTER: 'ROUTER',
  POOL: 'POOL',
  LAUNCHPAD: 'LAUNCHPAD',
  BRIDGE: 'BRIDGE',
  EXCHANGE_SERVICE: 'EXCHANGE_SERVICE',
  MARKET_MAKER: 'MARKET_MAKER',
  FEE_COLLECTOR: 'FEE_COLLECTOR',
  BURN_LOCK: 'BURN_LOCK',
  UNKNOWN_INFRASTRUCTURE: 'UNKNOWN_INFRASTRUCTURE',
} as const;
export type SystemAddressRole = (typeof SystemAddressRole)[keyof typeof SystemAddressRole];

export const SystemAddressReviewState = {
  APPROVED: 'APPROVED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  REJECTED: 'REJECTED',
} as const;
export type SystemAddressReviewState =
  (typeof SystemAddressReviewState)[keyof typeof SystemAddressReviewState];

export const ProviderVerdict = {
  SAFE: 'SAFE',
  RISK_DETECTED: 'RISK_DETECTED',
  UNABLE_TO_VERIFY: 'UNABLE_TO_VERIFY',
} as const;
export type ProviderVerdict = (typeof ProviderVerdict)[keyof typeof ProviderVerdict];

/** Conflict classes from the Solana-security conflict-resolution ADR. */
export const SecurityConflictClass = {
  PROVIDER_OPTIMISM_OVERRIDDEN: 'PROVIDER_OPTIMISM_OVERRIDDEN',
  UNRESOLVED_PROVIDER_RISK: 'UNRESOLVED_PROVIDER_RISK',
  CORROBORATED_RISK: 'CORROBORATED_RISK',
  NO_CONFLICT: 'NO_CONFLICT',
} as const;
export type SecurityConflictClass =
  (typeof SecurityConflictClass)[keyof typeof SecurityConflictClass];

export const SolsecErrorCode = {
  TOKEN_CONTROL_UNKNOWN: 'TOKEN_CONTROL_UNKNOWN',
  TOKEN_CONTROL_STATE_UNKNOWN: 'TOKEN_CONTROL_STATE_UNKNOWN',
  SECURITY_SEVERITY_UNKNOWN: 'SECURITY_SEVERITY_UNKNOWN',
  TRANSFER_SEMANTICS_SUPPORT_UNKNOWN: 'TRANSFER_SEMANTICS_SUPPORT_UNKNOWN',
  POOL_SUPPORT_STATE_UNKNOWN: 'POOL_SUPPORT_STATE_UNKNOWN',
  LP_CONTROL_STATE_UNKNOWN: 'LP_CONTROL_STATE_UNKNOWN',
  WITHDRAWAL_AUTHORITY_STATE_UNKNOWN: 'WITHDRAWAL_AUTHORITY_STATE_UNKNOWN',
  LIQUIDITY_REMOVAL_RISK_UNKNOWN: 'LIQUIDITY_REMOVAL_RISK_UNKNOWN',
  QUOTE_PARITY_STATE_UNKNOWN: 'QUOTE_PARITY_STATE_UNKNOWN',
  STATE_COMPLETENESS_UNKNOWN: 'STATE_COMPLETENESS_UNKNOWN',
  SYSTEM_ADDRESS_ROLE_UNKNOWN: 'SYSTEM_ADDRESS_ROLE_UNKNOWN',
  SYSTEM_ADDRESS_REVIEW_STATE_UNKNOWN: 'SYSTEM_ADDRESS_REVIEW_STATE_UNKNOWN',
  PROVIDER_VERDICT_UNKNOWN: 'PROVIDER_VERDICT_UNKNOWN',
  SECURITY_CONFLICT_CLASS_UNKNOWN: 'SECURITY_CONFLICT_CLASS_UNKNOWN',
} as const;
export type SolsecErrorCode = (typeof SolsecErrorCode)[keyof typeof SolsecErrorCode];

/** Typed parse failure carrying a stable, vocabulary-specific machine code. */
export class SolsecVocabularyError extends RangeError {
  readonly code: SolsecErrorCode;
  readonly value: unknown;

  constructor(code: SolsecErrorCode, value: unknown) {
    super(`${code}: unknown Solana security vocabulary value ${JSON.stringify(value)}`);
    this.name = 'SolsecVocabularyError';
    this.code = code;
    this.value = value;
  }
}

function parseVocabulary<T extends string>(
  values: readonly T[],
  value: unknown,
  code: SolsecErrorCode,
): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new SolsecVocabularyError(code, value);
  }
  return value as T;
}

export const ALL_TOKEN_CONTROLS: readonly TokenControl[] = Object.values(TokenControl);
export const ALL_TOKEN_CONTROL_STATES: readonly TokenControlState[] =
  Object.values(TokenControlState);
export const ALL_SECURITY_SEVERITIES: readonly SecuritySeverity[] = Object.values(SecuritySeverity);
export const ALL_TRANSFER_SEMANTICS_SUPPORTS: readonly TransferSemanticsSupport[] =
  Object.values(TransferSemanticsSupport);
export const ALL_POOL_SUPPORT_STATES: readonly PoolSupportState[] = Object.values(PoolSupportState);
export const ALL_LP_CONTROL_STATES: readonly LpControlState[] = Object.values(LpControlState);
export const ALL_WITHDRAWAL_AUTHORITY_STATES: readonly WithdrawalAuthorityState[] =
  Object.values(WithdrawalAuthorityState);
export const ALL_LIQUIDITY_REMOVAL_RISKS: readonly LiquidityRemovalRisk[] =
  Object.values(LiquidityRemovalRisk);
export const ALL_QUOTE_PARITY_STATES: readonly QuoteParityState[] = Object.values(QuoteParityState);
export const ALL_STATE_COMPLETENESSES: readonly StateCompleteness[] =
  Object.values(StateCompleteness);
export const ALL_SYSTEM_ADDRESS_ROLES: readonly SystemAddressRole[] =
  Object.values(SystemAddressRole);
export const ALL_SYSTEM_ADDRESS_REVIEW_STATES: readonly SystemAddressReviewState[] =
  Object.values(SystemAddressReviewState);
export const ALL_PROVIDER_VERDICTS: readonly ProviderVerdict[] = Object.values(ProviderVerdict);
export const ALL_SECURITY_CONFLICT_CLASSES: readonly SecurityConflictClass[] =
  Object.values(SecurityConflictClass);

export const tokenControl = (value: unknown): TokenControl =>
  parseVocabulary(ALL_TOKEN_CONTROLS, value, SolsecErrorCode.TOKEN_CONTROL_UNKNOWN);
export const tokenControlState = (value: unknown): TokenControlState =>
  parseVocabulary(ALL_TOKEN_CONTROL_STATES, value, SolsecErrorCode.TOKEN_CONTROL_STATE_UNKNOWN);
export const securitySeverity = (value: unknown): SecuritySeverity =>
  parseVocabulary(ALL_SECURITY_SEVERITIES, value, SolsecErrorCode.SECURITY_SEVERITY_UNKNOWN);
export const transferSemanticsSupport = (value: unknown): TransferSemanticsSupport =>
  parseVocabulary(
    ALL_TRANSFER_SEMANTICS_SUPPORTS,
    value,
    SolsecErrorCode.TRANSFER_SEMANTICS_SUPPORT_UNKNOWN,
  );
export const poolSupportState = (value: unknown): PoolSupportState =>
  parseVocabulary(ALL_POOL_SUPPORT_STATES, value, SolsecErrorCode.POOL_SUPPORT_STATE_UNKNOWN);
export const lpControlState = (value: unknown): LpControlState =>
  parseVocabulary(ALL_LP_CONTROL_STATES, value, SolsecErrorCode.LP_CONTROL_STATE_UNKNOWN);
export const withdrawalAuthorityState = (value: unknown): WithdrawalAuthorityState =>
  parseVocabulary(
    ALL_WITHDRAWAL_AUTHORITY_STATES,
    value,
    SolsecErrorCode.WITHDRAWAL_AUTHORITY_STATE_UNKNOWN,
  );
export const liquidityRemovalRisk = (value: unknown): LiquidityRemovalRisk =>
  parseVocabulary(
    ALL_LIQUIDITY_REMOVAL_RISKS,
    value,
    SolsecErrorCode.LIQUIDITY_REMOVAL_RISK_UNKNOWN,
  );
export const quoteParityState = (value: unknown): QuoteParityState =>
  parseVocabulary(ALL_QUOTE_PARITY_STATES, value, SolsecErrorCode.QUOTE_PARITY_STATE_UNKNOWN);
export const stateCompleteness = (value: unknown): StateCompleteness =>
  parseVocabulary(ALL_STATE_COMPLETENESSES, value, SolsecErrorCode.STATE_COMPLETENESS_UNKNOWN);
export const systemAddressRole = (value: unknown): SystemAddressRole =>
  parseVocabulary(ALL_SYSTEM_ADDRESS_ROLES, value, SolsecErrorCode.SYSTEM_ADDRESS_ROLE_UNKNOWN);
export const systemAddressReviewState = (value: unknown): SystemAddressReviewState =>
  parseVocabulary(
    ALL_SYSTEM_ADDRESS_REVIEW_STATES,
    value,
    SolsecErrorCode.SYSTEM_ADDRESS_REVIEW_STATE_UNKNOWN,
  );
export const providerVerdict = (value: unknown): ProviderVerdict =>
  parseVocabulary(ALL_PROVIDER_VERDICTS, value, SolsecErrorCode.PROVIDER_VERDICT_UNKNOWN);
export const securityConflictClass = (value: unknown): SecurityConflictClass =>
  parseVocabulary(
    ALL_SECURITY_CONFLICT_CLASSES,
    value,
    SolsecErrorCode.SECURITY_CONFLICT_CLASS_UNKNOWN,
  );

/** FR-SOLSEC-004 blocking substrate: unknown required semantics always block. */
export function profileRequiresCompleteExecutionModeling(
  support: TransferSemanticsSupport | { readonly supportState: unknown } | readonly unknown[],
): boolean {
  if (Array.isArray(support))
    return support.some((item) =>
      profileRequiresCompleteExecutionModeling(item as TransferSemanticsSupport),
    );
  const value =
    typeof support === 'object' && support !== null
      ? (support as { readonly supportState: unknown }).supportState
      : support;
  return transferSemanticsSupport(value) === TransferSemanticsSupport.UNKNOWN_REQUIRED;
}

export const SYSTEM_ADDRESS_EXCLUSION_MIN_CONFIDENCE = 0.8;

/** Appendix Q.2/ADR-3 exclusion rule. Invalid confidence fails closed. */
export function isExcludableSystemAddress(
  role: SystemAddressRole,
  confidence: number,
  reviewState: SystemAddressReviewState,
): boolean {
  const parsedRole = systemAddressRole(role);
  const parsedReviewState = systemAddressReviewState(reviewState);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    throw new RangeError('SYSTEM_ADDRESS_CONFIDENCE_OUT_OF_RANGE');
  return (
    parsedRole !== SystemAddressRole.UNKNOWN_INFRASTRUCTURE &&
    parsedReviewState === SystemAddressReviewState.APPROVED &&
    confidence >= SYSTEM_ADDRESS_EXCLUSION_MIN_CONFIDENCE
  );
}
