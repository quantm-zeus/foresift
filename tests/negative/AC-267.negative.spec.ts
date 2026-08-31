/**
 * AC-267 negative.
 * Traces: FR-TRACE-005.
 * Refusals proven: each missing dimension (and a wrong-format hash) refuses with the
 * dimension named; no dimension is ever defaulted.
 */
import { describe, expect, it } from 'bun:test';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { assembleDecisionTrace } from '@foresift/release-conformance';
import {
  VALID_DECISION_TRACE_INPUT,
  MISSING_DIMENSION_FIXTURES,
} from '../fixtures/trace/index.ts';

describe('AC-267 negative (fail-closed refusal on incomplete decision traces)', () => {
  for (const [missingDim, fixture] of Object.entries(MISSING_DIMENSION_FIXTURES)) {
    it(`refuses trace missing '${missingDim}', naming the missing dimension`, () => {
      expect(() => assembleDecisionTrace(fixture as any)).toThrow(
        new RegExp(missingDim, 'i'),
      );
    });
  }

  it('refuses invalid manifestSha256 hash format', () => {
    const badHashInput = {
      ...VALID_DECISION_TRACE_INPUT,
      manifestSha256: 'not-a-valid-sha256-hex-digest',
    };

    expect(() => assembleDecisionTrace(badHashInput)).toThrow(
      /manifestSha256|invalid hash/i,
    );
  });
});
