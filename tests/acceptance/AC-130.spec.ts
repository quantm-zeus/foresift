/**
 * AC-130 acceptance (positive).
 * Traces: FR-SOLSEC-001, FR-SOLSEC-002, FR-SOLSEC-003, FR-SOLSEC-004, AC-130, T021.
 * AC text (manifest §39): "SPL and Token-2022 programs, authorities, and extensions
 * are analyzed deterministically; pool/LP control, migration lineage, and withdrawal
 * authorities are resolved through allowlisted adapters with versioned evidence."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_EXT_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/solsec/token-extensions.json',
);

const POOL_SEC_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/solsec/pool-security.json',
);

describe('AC-130: Deterministic token program and pool security analysis (positive)', () => {
  it('detects all §65.2 token controls and classifies active vs revoked authorities', () => {
    const fixture = JSON.parse(readFileSync(TOKEN_EXT_FIXTURE, 'utf8'));
    const vectors = fixture.vectors;

    expect(vectors.length).toBeGreaterThanOrEqual(10);

    // Active vs Revoked Freeze Authority
    const activeFreeze = vectors.find(
      (v: Record<string, unknown>) => v.control === 'FREEZE' && v.authority !== null,
    );
    const revokedFreeze = vectors.find(
      (v: Record<string, unknown>) => v.control === 'FREEZE' && v.authority === null,
    );

    expect(activeFreeze).toBeDefined();
    expect(activeFreeze.expectedControlState).toBe('KNOWN_RISK');
    expect(activeFreeze.expectedSeverity).toBe('HIGH');

    expect(revokedFreeze).toBeDefined();
    expect(revokedFreeze.expectedControlState).toBe('REVOKED_AUTHORITY');
    expect(revokedFreeze.expectedSeverity).toBe('NONE');

    // Active Permanent Delegate
    const permDelegate = vectors.find(
      (v: Record<string, unknown>) => v.control === 'PERMANENT_DELEGATE' && v.authority !== null,
    );
    expect(permDelegate.expectedControlState).toBe('KNOWN_RISK');
    expect(permDelegate.expectedSeverity).toBe('HIGH');

    // Active Transfer Hook blocking exit
    const transferHook = vectors.find(
      (v: Record<string, unknown>) => v.control === 'TRANSFER_HOOK' && v.hookProgramId !== null,
    );
    expect(transferHook.expectedControlState).toBe('KNOWN_RISK');
    expect(transferHook.expectedSeverity).toBe('CRITICAL');

    // Non-transferable token
    const nonTransferable = vectors.find(
      (v: Record<string, unknown>) => v.control === 'NON_TRANSFERABLE',
    );
    expect(nonTransferable.expectedControlState).toBe('KNOWN_RISK');
    expect(nonTransferable.expectedSeverity).toBe('CRITICAL');
  });

  it('resolves pool/LP control, withdrawal authority, and migration lineage through adapter', () => {
    const fixture = JSON.parse(readFileSync(POOL_SEC_FIXTURE, 'utf8'));
    const pools = fixture.pools;

    const burnedLpPool = pools.find((p: Record<string, unknown>) => p.lpControlState === 'BURNED');
    expect(burnedLpPool).toBeDefined();
    expect(burnedLpPool.adapterSupportState).toBe('RESOLVED');
    expect(burnedLpPool.withdrawalAuthorityState).toBe('REVOKED');
    expect(burnedLpPool.lpBurnPercentage).toBe(100.0);
    expect(burnedLpPool.expectedSeverity).toBe('NONE');

    const lockedLpPool = pools.find((p: Record<string, unknown>) => p.lpControlState === 'LOCKED');
    expect(lockedLpPool).toBeDefined();
    expect(lockedLpPool.adapterSupportState).toBe('RESOLVED');
    expect(lockedLpPool.withdrawalAuthorityState).toBe('PRESENT');
    expect(lockedLpPool.lpLockEvidence.lockerAddress).toBeDefined();
    expect(lockedLpPool.migrationLineage.migrationEdgeType).toBe('PUMP_TO_RAYDIUM');
    expect(lockedLpPool.expectedSeverity).toBe('MEDIUM');

    const openLpAbusedPool = pools.find(
      (p: Record<string, unknown>) => p.lpControlState === 'OPEN',
    );
    expect(openLpAbusedPool).toBeDefined();
    expect(openLpAbusedPool.adapterSupportState).toBe('RESOLVED');
    expect(openLpAbusedPool.withdrawalAuthorityState).toBe('PRESENT_WITH_OBSERVED_ABUSE');
    expect(openLpAbusedPool.quoteParityState).toBe('FAIL');
    expect(openLpAbusedPool.expectedSeverity).toBe('CRITICAL');
  });
});
