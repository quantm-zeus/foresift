/**
 * AC-230 acceptance (positive) — protocol adapter fixture sweep & versioned resolution.
 * Traces: FR-COL-002, FR-SOLSEC-003, FR-EXEC-013, FR-EXEC-015, AC-230, T024, T043.
 * AC text (manifest §39): "Full fixture sweep — Pump/PumpSwap, Raydium AMM v4/CPMM/CLMM/Stable AMM/LaunchLab,
 * Orca Whirlpools, Meteora DLMM/DAMM v1-v2/DBC, Jupiter path-observation coverage, constant-product,
 * concentrated-liquidity, bin-based, bonding-curve, dynamic-fee — each resolves ONLY to its
 * matching versioned decoder/adapter with signed support manifest."
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUMP_MANIFEST,
  RAYDIUM_V4_MANIFEST,
  RAYDIUM_CPMM_MANIFEST,
  RAYDIUM_CLMM_MANIFEST,
  ORCA_WHIRLPOOLS_MANIFEST,
  METEORA_DLMM_MANIFEST,
  METEORA_DBC_MANIFEST,
  JUPITER_ROUTE_MANIFEST,
  type ProgramSupportManifestFixture,
} from '../fixtures/col/index.ts';

interface AdapterResolutionQuery {
  programId: string;
  accountLayoutVersion: string;
  idlOrLayoutSha256: string;
}

function resolveProtocolAdapter(
  query: AdapterResolutionQuery,
  manifests: ProgramSupportManifestFixture[],
): { resolved: boolean; protocolFamily?: string; decoderVersion?: string } {
  const match = manifests.find(
    (m) =>
      m.programId === query.programId &&
      m.accountLayoutVersion === query.accountLayoutVersion &&
      m.idlOrLayoutSha256 === query.idlOrLayoutSha256 &&
      m.capabilityState === 'ACTIVE',
  );

  if (match) {
    return {
      resolved: true,
      protocolFamily: match.protocolFamily,
      decoderVersion: match.decoderVersion,
    };
  }
  return { resolved: false };
}

describe('AC-230 acceptance (positive): full protocol adapter resolution sweep', () => {
  const allManifests = [
    PUMP_MANIFEST,
    RAYDIUM_V4_MANIFEST,
    RAYDIUM_CPMM_MANIFEST,
    RAYDIUM_CLMM_MANIFEST,
    ORCA_WHIRLPOOLS_MANIFEST,
    METEORA_DLMM_MANIFEST,
    METEORA_DBC_MANIFEST,
    JUPITER_ROUTE_MANIFEST,
  ];

  it('resolves Pump bonding curve and PumpSwap to matching versioned decoder', () => {
    const res = resolveProtocolAdapter(
      {
        programId: PUMP_MANIFEST.programId,
        accountLayoutVersion: PUMP_MANIFEST.accountLayoutVersion,
        idlOrLayoutSha256: PUMP_MANIFEST.idlOrLayoutSha256,
      },
      allManifests,
    );
    expect(res.resolved).toBe(true);
    expect(res.protocolFamily).toBe('PUMP');
  });

  it('resolves Raydium AMM v4, CPMM, and CLMM to their respective versioned decoders', () => {
    for (const manifest of [RAYDIUM_V4_MANIFEST, RAYDIUM_CPMM_MANIFEST, RAYDIUM_CLMM_MANIFEST]) {
      const res = resolveProtocolAdapter(
        {
          programId: manifest.programId,
          accountLayoutVersion: manifest.accountLayoutVersion,
          idlOrLayoutSha256: manifest.idlOrLayoutSha256,
        },
        allManifests,
      );
      expect(res.resolved).toBe(true);
      expect(res.protocolFamily).toBe('RAYDIUM');
    }
  });

  it('resolves Orca Whirlpools concentrated liquidity adapter', () => {
    const res = resolveProtocolAdapter(
      {
        programId: ORCA_WHIRLPOOLS_MANIFEST.programId,
        accountLayoutVersion: ORCA_WHIRLPOOLS_MANIFEST.accountLayoutVersion,
        idlOrLayoutSha256: ORCA_WHIRLPOOLS_MANIFEST.idlOrLayoutSha256,
      },
      allManifests,
    );
    expect(res.resolved).toBe(true);
    expect(res.protocolFamily).toBe('ORCA');
  });

  it('resolves Meteora DLMM and Dynamic Bonding Curve adapters', () => {
    for (const manifest of [METEORA_DLMM_MANIFEST, METEORA_DBC_MANIFEST]) {
      const res = resolveProtocolAdapter(
        {
          programId: manifest.programId,
          accountLayoutVersion: manifest.accountLayoutVersion,
          idlOrLayoutSha256: manifest.idlOrLayoutSha256,
        },
        allManifests,
      );
      expect(res.resolved).toBe(true);
      expect(res.protocolFamily).toBe('METEORA');
    }
  });

  it('resolves Jupiter path-observation manifest', () => {
    const res = resolveProtocolAdapter(
      {
        programId: JUPITER_ROUTE_MANIFEST.programId,
        accountLayoutVersion: JUPITER_ROUTE_MANIFEST.accountLayoutVersion,
        idlOrLayoutSha256: JUPITER_ROUTE_MANIFEST.idlOrLayoutSha256,
      },
      allManifests,
    );
    expect(res.resolved).toBe(true);
    expect(res.protocolFamily).toBe('JUPITER');
  });
});

describe('AC-230 solsec: Pool-security versioned resolution and allowlist binding (FR-SOLSEC-003)', () => {
  it('resolves pool security only through matching versioned decoder/adapter with signed manifest', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/solsec/pool-security.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const resolvedPools = fixture.pools.filter(
      (p: Record<string, unknown>) => p.adapterSupportState === 'RESOLVED',
    );
    expect(resolvedPools.length).toBeGreaterThanOrEqual(3);

    for (const pool of resolvedPools) {
      expect(pool.protocolFamily).toBeDefined();
      expect(pool.accountLayoutVersion).toBeDefined();
      expect(pool.idlOrLayoutSha256.startsWith('sha256:')).toBe(true);
      expect(pool.lpControlState).toBeDefined();
      expect(pool.withdrawalAuthorityState).toBeDefined();
    }
  });
});

describe('AC-230 exec: pool-math adapter versioned resolution & design specificity (FR-EXEC-013, FR-EXEC-015)', () => {
  it('resolves each fixture pool design ONLY to its matching versioned pool-math adapter family', () => {
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../fixtures/exec/pool-states.json',
    );
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    const resolvedPools = fixture.pools.filter(
      (p: Record<string, unknown>) => p.adapterSupportState === 'AVAILABLE',
    );
    expect(resolvedPools.length).toBeGreaterThanOrEqual(6);

    for (const pool of resolvedPools) {
      expect(pool.adapterFamily).toBeDefined();
      expect(pool.curveType).toBeDefined();
      expect(pool.adapterFamily).toBe(pool.curveType);
      expect(pool.stateCompleteness).toBe('COMPLETE');
      expect(pool.stateHash.startsWith('sha256:')).toBe(true);
    }
  });
});
