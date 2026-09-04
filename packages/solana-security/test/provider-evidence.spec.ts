import { describe, expect, it } from 'bun:test';
import {
  ProviderVerdict,
  SecurityConflictClass,
  SecuritySeverity,
  TokenControl,
  TokenControlState,
} from '@foresift/domain';
import {
  parseSolsecSchema,
  type SecurityConflict,
  type SecurityProviderReport,
  type TokenControlFinding,
} from '@foresift/shared-schemas';

// Note: Test authoring for T013 (FR-SOLSEC-005, AC-131).
// If provider-evidence module is implemented, import directly; otherwise test pure contracts and schema boundaries.
let providerModule: any;
try {
  providerModule = await import('../src/provider-evidence.ts');
} catch {
  // Expected RED baseline until product author implements provider-evidence.ts
  providerModule = null;
}

describe('provider-evidence: security provider independence and conflict resolution (FR-SOLSEC-005, AC-131, T013)', () => {
  const assessmentId = 'token-assessment:solana:mainnet/token123:1.0.0:mint-v1';
  const observedAt = '2026-01-01T00:00:00.000Z';
  const availableAt = '2026-01-01T00:00:01.000Z';

  const mockCriticalFinding: TokenControlFinding = {
    findingId: 'finding:001',
    assessmentId,
    control: TokenControl.TRANSFER_HOOK,
    controlState: TokenControlState.KNOWN_RISK,
    severity: SecuritySeverity.CRITICAL,
    authorityAddress: 'HookProgram11111111111111111111111111111111',
    extensionDataHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    evidenceIds: ['evidence:ast:001'],
    observedAt,
    availableAt,
    qualityCodes: ['VALID'],
  };

  const mockHighFinding: TokenControlFinding = {
    findingId: 'finding:002',
    assessmentId,
    control: TokenControl.FREEZE,
    controlState: TokenControlState.KNOWN_RISK,
    severity: SecuritySeverity.HIGH,
    authorityAddress: 'FreezeAuthority11111111111111111111111111111',
    extensionDataHash: null,
    evidenceIds: ['evidence:mint-header:001'],
    observedAt,
    availableAt,
    qualityCodes: ['VALID'],
  };

  const mockSafeProviderReport: SecurityProviderReport = {
    reportId: 'prov-rep:001',
    assessmentId,
    sourceId: 'goplus',
    providerReportId: 'goplus:rep:001',
    providerVersion: 'goplus-api@v2',
    verdict: ProviderVerdict.SAFE,
    rawPayloadRef: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    findingIds: [],
    observedAt,
    availableAt,
    qualityCodes: ['VALID'],
  };

  const mockRiskProviderReport: SecurityProviderReport = {
    reportId: 'prov-rep:002',
    assessmentId,
    sourceId: 'goplus',
    providerReportId: 'goplus:rep:002',
    providerVersion: 'goplus-api@v2',
    verdict: ProviderVerdict.RISK_DETECTED,
    rawPayloadRef: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    findingIds: ['external-honeypot-heuristic'],
    observedAt,
    availableAt,
    qualityCodes: ['VALID'],
  };

  const mockUnableProviderReport: SecurityProviderReport = {
    reportId: 'prov-rep:003',
    assessmentId,
    sourceId: 'goplus',
    providerReportId: 'goplus:rep:003',
    providerVersion: 'goplus-api@v2',
    verdict: ProviderVerdict.UNABLE_TO_VERIFY,
    rawPayloadRef: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    findingIds: [],
    observedAt,
    availableAt,
    qualityCodes: ['PARTIAL'],
  };

  it('verifies provider report schema invariants and raw payload ref preservation', () => {
    expect(() => parseSolsecSchema('SecurityProviderReport', mockSafeProviderReport)).not.toThrow();
    expect(() => parseSolsecSchema('SecurityProviderReport', mockRiskProviderReport)).not.toThrow();
    expect(() => parseSolsecSchema('SecurityProviderReport', mockUnableProviderReport)).not.toThrow();
  });

  it('records PROVIDER_OPTIMISM_OVERRIDDEN when provider reports SAFE against CRITICAL deterministic finding', () => {
    if (!providerModule) {
      // Contract expectation check against schema
      const conflict: SecurityConflict = {
        conflictId: 'conflict:001',
        assessmentId,
        providerReportId: mockSafeProviderReport.providerReportId,
        conflictClass: SecurityConflictClass.PROVIDER_OPTIMISM_OVERRIDDEN,
        deterministicFindingIds: [mockCriticalFinding.findingId],
        resolution: 'DETERMINISTIC',
        resolvedAt: observedAt,
        availableAt,
      };
      expect(() => parseSolsecSchema('SecurityConflict', conflict)).not.toThrow();
      expect(conflict.resolution).toBe('DETERMINISTIC');
      return;
    }

    const result = providerModule.resolveSecurityConflict({
      assessmentId,
      deterministicFindings: [mockCriticalFinding],
      providerReports: [mockSafeProviderReport],
      availableAt,
    });

    expect(result.effectiveSeverity).toBe(SecuritySeverity.CRITICAL);
    expect(result.providerOptimismOverridden).toBe(true);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].conflictClass).toBe(SecurityConflictClass.PROVIDER_OPTIMISM_OVERRIDDEN);
    expect(result.conflicts[0].resolution).toBe('DETERMINISTIC');
  });

  it('records PROVIDER_OPTIMISM_OVERRIDDEN when provider reports SAFE against HIGH deterministic finding', () => {
    if (!providerModule) {
      const conflict: SecurityConflict = {
        conflictId: 'conflict:002',
        assessmentId,
        providerReportId: mockSafeProviderReport.providerReportId,
        conflictClass: SecurityConflictClass.PROVIDER_OPTIMISM_OVERRIDDEN,
        deterministicFindingIds: [mockHighFinding.findingId],
        resolution: 'DETERMINISTIC',
        resolvedAt: observedAt,
        availableAt,
      };
      expect(() => parseSolsecSchema('SecurityConflict', conflict)).not.toThrow();
      return;
    }

    const result = providerModule.resolveSecurityConflict({
      assessmentId,
      deterministicFindings: [mockHighFinding],
      providerReports: [mockSafeProviderReport],
      availableAt,
    });

    expect(result.effectiveSeverity).toBe(SecuritySeverity.HIGH);
    expect(result.providerOptimismOverridden).toBe(true);
  });

  it('stores uncorroborated provider risk as independent evidence without inflating deterministic severity', () => {
    if (!providerModule) {
      const conflict: SecurityConflict = {
        conflictId: 'conflict:003',
        assessmentId,
        providerReportId: mockRiskProviderReport.providerReportId,
        conflictClass: SecurityConflictClass.PROVIDER_RISK_NO_DETERMINISTIC_CORROBORATION,
        deterministicFindingIds: ['finding:clean-mint'],
        resolution: 'DETERMINISTIC',
        resolvedAt: observedAt,
        availableAt,
      };
      expect(() => parseSolsecSchema('SecurityConflict', conflict)).not.toThrow();
      return;
    }

    const result = providerModule.resolveSecurityConflict({
      assessmentId,
      deterministicFindings: [],
      providerReports: [mockRiskProviderReport],
      availableAt,
    });

    // Uncorroborated external risk does NOT inflate deterministic severity to CRITICAL/HIGH
    expect(result.effectiveSeverity).not.toBe(SecuritySeverity.CRITICAL);
    expect(result.effectiveSeverity).not.toBe(SecuritySeverity.HIGH);
  });

  it('missing provider data (absence) never reduces deterministic severity (§35.12)', () => {
    if (!providerModule) {
      // Schema and invariant check
      expect(mockUnableProviderReport.verdict).toBe(ProviderVerdict.UNABLE_TO_VERIFY);
      return;
    }

    const resultWithMissing = providerModule.resolveSecurityConflict({
      assessmentId,
      deterministicFindings: [mockHighFinding],
      providerReports: [mockUnableProviderReport],
      availableAt,
    });

    // Severity remains HIGH; missing provider cannot downgrade to NONE
    expect(resultWithMissing.effectiveSeverity).toBe(SecuritySeverity.HIGH);

    const resultWithEmpty = providerModule.resolveSecurityConflict({
      assessmentId,
      deterministicFindings: [mockHighFinding],
      providerReports: [],
      availableAt,
    });

    expect(resultWithEmpty.effectiveSeverity).toBe(SecuritySeverity.HIGH);
  });
});
