import { describe, expect, it } from 'bun:test';
import * as DomainModule from '../src/index.ts';

const Domain = DomainModule;
const AcquisitionState = Domain.AcquisitionState;
const ALL_ACQUISITION_STATES = Domain.ALL_ACQUISITION_STATES ?? [];
const AcquisitionFailureKind = Domain.AcquisitionFailureKind;
const acquisitionFailureKind = Domain.acquisitionFailureKind;
const acquisitionState = Domain.acquisitionState;
const isRetrievalFailure = Domain.isRetrievalFailure;
const isTerminalAcquisition = Domain.isTerminalAcquisition;
const mapLegacyAcquisitionState = Domain.mapLegacyAcquisitionState;

describe('Reconciled ten-state acquisition vocabulary (FR-DATA-011, FR-DATA-012, AC-242, AC-243)', () => {
  it('declares the exact reconciled ten-state vocabulary', () => {
    const expected = [
      'NOT_REQUESTED_BY_POLICY',
      'REQUESTED',
      'COST_BLOCKED',
      'QUOTA_BLOCKED',
      'RIGHTS_BLOCKED',
      'UNSUPPORTED',
      'PROVIDER_UNAVAILABLE',
      'FAILED',
      'RETURNED_EMPTY',
      'RETURNED',
    ].sort();

    expect([...ALL_ACQUISITION_STATES].sort()).toEqual(expected as never);
  });

  it('parses valid acquisition states fail-closed', () => {
    expect(acquisitionState('UNSUPPORTED')).toBe(AcquisitionState.UNSUPPORTED);
    expect(acquisitionState('FAILED')).toBe(AcquisitionState.FAILED);
    expect(acquisitionState('RETURNED_EMPTY')).toBe(AcquisitionState.RETURNED_EMPTY);
  });

  it('refuses retired or unknown acquisition states fail-closed', () => {
    expect(() => acquisitionState('CAPABILITY_UNAVAILABLE')).toThrow();
    expect(() => acquisitionState('TIMED_OUT')).toThrow();
    expect(() => acquisitionState('INVALID_RESPONSE')).toThrow();
    expect(() => acquisitionState('SOME_UNKNOWN_STATE')).toThrow();
  });

  it('parses AcquisitionFailureKind fail-closed', () => {
    expect(acquisitionFailureKind('TIMED_OUT')).toBe(AcquisitionFailureKind.TIMED_OUT);
    expect(acquisitionFailureKind('INVALID_RESPONSE')).toBe(
      AcquisitionFailureKind.INVALID_RESPONSE,
    );
    expect(() => acquisitionFailureKind('NETWORK_DISCONNECT')).toThrow();
  });

  it('correctly identifies terminal acquisition states', () => {
    expect(isTerminalAcquisition(AcquisitionState.REQUESTED)).toBe(false);
    expect(isTerminalAcquisition(AcquisitionState.NOT_REQUESTED_BY_POLICY)).toBe(true);
    expect(isTerminalAcquisition(AcquisitionState.COST_BLOCKED)).toBe(true);
    expect(isTerminalAcquisition(AcquisitionState.UNSUPPORTED)).toBe(true);
    expect(isTerminalAcquisition(AcquisitionState.FAILED)).toBe(true);
    expect(isTerminalAcquisition(AcquisitionState.RETURNED_EMPTY)).toBe(true);
    expect(isTerminalAcquisition(AcquisitionState.RETURNED)).toBe(true);
  });

  it('correctly identifies retrieval failures', () => {
    expect(isRetrievalFailure(AcquisitionState.FAILED)).toBe(true);
    expect(isRetrievalFailure(AcquisitionState.PROVIDER_UNAVAILABLE)).toBe(true);
    expect(isRetrievalFailure(AcquisitionState.UNSUPPORTED)).toBe(true);
    expect(isRetrievalFailure(AcquisitionState.RETURNED_EMPTY)).toBe(false);
    expect(isRetrievalFailure(AcquisitionState.RETURNED)).toBe(false);
    expect(isRetrievalFailure(AcquisitionState.NOT_REQUESTED_BY_POLICY)).toBe(false);
  });

  it('maps legacy pre-G1 states via mapLegacyAcquisitionState per plan ADR-1', () => {
    expect(mapLegacyAcquisitionState('CAPABILITY_UNAVAILABLE')).toBe(AcquisitionState.UNSUPPORTED);
    expect(mapLegacyAcquisitionState('TIMED_OUT')).toBe(AcquisitionState.FAILED);
    expect(mapLegacyAcquisitionState('INVALID_RESPONSE')).toBe(AcquisitionState.FAILED);
    expect(mapLegacyAcquisitionState('RETURNED')).toBe(AcquisitionState.RETURNED);
  });
});
