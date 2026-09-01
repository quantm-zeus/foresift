/**
 * AC-268 acceptance (positive).
 * Traces: FR-TRACE-004.
 * AC text (manifest §39.25): "Manual, legal, rights, statistical, and owner-approval gates
 * require signed or hashed evidence with scope, approver, expiry, and revocation; an
 * unchecked database boolean cannot satisfy a release gate."
 */
import { describe, expect, it } from 'bun:test';
import { evaluateGateEvidence } from '@foresift/release-conformance';
import {
  TEST_GATE_PEPPER,
  VALID_GATE_PAYLOADS,
  createSignedGateEvidence,
} from '../fixtures/trace/index.ts';

const FIXED_NOW = '2026-08-15T12:00:00.000Z';

describe('AC-268 acceptance (positive)', () => {
  it('accepts valid, signed, unexpired evidence across all five gate kinds', () => {
    for (const [kind, payload] of Object.entries(VALID_GATE_PAYLOADS)) {
      const record = createSignedGateEvidence(payload, TEST_GATE_PEPPER);

      const verdict = evaluateGateEvidence({
        record,
        pepper: TEST_GATE_PEPPER,
        requiredScope: payload.scopeRefs[0],
        currentTime: FIXED_NOW,
      });

      expect(verdict.isValid).toBe(true);
      expect(verdict.gateKind).toBe(kind);
      expect(verdict.approver).toBe(payload.approver);
    }
  });
});
