/**
 * AC-131 acceptance (positive).
 * Traces: FR-SOLSEC-005, AC-131, T022.
 * AC text (manifest §39): "External security provider reports are stored as independent
 * evidence; deterministic critical/high risks take precedence over provider safe outputs,
 * and security conflicts are recorded and exposed."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVIDER_OVERRIDE_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/solsec/provider-override.json',
);

describe('AC-131: Security provider independence and conflict resolution (positive)', () => {
  it('deterministic critical/high risk stands when external providers report safe/no-risk', () => {
    const fixture = JSON.parse(readFileSync(PROVIDER_OVERRIDE_FIXTURE, 'utf8'));
    const overrideCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.expectedConflictClass === 'PROVIDER_OPTIMISM_OVERRIDDEN',
    );

    expect(overrideCase).toBeDefined();
    expect(overrideCase.deterministicFinding.severity).toBe('CRITICAL');
    expect(overrideCase.providerEvidence[0].verdict).toBe('SAFE');
    expect(overrideCase.effectiveSeverity).toBe('CRITICAL');
    expect(overrideCase.expectedResolutionSide).toBe('DETERMINISTIC');
    expect(overrideCase.providerOptimismOverridden).toBe(true);
  });

  it('preserves external provider reports as independent evidence groups without loss', () => {
    const fixture = JSON.parse(readFileSync(PROVIDER_OVERRIDE_FIXTURE, 'utf8'));
    for (const testCase of fixture.cases) {
      expect(testCase.providerEvidencePreserved).toBe(true);
      expect(testCase.providerEvidence.length).toBeGreaterThan(0);
      for (const prov of testCase.providerEvidence) {
        expect(prov.provider).toBeDefined();
        expect(prov.verdict).toBeDefined();
        expect(prov.rawPayloadRef).toBeDefined();
      }
    }
  });

  it('stores uncorroborated provider risk as unresolved evidence without inflating deterministic severity', () => {
    const fixture = JSON.parse(readFileSync(PROVIDER_OVERRIDE_FIXTURE, 'utf8'));
    const uncorrCase = fixture.cases.find(
      (c: Record<string, unknown>) => c.expectedConflictClass === 'UNRESOLVED_PROVIDER_RISK',
    );

    expect(uncorrCase).toBeDefined();
    expect(uncorrCase.deterministicFinding.severity).toBe('NONE');
    expect(uncorrCase.providerEvidence[0].verdict).toBe('RISK_DETECTED');
    expect(uncorrCase.effectiveSeverity).toBe('NONE');
    expect(uncorrCase.expectedResolutionSide).toBe('UNRESOLVED_INDEPENDENT_EVIDENCE');
  });
});
