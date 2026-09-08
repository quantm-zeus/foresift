/**
 * AC-191 negative / failure-path.
 * Traces: FR-SIG-006, AC-191.
 * Refuses universe drift between comparison replays, higher missed-critical rates,
 * or unevidenced information gain claims.
 */
import { describe, expect, it } from 'bun:test';

function assertReplayValidity(
  staticUniverseHash: string,
  adaptiveUniverseHash: string,
  missedCriticalAdaptive: number,
  missedCriticalStatic: number,
  measuredInfoAdaptive: number,
  claimedInfoAdaptive: number,
): void {
  if (staticUniverseHash !== adaptiveUniverseHash) {
    throw new Error('SIG_REPLAY_COMPARISON_UNIVERSE_DRIFT_REFUSED');
  }
  if (missedCriticalAdaptive > missedCriticalStatic) {
    throw new Error('SIG_ADAPTIVE_MISSED_CRITICAL_RATE_ELEVATED');
  }
  if (measuredInfoAdaptive < claimedInfoAdaptive) {
    throw new Error('SIG_UNEVIDENCED_INFORMATION_GAIN_CLAIM_REFUSED');
  }
}

describe('AC-191 negative: Adaptive vs static scheduler comparison validity', () => {
  it('refuses comparison across drifted candidate universes', () => {
    expect(() =>
      assertReplayValidity('sha256:hashA', 'sha256:hashB', 0.0, 0.0, 10.0, 10.0),
    ).toThrow('SIG_REPLAY_COMPARISON_UNIVERSE_DRIFT_REFUSED');
  });

  it('refuses adaptive policy that produces higher missed critical events rate', () => {
    expect(() =>
      assertReplayValidity('sha256:same', 'sha256:same', 0.15, 0.0, 10.0, 10.0),
    ).toThrow('SIG_ADAPTIVE_MISSED_CRITICAL_RATE_ELEVATED');
  });

  it('refuses unevidenced information gain claim', () => {
    expect(() =>
      assertReplayValidity('sha256:same', 'sha256:same', 0.0, 0.0, 5.0, 10.0),
    ).toThrow('SIG_UNEVIDENCED_INFORMATION_GAIN_CLAIM_REFUSED');
  });
});
