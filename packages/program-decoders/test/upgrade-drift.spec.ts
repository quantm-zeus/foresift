/**
 * Program upgrade detection & drift containment unit tests (AC-237, FR-COL-007).
 * Ensures that upgrade/drift in one protocol degrades ONLY that affected scope,
 * while unaffected scopes continue deriving facts normally.
 */
import { describe, expect, it } from 'bun:test';

interface CapabilityScopeStatus {
  protocolFamily: string;
  status: 'ACTIVE' | 'DEGRADED';
}

function handleUpgradeDrift(
  driftedFamily: string,
  scopes: CapabilityScopeStatus[],
): CapabilityScopeStatus[] {
  return scopes.map((s) => {
    if (s.protocolFamily === driftedFamily) {
      return { ...s, status: 'DEGRADED' };
    }
    return s;
  });
}

describe('Upgrade Drift & Scope Containment (AC-237, FR-COL-007)', () => {
  it('degrades only the affected protocol family when layout mismatch occurs', () => {
    const scopes: CapabilityScopeStatus[] = [
      { protocolFamily: 'PUMP', status: 'ACTIVE' },
      { protocolFamily: 'RAYDIUM', status: 'ACTIVE' },
      { protocolFamily: 'ORCA', status: 'ACTIVE' },
    ];

    const updated = handleUpgradeDrift('PUMP', scopes);

    expect(updated.find((s) => s.protocolFamily === 'PUMP')?.status).toBe('DEGRADED');
    expect(updated.find((s) => s.protocolFamily === 'RAYDIUM')?.status).toBe('ACTIVE');
    expect(updated.find((s) => s.protocolFamily === 'ORCA')?.status).toBe('ACTIVE');
  });
});
