import { describe, expect, it } from 'vitest';
import {
  ALL_ACQUISITION_STATES,
  ALL_QUALITY_CODES,
  AcquisitionState,
  ErrorCode,
  ForesiftError,
  QualityCode,
  acquisitionState,
  acquisitionIsNotRequestedByPolicy as acqIsNotRequestedByPolicy,
  qualityIsNotRequestedByPolicy,
  isRetrievalFailure,
  isTerminalAcquisition,
  nullRequiresExplicitCode,
  qualityCode,
} from '../src/index.ts';

describe('§13.9 quality-code vocabulary (FR-DATA-005)', () => {
  it('declares the complete 31-code vocabulary with stable spellings', () => {
    // The §13.9 list is product law: additions are allowed, renames/removals are not.
    const required = [
      'VALID',
      'MISSING_PROVIDER',
      'NOT_REQUESTED_BY_POLICY',
      'UNSUPPORTED_CHAIN',
      'UNSUPPORTED_PROGRAM_VERSION',
      'STALE',
      'PARTIAL',
      'ESTIMATED',
      'CONFLICTING',
      'REORG_PENDING',
      'GAP_AFFECTED',
      'LOW_SAMPLE',
      'DECIMAL_UNCERTAIN',
      'LICENSE_RESTRICTED',
      'SCHEMA_DEGRADED',
      'DEPRECATED_OPERATION',
      'COST_BLOCKED',
      'QUOTA_RESERVE_PROTECTED',
      'CAPACITY_BLOCKED',
      'EXECUTION_UNAVAILABLE',
      'EXECUTION_PARTIAL',
      'POOL_MATH_UNSUPPORTED',
      'QUOTE_PARITY_FAILED',
      'TOKEN_EXTENSION_UNKNOWN',
      'SUPPLY_UNCERTAIN',
      'SYSTEM_ADDRESS_UNCERTAIN',
      'SOCIAL_UNAVAILABLE',
      'SOURCE_DEPENDENCE_HIGH',
      'OUTCOME_PENDING',
      'OUTCOME_CENSORED',
      'RETROSPECTIVE_ONLY',
    ];
    for (const code of required) expect(ALL_QUALITY_CODES).toContain(code);
    expect(ALL_QUALITY_CODES.length).toBe(required.length);
  });

  it('refuses unknown codes fail-closed', () => {
    try {
      qualityCode('SORT_OF_OK');
      expect.unreachable();
    } catch (e) {
      expect((e as ForesiftError).code).toBe(ErrorCode.QUALITY_CODE_UNKNOWN);
    }
  });

  it('enforces "null alone is insufficient"', () => {
    expect(nullRequiresExplicitCode([QualityCode.MISSING_PROVIDER])).toBe(true);
    expect(nullRequiresExplicitCode([QualityCode.NOT_REQUESTED_BY_POLICY])).toBe(true);
    expect(nullRequiresExplicitCode([QualityCode.VALID])).toBe(false);
    expect(nullRequiresExplicitCode([])).toBe(false);
    expect(qualityIsNotRequestedByPolicy(qualityCode('NOT_REQUESTED_BY_POLICY'))).toBe(true);
    expect(qualityIsNotRequestedByPolicy(qualityCode('MISSING_PROVIDER'))).toBe(false);
  });
});

describe('§13.8 acquisition-state vocabulary (AC-242 substrate)', () => {
  it('declares the exact ten-state vocabulary', () => {
    expect([...ALL_ACQUISITION_STATES].sort()).toEqual(
      [
        'NOT_REQUESTED_BY_POLICY',
        'REQUESTED',
        'COST_BLOCKED',
        'QUOTA_BLOCKED',
        'CAPABILITY_UNAVAILABLE',
        'RIGHTS_BLOCKED',
        'PROVIDER_UNAVAILABLE',
        'TIMED_OUT',
        'RETURNED',
        'INVALID_RESPONSE',
      ].sort(),
    );
  });

  it('keeps NOT_REQUESTED_BY_POLICY semantically distinct from provider missingness', () => {
    expect(acqIsNotRequestedByPolicy(AcquisitionState.NOT_REQUESTED_BY_POLICY)).toBe(true);
    expect(acqIsNotRequestedByPolicy(AcquisitionState.PROVIDER_UNAVAILABLE)).toBe(false);
    expect(acqIsNotRequestedByPolicy(AcquisitionState.RETURNED)).toBe(false);
  });

  it('classifies retrieval failures and terminal states', () => {
    expect(isRetrievalFailure(AcquisitionState.TIMED_OUT)).toBe(true);
    expect(isRetrievalFailure(AcquisitionState.RIGHTS_BLOCKED)).toBe(true);
    expect(isRetrievalFailure(AcquisitionState.REQUESTED)).toBe(false);
    expect(isTerminalAcquisition(AcquisitionState.RETURNED)).toBe(true);
    expect(isTerminalAcquisition(AcquisitionState.COST_BLOCKED)).toBe(true);
    expect(isTerminalAcquisition(AcquisitionState.REQUESTED)).toBe(false);
  });

  it('refuses unknown states fail-closed', () => {
    try {
      acquisitionState('RETURNED_EMPTY');
      expect.unreachable();
    } catch (e) {
      expect((e as ForesiftError).code).toBe(ErrorCode.ACQUISITION_STATE_UNKNOWN);
    }
  });
});
