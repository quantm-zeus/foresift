import { describe, expect, it } from 'bun:test';
import {
  ALL_REPLAY_MODES,
  ReplayMode,
  isRetrospectiveDataAllowed,
  parseReplayMode,
  replayMode,
  shouldExcludeObservationAtBoundary,
} from '../src/index.ts';

describe('G1 replay-modes vocabulary and visibility contracts (FR-DATA-008, FR-DATA-015, AC-241, AC-247)', () => {
  it('declares the exact four replay modes', () => {
    const expected = [
      'REALIZABLE_REPLAY',
      'ORACLE',
      'HINDSIGHT',
      'COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH',
    ].sort();
    expect([...ALL_REPLAY_MODES].sort()).toEqual(expected as ReplayMode[]);
  });

  it('parses valid replay modes fail-closed', () => {
    expect(replayMode('REALIZABLE_REPLAY')).toBe(ReplayMode.REALIZABLE_REPLAY);
    expect(replayMode('ORACLE')).toBe(ReplayMode.ORACLE);
    expect(replayMode('HINDSIGHT')).toBe(ReplayMode.HINDSIGHT);
    expect(replayMode('COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH')).toBe(
      ReplayMode.COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH,
    );
  });

  it('refuses unknown replay modes fail-closed', () => {
    expect(() => replayMode('TIME_TRAVEL_UNCONSTRAINED')).toThrow();
    expect(() => replayMode('')).toThrow();
    expect(() => replayMode(undefined as unknown as string)).toThrow();
  });

  it('distinguishes retrospective data permission by mode', () => {
    expect(isRetrospectiveDataAllowed(ReplayMode.REALIZABLE_REPLAY)).toBe(false);
    expect(isRetrospectiveDataAllowed(ReplayMode.ORACLE)).toBe(true);
    expect(isRetrospectiveDataAllowed(ReplayMode.HINDSIGHT)).toBe(true);
    expect(
      isRetrospectiveDataAllowed(ReplayMode.COUNTERFACTUAL_DATA_AVAILABILITY_RESEARCH),
    ).toBe(true);
  });

  it('excludes retrospective-only data whose available_at exceeds boundary in realizable mode', () => {
    const boundary = '2026-05-01T12:00:00Z';
    // Backfill fetched later (available 14:00, event 10:00)
    const obs = {
      eventAt: '2026-05-01T10:00:00Z',
      availableAt: '2026-05-01T14:00:00Z',
      retrievedAsBackfill: true,
    };

    expect(
      shouldExcludeObservationAtBoundary({
        observation: obs,
        boundaryTime: boundary,
        mode: ReplayMode.REALIZABLE_REPLAY,
      }),
    ).toBe(true);

    expect(
      shouldExcludeObservationAtBoundary({
        observation: obs,
        boundaryTime: boundary,
        mode: ReplayMode.HINDSIGHT,
      }),
    ).toBe(false);
  });
});
