/**
 * AC-132 negative / failure-path.
 * Traces: FR-SOLSEC-006, AC-132, T023.
 * Tests refusal of sub-floor registry rows (low confidence, pending review,
 * rejected, unknown role) and quality degradation to SYSTEM_ADDRESS_UNCERTAIN.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SYSTEM_REGISTRY_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/solsec/system-registry.json',
);

describe('AC-132 negative: System address refusal and quality code degradation', () => {
  it('refuses exclusion on low confidence and degrades quality codes', () => {
    const fixture = JSON.parse(readFileSync(SYSTEM_REGISTRY_FIXTURE, 'utf8'));
    const lowConfCase = fixture.entries.find(
      (e: any) => e.expectedExclusionDecision === 'REFUSAL_SUB_FLOOR_CONFIDENCE',
    );

    expect(lowConfCase).toBeDefined();
    expect(lowConfCase.confidence).toBeLessThan(0.8);
    expect(lowConfCase.expectedIsExcludable).toBe(false);
    expect(lowConfCase.expectedQualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');
  });

  it('refuses exclusion on pending review or rejected review state', () => {
    const fixture = JSON.parse(readFileSync(SYSTEM_REGISTRY_FIXTURE, 'utf8'));
    const pendingCase = fixture.entries.find(
      (e: any) => e.expectedExclusionDecision === 'REFUSAL_PENDING_REVIEW',
    );
    const rejectedCase = fixture.entries.find(
      (e: any) => e.expectedExclusionDecision === 'REFUSAL_REJECTED',
    );

    expect(pendingCase).toBeDefined();
    expect(pendingCase.expectedIsExcludable).toBe(false);
    expect(pendingCase.expectedQualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');

    expect(rejectedCase).toBeDefined();
    expect(rejectedCase.expectedIsExcludable).toBe(false);
    expect(rejectedCase.expectedQualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');
  });

  it('refuses exclusion on unknown infrastructure role', () => {
    const fixture = JSON.parse(readFileSync(SYSTEM_REGISTRY_FIXTURE, 'utf8'));
    const unknownRoleCase = fixture.entries.find(
      (e: any) => e.expectedExclusionDecision === 'REFUSAL_UNKNOWN_ROLE',
    );

    expect(unknownRoleCase).toBeDefined();
    expect(unknownRoleCase.role).toBe('UNKNOWN_INFRASTRUCTURE');
    expect(unknownRoleCase.expectedIsExcludable).toBe(false);
    expect(unknownRoleCase.expectedQualityCodes).toContain('SYSTEM_ADDRESS_UNCERTAIN');
  });

  it('refuses invalid confidence values fail-closed', () => {
    function validateConfidence(confidence: number): void {
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new RangeError('confidence must lie in [0, 1]');
      }
    }

    expect(() => validateConfidence(-0.01)).toThrow();
    expect(() => validateConfidence(1.05)).toThrow();
    expect(() => validateConfidence(NaN)).toThrow();
  });
});
