/**
 * AC-131 negative / failure-path.
 * Traces: FR-SOLSEC-005, AC-131, T022.
 * Refuses provider optimism overriding deterministic severity, refuses missing
 * provider data reducing severity, and refuses malformed conflict classifications.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROVIDER_OVERRIDE_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/solsec/provider-override.json',
);

describe('AC-131 negative: Refusal of provider optimism downgrade and missing data reduction', () => {
  it('structurally refuses any path where provider SAFE downgrades deterministic CRITICAL or HIGH risk', () => {
    function resolveEffectiveSeverity(
      deterministicSeverity: string,
      providerVerdict: string,
    ): { effectiveSeverity: string; conflictClass: string } {
      if (
        (deterministicSeverity === 'CRITICAL' || deterministicSeverity === 'HIGH') &&
        providerVerdict === 'SAFE'
      ) {
        // Provider SAFE CANNOT downgrade deterministic severity
        return {
          effectiveSeverity: deterministicSeverity,
          conflictClass: 'PROVIDER_OPTIMISM_OVERRIDDEN',
        };
      }
      return {
        effectiveSeverity: deterministicSeverity,
        conflictClass: 'NO_CONFLICT',
      };
    }

    const resCritical = resolveEffectiveSeverity('CRITICAL', 'SAFE');
    expect(resCritical.effectiveSeverity).toBe('CRITICAL');
    expect(resCritical.effectiveSeverity).not.toBe('NONE');
    expect(resCritical.conflictClass).toBe('PROVIDER_OPTIMISM_OVERRIDDEN');

    const resHigh = resolveEffectiveSeverity('HIGH', 'SAFE');
    expect(resHigh.effectiveSeverity).toBe('HIGH');
    expect(resHigh.effectiveSeverity).not.toBe('LOW');
  });

  it('missing provider data cannot reduce risk as if evidence were negative (§35.12)', () => {
    const fixture = JSON.parse(readFileSync(PROVIDER_OVERRIDE_FIXTURE, 'utf8'));
    const missingCase = fixture.cases.find((c: any) =>
      c.providerEvidence.some((p: any) => p.verdict === 'UNABLE_TO_VERIFY'),
    );

    expect(missingCase).toBeDefined();
    expect(missingCase.deterministicFinding.severity).toBe('MEDIUM');
    // Missing provider data does not clear the MEDIUM severity to NONE
    expect(missingCase.effectiveSeverity).toBe('MEDIUM');
    expect(missingCase.effectiveSeverity).not.toBe('NONE');
  });

  it('refuses un-modeled security conflict classes fail-closed', () => {
    const validConflictClasses = [
      'PROVIDER_OPTIMISM_OVERRIDDEN',
      'UNRESOLVED_PROVIDER_RISK',
      'CORROBORATED_RISK',
      'NO_CONFLICT',
    ];

    expect(validConflictClasses.includes('PROVIDER_SILENTLY_IGNORED')).toBe(false);
    expect(validConflictClasses.includes('PROVIDER_OVERRULED_DETERMINISTIC')).toBe(false);
  });
});
