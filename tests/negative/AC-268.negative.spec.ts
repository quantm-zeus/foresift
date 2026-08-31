/**
 * AC-268 negative.
 * Traces: FR-TRACE-004.
 * Refusals proven: expired/revoked/out-of-scope/tampered/wrong-key evidence refuse AND
 * an unchecked boolean cannot be presented to the evaluator at all.
 */
import { describe, expect, it } from 'bun:test';
// @ts-expect-error TS2307: module not yet implemented by implementation author
import { evaluateGateEvidence } from '@foresift/release-conformance';
import {
  TEST_GATE_PEPPER,
  ALT_GATE_PEPPER,
  VALID_GATE_PAYLOADS,
  VALID_GATE_RECORDS,
  createSignedGateEvidence,
} from '../fixtures/trace/index.ts';

const FIXED_NOW = '2026-08-15T12:00:00.000Z';

describe('AC-268 negative (refusal of invalid evidence and boolean bypass)', () => {
  it('refuses expired evidence', () => {
    const expiredPayload = {
      ...VALID_GATE_PAYLOADS.MANUAL,
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-06-01T00:00:00.000Z',
    };
    const record = createSignedGateEvidence(expiredPayload, TEST_GATE_PEPPER);

    const verdict = evaluateGateEvidence({
      record,
      pepper: TEST_GATE_PEPPER,
      requiredScope: 'dependency-group:G0',
      currentTime: FIXED_NOW,
    });

    expect(verdict.isValid).toBe(false);
    expect(verdict.reason).toMatch(/EVIDENCE_EXPIRED|expired/i);
  });

  it('refuses revoked evidence', () => {
    const revokedRecord = createSignedGateEvidence(
      VALID_GATE_PAYLOADS.LEGAL,
      TEST_GATE_PEPPER,
      { revokedAt: '2026-08-01T00:00:00.000Z' },
    );

    const verdict = evaluateGateEvidence({
      record: revokedRecord,
      pepper: TEST_GATE_PEPPER,
      requiredScope: 'compliance:eu-ai-act',
      currentTime: FIXED_NOW,
    });

    expect(verdict.isValid).toBe(false);
    expect(verdict.reason).toMatch(/EVIDENCE_REVOKED|revoked/i);
  });

  it('refuses out-of-scope evidence', () => {
    const verdict = evaluateGateEvidence({
      record: VALID_GATE_RECORDS.OWNER_APPROVAL,
      pepper: TEST_GATE_PEPPER,
      requiredScope: 'unmatched:foreign-scope',
      currentTime: FIXED_NOW,
    });

    expect(verdict.isValid).toBe(false);
    expect(verdict.reason).toMatch(/SCOPE_MISMATCH|scope/i);
  });

  it('refuses tampered payload', () => {
    const tampered = {
      ...VALID_GATE_RECORDS.STATISTICAL,
      payload: {
        ...VALID_GATE_RECORDS.STATISTICAL.payload,
        subject: 'Altered subject breaking hash',
      },
    };

    const verdict = evaluateGateEvidence({
      record: tampered,
      pepper: TEST_GATE_PEPPER,
      requiredScope: 'eval:champion-challenger',
      currentTime: FIXED_NOW,
    });

    expect(verdict.isValid).toBe(false);
    expect(verdict.reason).toMatch(/HASH_MISMATCH|hash/i);
  });

  it('refuses invalid HMAC signature under wrong pepper', () => {
    const wrongSigRecord = createSignedGateEvidence(
      VALID_GATE_PAYLOADS.RIGHTS,
      ALT_GATE_PEPPER,
    );

    const verdict = evaluateGateEvidence({
      record: wrongSigRecord,
      pepper: TEST_GATE_PEPPER,
      requiredScope: 'provider:solana-rpc',
      currentTime: FIXED_NOW,
    });

    expect(verdict.isValid).toBe(false);
    expect(verdict.reason).toMatch(/SIGNATURE_INVALID|signature/i);
  });

  it('refuses raw boolean or primitive inputs (no unchecked boolean bypass)', () => {
    expect(() =>
      (evaluateGateEvidence as any)({
        record: true,
        pepper: TEST_GATE_PEPPER,
        requiredScope: 'dependency-group:G0',
      }),
    ).toThrow(/invalid evidence record|cannot evaluate boolean/i);
  });
});
