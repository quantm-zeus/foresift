// AC-277 (negative): outputs missing ANY publication duty refuse with
// REQUIRED_FIELD_MISSING and an EMPTY publishable body; bodies carrying
// prohibited claims refuse with SENSITIVE_DETAIL_PRESENT; redaction never
// leaks the raw values it replaced.
import { strict as assert } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { validatePublicOutput } from '../../packages/security/src/claims-policy.ts';

const COMPLETE_ENVELOPE = {
  evidenceRefs: ['evidence://run/ac277-neg'],
  timestamps: ['2026-08-24T00:00:00.000Z'],
  executionAssumptions: ['prices as of snapshot time'],
  limitations: ['detection heuristics are probabilistic'],
  disclaimer: 'Not financial advice.',
};

describe('AC-277 negatives: incomplete or unsafe output never ships', () => {
  it('each missing duty refuses with REQUIRED_FIELD_MISSING and empty body', () => {
    const incompleteCandidates = [
      { ...COMPLETE_ENVELOPE, evidenceRefs: [] },
      { ...COMPLETE_ENVELOPE, timestamps: [] },
      { ...COMPLETE_ENVELOPE, executionAssumptions: [] },
      { ...COMPLETE_ENVELOPE, limitations: [] },
      { ...COMPLETE_ENVELOPE, disclaimer: '' },
    ];
    for (const candidate of incompleteCandidates) {
      const { redaction, redactedBody } = validatePublicOutput({
        ...candidate,
        body: 'an ordinary whale-concentration observation',
      });
      expect(redaction.verdict).toBe('REFUSED');
      assert(redaction.verdict === 'REFUSED');
      expect(redaction.reason).toBe('REQUIRED_FIELD_MISSING');
      expect(redactedBody).toBe('');
    }
  });

  it('a body carrying prohibited claims refuses with SENSITIVE_DETAIL_PRESENT', () => {
    const { redaction, redactedBody } = validatePublicOutput({
      ...COMPLETE_ENVELOPE,
      body: 'Our alerts deliver guaranteed profit with 99% accurate signals.',
    });
    expect(redaction.verdict).toBe('REFUSED');
    assert(redaction.verdict === 'REFUSED');
    expect(redaction.reason).toBe('SENSITIVE_DETAIL_PRESENT');
    expect(redaction.detail).toMatch(/GUARANTEED_PROFIT|UNCALIBRATED_PROBABILITY/);
    expect(redactedBody).toBe('');
  });

  it('redaction replaces raw threshold/entity values rather than exposing them', () => {
    const entity = '9xFqZk3WhaleVaultAddress';
    const { redaction, redactedBody } = validatePublicOutput({
      ...COMPLETE_ENVELOPE,
      body: `threshold: 0.93 crossed by ${entity} during the window.`,
      sensitiveEntityValues: [entity],
    });
    expect(redaction.verdict).toBe('COMPLIANT');
    expect(redactedBody).not.toContain(entity);
    expect(redactedBody).not.toContain('0.93');
    expect(redactedBody).not.toContain('threshold: 0.93');
    expect(redactedBody).toContain('[REDACTED_THRESHOLD]');
    expect(redactedBody).toContain('[REDACTED_ENTITY]');
  });
});
