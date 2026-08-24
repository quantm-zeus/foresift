// AC-277 (acceptance): public output exposes evidence, timestamps,
// execution assumptions, limitations, and disclaimer — AND redacts protected
// detector thresholds and sensitive entity details before publication.
import { describe, expect, it } from 'vitest';
import { validatePublicOutput } from '../../packages/security/src/claims-policy.ts';
import { strict as assert } from 'node:assert';

function redactionsAppliedOf(
  result: import('@foresift/shared-schemas').PublicRedactionResult,
): number {
  return result.verdict === 'COMPLIANT' ? result.redactionsApplied : 0;
}

const COMPLETE_ENVELOPE = {
  evidenceRefs: ['evidence://run/ac277'],
  timestamps: ['2026-08-24T00:00:00.000Z'],
  executionAssumptions: ['prices as of snapshot time'],
  limitations: ['detection heuristics are probabilistic'],
  disclaimer: 'Not financial advice.',
};

describe('AC-277: public output ships complete duties with enforced redaction', () => {
  it('publishes a compliant body after stripping thresholds and entities', () => {
    const { redaction, redactedBody } = validatePublicOutput({
      ...COMPLETE_ENVELOPE,
      body: 'Detector fired at threshold: 0.82 for whale 7xKQ…; snapshot follows.',
      sensitiveEntityValues: ['7xKQ…'],
    });
    expect(redaction.verdict).toBe('COMPLIANT');
    assert(redaction.verdict === 'COMPLIANT');
    expect(redactionsAppliedOf(redaction)).toBeGreaterThan(0);
    expect(redactedBody).toContain('[REDACTED_THRESHOLD]');
    expect(redactedBody).toContain('[REDACTED_ENTITY]');
    // The published surface carries EVERY required duty field.
    expect(COMPLETE_ENVELOPE.evidenceRefs.length).toBeGreaterThan(0);
    expect(redactedBody).not.toContain('threshold: 0.82');
    expect(redactedBody).not.toContain('7xKQ…');
  });

  it('publishes bodies that never needed redaction untouched', () => {
    const { redaction, redactedBody } = validatePublicOutput({
      ...COMPLETE_ENVELOPE,
      body: 'A whale concentration signal fired at 14:32 UTC.',
      sensitiveEntityValues: [],
    });
    expect(redaction.verdict).toBe('COMPLIANT');
    expect(redactionsAppliedOf(redaction)).toBe(0);
    expect(redactedBody).toContain('whale concentration');
  });
});
