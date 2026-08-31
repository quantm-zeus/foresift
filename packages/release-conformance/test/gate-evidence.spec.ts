/**
 * Unit suite for gate evidence creation, cryptographic verification, and evaluation (FR-TRACE-004 / AC-268).
 */
import { describe, expect, it } from 'bun:test';
import {
  createGateEvidence,
  evaluateGateEvidence,
  verifyEvidenceSignature,
  verifyPayloadHash,
} from '../src/index.ts';
import {
  TEST_GATE_PEPPER,
  ALT_GATE_PEPPER,
  VALID_GATE_PAYLOADS,
  VALID_GATE_RECORDS,
  createSignedGateEvidence,
} from '../../../tests/fixtures/trace/index.ts';

const FIXED_NOW = '2026-08-15T12:00:00.000Z';

describe('gate evidence evaluation and cryptographic verification (FR-TRACE-004, AC-268)', () => {
  describe('positive: valid evidence evaluation across all 5 gate kinds', () => {
    for (const [kind, payload] of Object.entries(VALID_GATE_PAYLOADS)) {
      it(`successfully evaluates valid ${kind} gate evidence within scope`, () => {
        const record = createSignedGateEvidence(payload, TEST_GATE_PEPPER);
        const result = evaluateGateEvidence({
          record,
          pepper: TEST_GATE_PEPPER,
          requiredScope: payload.scopeRefs[0],
          currentTime: FIXED_NOW,
        });

        expect(result.isValid).toBe(true);
        expect(result.gateKind).toBe(kind);
        expect(result.approver).toBe(payload.approver);
      });
    }

    it('verifies SHA256 payload hash integrity', () => {
      const record = VALID_GATE_RECORDS.MANUAL;
      expect(verifyPayloadHash(record)).toBe(true);
    });

    it('verifies HMAC-SHA256 signature with matching pepper', () => {
      const record = VALID_GATE_RECORDS.MANUAL;
      expect(verifyEvidenceSignature(record, TEST_GATE_PEPPER)).toBe(true);
    });
  });

  describe('negative: refusals with typed failure reasons', () => {
    it('refuses expired evidence (EVIDENCE_EXPIRED)', () => {
      const expiredPayload = {
        ...VALID_GATE_PAYLOADS.MANUAL,
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-06-01T00:00:00.000Z',
      };
      const record = createSignedGateEvidence(expiredPayload, TEST_GATE_PEPPER);

      const result = evaluateGateEvidence({
        record,
        pepper: TEST_GATE_PEPPER,
        requiredScope: 'dependency-group:G0',
        currentTime: '2026-08-15T00:00:00.000Z', // After expiry
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/EVIDENCE_EXPIRED|expired/i);
    });

    it('refuses revoked evidence (EVIDENCE_REVOKED)', () => {
      const revokedPayload = {
        ...VALID_GATE_PAYLOADS.LEGAL,
        revocationRef: 'incident:revoked-due-to-policy-change',
      };
      const record = createSignedGateEvidence(revokedPayload, TEST_GATE_PEPPER, {
        revokedAt: '2026-08-05T00:00:00.000Z',
      });

      const result = evaluateGateEvidence({
        record,
        pepper: TEST_GATE_PEPPER,
        requiredScope: 'compliance:eu-ai-act',
        currentTime: FIXED_NOW,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/EVIDENCE_REVOKED|revoked/i);
    });

    it('refuses tampered payload (HASH_MISMATCH)', () => {
      const record = {
        ...VALID_GATE_RECORDS.STATISTICAL,
        payload: {
          ...VALID_GATE_RECORDS.STATISTICAL.payload,
          subject: 'Tampered subject altering canonical payload',
        },
      };

      const result = evaluateGateEvidence({
        record,
        pepper: TEST_GATE_PEPPER,
        requiredScope: 'eval:champion-challenger',
        currentTime: FIXED_NOW,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/HASH_MISMATCH|payload altered|hash mismatch/i);
    });

    it('refuses signature signed under different pepper (SIGNATURE_INVALID)', () => {
      const wrongKeyRecord = createSignedGateEvidence(
        VALID_GATE_PAYLOADS.RIGHTS,
        ALT_GATE_PEPPER,
      );

      const result = evaluateGateEvidence({
        record: wrongKeyRecord,
        pepper: TEST_GATE_PEPPER, // Validating with main pepper
        requiredScope: 'provider:solana-rpc',
        currentTime: FIXED_NOW,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/SIGNATURE_INVALID|signature mismatch/i);
    });

    it('refuses evidence that does not cover the required scope (SCOPE_MISMATCH)', () => {
      const record = VALID_GATE_RECORDS.OWNER_APPROVAL;

      const result = evaluateGateEvidence({
        record,
        pepper: TEST_GATE_PEPPER,
        requiredScope: 'unrelated:foreign-scope-ref',
        currentTime: FIXED_NOW,
      });

      expect(result.isValid).toBe(false);
      expect(result.reason).toMatch(/SCOPE_MISMATCH|scope not covered/i);
    });

    it('structurally prevents boolean inputs from satisfying the gate evaluator', () => {
      // The evaluateGateEvidence contract requires a structured GateEvidenceRecord
      // Passing raw booleans or primitive types is rejected at runtime
      expect(() =>
        (evaluateGateEvidence as any)({
          record: true,
          pepper: TEST_GATE_PEPPER,
          requiredScope: 'dependency-group:G0',
        }),
      ).toThrow(/invalid evidence record|cannot evaluate boolean/i);

      expect(() =>
        (evaluateGateEvidence as any)({
          record: { approved: true },
          pepper: TEST_GATE_PEPPER,
          requiredScope: 'dependency-group:G0',
        }),
      ).toThrow(/invalid evidence record|missing required fields/i);
    });
  });
});
