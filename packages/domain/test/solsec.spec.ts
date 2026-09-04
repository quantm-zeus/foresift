import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule as Record<string, any>;

const ALL_TOKEN_CONTROLS = Domain.ALL_TOKEN_CONTROLS ?? [];
const TokenControl = Domain.TokenControl ?? {};
const tokenControl = Domain.tokenControl;

const ALL_TOKEN_CONTROL_STATES = Domain.ALL_TOKEN_CONTROL_STATES ?? [];
const TokenControlState = Domain.TokenControlState ?? {};
const tokenControlState = Domain.tokenControlState;

const ALL_SECURITY_SEVERITIES = Domain.ALL_SECURITY_SEVERITIES ?? [];
const SecuritySeverity = Domain.SecuritySeverity ?? {};
const securitySeverity = Domain.securitySeverity;

const ALL_TRANSFER_SEMANTICS_SUPPORTS = Domain.ALL_TRANSFER_SEMANTICS_SUPPORTS ?? [];
const TransferSemanticsSupport = Domain.TransferSemanticsSupport ?? {};
const transferSemanticsSupport = Domain.transferSemanticsSupport;

const ALL_POOL_SUPPORT_STATES = Domain.ALL_POOL_SUPPORT_STATES ?? [];
const PoolSupportState = Domain.PoolSupportState ?? {};
const poolSupportState = Domain.poolSupportState;

const ALL_LP_CONTROL_STATES = Domain.ALL_LP_CONTROL_STATES ?? [];
const LpControlState = Domain.LpControlState ?? {};
const lpControlState = Domain.lpControlState;

const ALL_WITHDRAWAL_AUTHORITY_STATES = Domain.ALL_WITHDRAWAL_AUTHORITY_STATES ?? [];
const WithdrawalAuthorityState = Domain.WithdrawalAuthorityState ?? {};
const withdrawalAuthorityState = Domain.withdrawalAuthorityState;

const ALL_LIQUIDITY_REMOVAL_RISKS = Domain.ALL_LIQUIDITY_REMOVAL_RISKS ?? [];
const LiquidityRemovalRisk = Domain.LiquidityRemovalRisk ?? {};
const liquidityRemovalRisk = Domain.liquidityRemovalRisk;

const ALL_QUOTE_PARITY_STATES = Domain.ALL_QUOTE_PARITY_STATES ?? [];
const QuoteParityState = Domain.QuoteParityState ?? {};
const quoteParityState = Domain.quoteParityState;

const ALL_STATE_COMPLETENESSES = Domain.ALL_STATE_COMPLETENESSES ?? [];
const StateCompleteness = Domain.StateCompleteness ?? {};
const stateCompleteness = Domain.stateCompleteness;

const ALL_SYSTEM_ADDRESS_ROLES = Domain.ALL_SYSTEM_ADDRESS_ROLES ?? [];
const SystemAddressRole = Domain.SystemAddressRole ?? {};
const systemAddressRole = Domain.systemAddressRole;

const ALL_SYSTEM_ADDRESS_REVIEW_STATES = Domain.ALL_SYSTEM_ADDRESS_REVIEW_STATES ?? [];
const SystemAddressReviewState = Domain.SystemAddressReviewState ?? {};
const systemAddressReviewState = Domain.systemAddressReviewState;

const ALL_PROVIDER_VERDICTS = Domain.ALL_PROVIDER_VERDICTS ?? [];
const ProviderVerdict = Domain.ProviderVerdict ?? {};
const providerVerdict = Domain.providerVerdict;

const ALL_SECURITY_CONFLICT_CLASSES = Domain.ALL_SECURITY_CONFLICT_CLASSES ?? [];
const SecurityConflictClass = Domain.SecurityConflictClass ?? {};
const securityConflictClass = Domain.securityConflictClass;

const profileRequiresCompleteExecutionModeling = Domain.profileRequiresCompleteExecutionModeling;
const blocksCompleteExecutionModeling = Domain.blocksCompleteExecutionModeling;
const isExcludableSystemAddress = Domain.isExcludableSystemAddress;

describe('Solana Security domain vocabularies and fail-closed parsing (FR-SOLSEC-001…006)', () => {
  it('declares the §65.2 TokenControl vocabulary', () => {
    const expected = [
      'MINT',
      'FREEZE',
      'PERMANENT_DELEGATE',
      'TRANSFER_FEE',
      'TRANSFER_HOOK',
      'CLOSE',
      'METADATA_UPDATE',
      'DEFAULT_STATE',
      'NON_TRANSFERABLE',
      'CONFIDENTIAL_TRANSFER',
      'UNKNOWN_EXTENSION',
    ].sort();
    expect([...ALL_TOKEN_CONTROLS].sort()).toEqual(expected as never);
  });

  it('declares the §65.2 TokenControlState vocabulary', () => {
    const expected = [
      'KNOWN_RISK',
      'ADMINISTRATIVE_CONTROL',
      'NEUTRAL_CONFIGURATION',
      'REVOKED_AUTHORITY',
      'UNABLE_TO_VERIFY',
    ].sort();
    expect([...ALL_TOKEN_CONTROL_STATES].sort()).toEqual(expected as never);
  });

  it('declares the Appendix Q.1 SecuritySeverity vocabulary', () => {
    const expected = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'].sort();
    expect([...ALL_SECURITY_SEVERITIES].sort()).toEqual(expected as never);
  });

  it('declares the TransferSemanticsSupport vocabulary', () => {
    const expected = ['KNOWN_MODELED', 'KNOWN_UNMODELED', 'UNKNOWN_REQUIRED', 'NOT_PRESENT'].sort();
    expect([...ALL_TRANSFER_SEMANTICS_SUPPORTS].sort()).toEqual(expected as never);
  });

  it('declares the PoolSupportState vocabulary', () => {
    const expected = ['RESOLVED', 'DEGRADED_UNSUPPORTED', 'UNABLE_TO_VERIFY'].sort();
    expect([...ALL_POOL_SUPPORT_STATES].sort()).toEqual(expected as never);
  });

  it('declares the LpControlState vocabulary', () => {
    const expected = ['BURNED', 'LOCKED_WITH_EVIDENCE', 'OPEN_CONTROL', 'UNABLE_TO_VERIFY'].sort();
    expect([...ALL_LP_CONTROL_STATES].sort()).toEqual(expected as never);
  });

  it('declares the WithdrawalAuthorityState vocabulary', () => {
    const expected = [
      'REVOKED',
      'PRESENT_OPEN',
      'PRESENT_WITH_OBSERVED_ABUSE',
      'UNABLE_TO_VERIFY',
    ].sort();
    expect([...ALL_WITHDRAWAL_AUTHORITY_STATES].sort()).toEqual(expected as never);
  });

  it('declares the LiquidityRemovalRisk vocabulary', () => {
    const expected = ['NONE_EVIDENCED', 'POSSIBLE', 'OBSERVED', 'UNABLE_TO_VERIFY'].sort();
    expect([...ALL_LIQUIDITY_REMOVAL_RISKS].sort()).toEqual(expected as never);
  });

  it('declares the QuoteParityState vocabulary', () => {
    const expected = ['PASS', 'FAIL', 'UNABLE_TO_VERIFY'].sort();
    expect([...ALL_QUOTE_PARITY_STATES].sort()).toEqual(expected as never);
  });

  it('declares the StateCompleteness vocabulary', () => {
    const expected = ['COMPLETE', 'INCOMPLETE_BLOCKING'].sort();
    expect([...ALL_STATE_COMPLETENESSES].sort()).toEqual(expected as never);
  });

  it('declares the Appendix Q.2 SystemAddressRole vocabulary', () => {
    const expected = [
      'PROGRAM',
      'ROUTER',
      'POOL',
      'LAUNCHPAD',
      'BRIDGE',
      'EXCHANGE_SERVICE',
      'MARKET_MAKER',
      'FEE_COLLECTOR',
      'BURN_LOCK',
      'UNKNOWN_INFRASTRUCTURE',
    ].sort();
    expect([...ALL_SYSTEM_ADDRESS_ROLES].sort()).toEqual(expected as never);
  });

  it('declares the SystemAddressReviewState vocabulary', () => {
    const expected = ['REVIEWED', 'PENDING_REVIEW', 'REJECTED'].sort();
    expect([...ALL_SYSTEM_ADDRESS_REVIEW_STATES].sort()).toEqual(expected as never);
  });

  it('declares the ProviderVerdict vocabulary', () => {
    const expected = ['SAFE', 'RISK_DETECTED', 'UNABLE_TO_VERIFY'].sort();
    expect([...ALL_PROVIDER_VERDICTS].sort()).toEqual(expected as never);
  });

  it('declares the SecurityConflictClass vocabulary', () => {
    const expected = [
      'PROVIDER_OPTIMISM_OVERRIDDEN',
      'PROVIDER_RISK_NO_DETERMINISTIC_CORROBORATION',
      'UNABLE_TO_VERIFY',
    ].sort();
    expect([...ALL_SECURITY_CONFLICT_CLASSES].sort()).toEqual(expected as never);
  });

  it('parses valid token controls fail-closed', () => {
    if (typeof tokenControl === 'function') {
      expect(tokenControl('MINT')).toBe(TokenControl.MINT ?? 'MINT');
      expect(tokenControl('TRANSFER_HOOK')).toBe(TokenControl.TRANSFER_HOOK ?? 'TRANSFER_HOOK');
      expect(tokenControl('UNKNOWN_EXTENSION')).toBe(
        TokenControl.UNKNOWN_EXTENSION ?? 'UNKNOWN_EXTENSION',
      );
      expect(() => tokenControl('INVALID_CONTROL')).toThrow();
      expect(() => tokenControl('')).toThrow();
    } else {
      expect(typeof tokenControl).toBe('function');
    }
  });

  it('parses valid token control states fail-closed', () => {
    if (typeof tokenControlState === 'function') {
      expect(tokenControlState('KNOWN_RISK')).toBe(TokenControlState.KNOWN_RISK ?? 'KNOWN_RISK');
      expect(tokenControlState('REVOKED_AUTHORITY')).toBe(
        TokenControlState.REVOKED_AUTHORITY ?? 'REVOKED_AUTHORITY',
      );
      expect(() => tokenControlState('SAFE_CONTROL')).toThrow();
      expect(() => tokenControlState('')).toThrow();
    } else {
      expect(typeof tokenControlState).toBe('function');
    }
  });

  it('parses valid security severities fail-closed', () => {
    if (typeof securitySeverity === 'function') {
      expect(securitySeverity('CRITICAL')).toBe(SecuritySeverity.CRITICAL ?? 'CRITICAL');
      expect(securitySeverity('HIGH')).toBe(SecuritySeverity.HIGH ?? 'HIGH');
      expect(securitySeverity('NONE')).toBe(SecuritySeverity.NONE ?? 'NONE');
      expect(() => securitySeverity('INFORMATIONAL')).toThrow();
      expect(() => securitySeverity('')).toThrow();
    } else {
      expect(typeof securitySeverity).toBe('function');
    }
  });
});

describe('Solana Security pure predicates (FR-SOLSEC-004, FR-SOLSEC-006)', () => {
  it('evaluates profileRequiresCompleteExecutionModeling / blocksCompleteExecutionModeling gate substrate', () => {
    const predicate = profileRequiresCompleteExecutionModeling ?? blocksCompleteExecutionModeling;
    if (typeof predicate === 'function') {
      expect(predicate('UNKNOWN_REQUIRED')).toBe(true);
      expect(predicate({ supportState: 'UNKNOWN_REQUIRED' })).toBe(true);
      expect(predicate(['KNOWN_MODELED', 'UNKNOWN_REQUIRED'])).toBe(true);

      expect(predicate('KNOWN_MODELED')).toBe(false);
      expect(predicate('NOT_PRESENT')).toBe(false);
      expect(predicate(['KNOWN_MODELED', 'KNOWN_UNMODELED'])).toBe(false);
    } else {
      expect(typeof predicate).toBe('function');
    }
  });

  it('evaluates isExcludableSystemAddress against Appendix Q.2 minimum-confidence floor and accepted roles', () => {
    if (typeof isExcludableSystemAddress === 'function') {
      expect(isExcludableSystemAddress('ROUTER', 0.95, 'REVIEWED')).toBe(true);
      expect(isExcludableSystemAddress('POOL', 0.9, 'REVIEWED')).toBe(true);
      expect(isExcludableSystemAddress('PROGRAM', 0.85, 'REVIEWED')).toBe(true);
      expect(isExcludableSystemAddress('FEE_COLLECTOR', 0.8, 'REVIEWED')).toBe(true);

      expect(isExcludableSystemAddress('ROUTER', 0.79, 'REVIEWED')).toBe(false);
      expect(isExcludableSystemAddress('ROUTER', 0.4, 'REVIEWED')).toBe(false);

      expect(isExcludableSystemAddress('ROUTER', 0.95, 'PENDING_REVIEW')).toBe(false);
      expect(isExcludableSystemAddress('ROUTER', 0.95, 'REJECTED')).toBe(false);

      expect(isExcludableSystemAddress('UNKNOWN_INFRASTRUCTURE', 0.99, 'REVIEWED')).toBe(false);

      expect(() => isExcludableSystemAddress('ROUTER', -0.1, 'REVIEWED')).toThrow();
      expect(() => isExcludableSystemAddress('ROUTER', 1.5, 'REVIEWED')).toThrow();
      expect(() => isExcludableSystemAddress('INVALID_ROLE', 0.9, 'REVIEWED')).toThrow();
    } else {
      expect(typeof isExcludableSystemAddress).toBe('function');
    }
  });
});
