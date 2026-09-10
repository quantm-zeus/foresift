/**
 * AC-042 negative (failure) — comparing baseline against champion on disparate universes or cutoffs is refused.
 * Traces: FR-EVAL-002, FR-EVAL-004, AC-042.
 */
import { describe, expect, it } from 'bun:test';

function validateBaselineComparatorFairness(params: {
  championManifestHash: string;
  baselineManifestHash: string;
  championCutoff: string;
  baselineCutoff: string;
}) {
  if (params.championManifestHash !== params.baselineManifestHash) {
    throw new Error('MISMATCHED_UNIVERSE_MANIFEST_REFUSED');
  }
  if (params.championCutoff !== params.baselineCutoff) {
    throw new Error('MISMATCHED_TIME_CUTOFF_REFUSED');
  }
  return true;
}

describe('AC-042 negative: baseline comparisons on non-identical universes or time cutoffs are refused', () => {
  it('throws when champion and baseline evaluate different universe manifests', () => {
    expect(() =>
      validateBaselineComparatorFairness({
        championManifestHash: 'sha256:universe_A',
        baselineManifestHash: 'sha256:universe_B',
        championCutoff: '2026-08-31T23:59:59.999Z',
        baselineCutoff: '2026-08-31T23:59:59.999Z',
      }),
    ).toThrow('MISMATCHED_UNIVERSE_MANIFEST_REFUSED');
  });

  it('throws when champion and baseline have differing time cutoffs', () => {
    expect(() =>
      validateBaselineComparatorFairness({
        championManifestHash: 'sha256:universe_A',
        baselineManifestHash: 'sha256:universe_A',
        championCutoff: '2026-08-31T23:59:59.999Z',
        baselineCutoff: '2026-08-15T00:00:00.000Z',
      }),
    ).toThrow('MISMATCHED_TIME_CUTOFF_REFUSED');
  });
});
