/**
 * AC-023 acceptance (positive).
 * Traces: FR-DATA-001 (§11.2 decimals, §11.5 addresses).
 * AC text (manifest §39): "Decimals and address normalization pass
 * chain-specific golden fixtures."
 *
 * Drives the committed golden fixtures (`tests/fixtures/data/*.json`) through
 * the full stack — chain identity persisted via the repository, EVM/Solana
 * normalization + EIP-55 rendering, CAIP-10 accounts, and the versioned
 * decimals resolution state machine on a live database.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DecimalsResolutionState,
  caip10,
  normalizeAddressForNamespace,
  normalizeEvmAddress,
  normalizeSolanaAddress,
  renderEip55,
  utcTimestamp,
} from '@foresift/domain';
import {
  ensureChain,
  insertRepresentation,
  recordDecimalsObservation,
} from '@foresift/persistence';
import { closeTestDatabase, makeTestDatabase, type TestDatabase } from './helpers.ts';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/data');

interface IdentityVectors {
  chains: { chainId: string; expectedMappingQuality: string }[];
  evmAddresses: { input: string; canonical: string; eip55: string }[];
  solanaAddresses: { input: string; canonical: string }[];
  caip10: { chainId: string; address: string; accountId: string }[];
}

interface DecimalsVectors {
  scenarios: {
    name: string;
    representation: { chainId: string; canonicalAddress: string };
    observations: {
      observationId: string;
      decimals: number;
      observedAt: string;
      sourceRef: string;
      expectRefusal?: boolean;
    }[];
    expectedState: string;
    expectedDecimals: number | null;
  }[];
}

let tdb: TestDatabase;
let identityVectors: IdentityVectors;
let decimalsVectors: DecimalsVectors;

beforeAll(async () => {
  tdb = await makeTestDatabase();
  identityVectors = JSON.parse(
    readFileSync(path.join(FIXTURES, 'identity-vectors.json'), 'utf8'),
  ) as IdentityVectors;
  decimalsVectors = JSON.parse(
    readFileSync(path.join(FIXTURES, 'decimals-vectors.json'), 'utf8'),
  ) as DecimalsVectors;
});

afterAll(() => closeTestDatabase(tdb));

describe('AC-023: chain-specific golden fixtures pass end to end', () => {
  it('persists every registered chain id with its declared mapping quality', async () => {
    for (const c of identityVectors.chains) {
      const identity = await ensureChain(tdb.engine, c.chainId);
      expect(identity.mappingQuality).toBe(c.expectedMappingQuality);
    }
  });

  it('normalizes every golden EVM address and renders its exact EIP-55 form', () => {
    for (const v of identityVectors.evmAddresses) {
      expect(normalizeAddressForNamespace('eip155', v.input)).toBe(v.canonical);
      expect(normalizeEvmAddress(v.input)).toBe(v.canonical);
      expect(renderEip55(normalizeEvmAddress(v.canonical))).toBe(v.eip55);
      // Rendering is presentation only: round-trip keeps one canonical form.
      expect(normalizeEvmAddress(v.eip55)).toBe(v.canonical);
    }
  });

  it('validates every golden Solana address preserving its base58 form', () => {
    for (const v of identityVectors.solanaAddresses) {
      expect(normalizeAddressForNamespace('solana', v.input)).toBe(v.canonical);
      expect(normalizeSolanaAddress(v.input)).toBe(v.canonical);
    }
  });

  it('composes every golden CAIP-10 account id', () => {
    for (const v of identityVectors.caip10) {
      const normalized = v.chainId.startsWith('eip155')
        ? normalizeEvmAddress(v.address)
        : normalizeSolanaAddress(v.address);
      expect(caip10(v.chainId as never, normalized)).toBe(v.accountId);
    }
  });

  it('resolves every decimals scenario to its declared final state and value', async () => {
    for (const scenario of decimalsVectors.scenarios) {
      await insertRepresentation(tdb.engine, {
        chainId: scenario.representation.chainId,
        canonicalAddress: scenario.representation.canonicalAddress,
      });
      for (const obs of scenario.observations) {
        const attempt = recordDecimalsObservation(tdb.engine, {
          observationId: obs.observationId,
          chainId: scenario.representation.chainId,
          canonicalAddress: scenario.representation.canonicalAddress,
          decimals: obs.decimals,
          observedAt: utcTimestamp(obs.observedAt),
          sourceRef: obs.sourceRef,
        });
        if (obs.expectRefusal === true) {
          await expect(attempt, scenario.name).rejects.toThrow();
        } else {
          await attempt;
        }
      }
      if (scenario.observations.some((o) => o.expectRefusal === true)) continue;
      const stored = await tdb.engine.query<{ decimals_state: string; decimals: number | null }>(
        'SELECT decimals_state, decimals FROM asset_representations WHERE chain_id = $1 AND canonical_address = $2',
        [scenario.representation.chainId, scenario.representation.canonicalAddress],
      );
      const row = stored.rows[0];
      expect(row?.decimals_state, scenario.name).toBe(scenario.expectedState);
      expect(row?.decimals ?? null, scenario.name).toBe(scenario.expectedDecimals);
    }
  });

  it('exposes the conflicting vocabulary as an explicit unusable state', () => {
    expect(DecimalsResolutionState.CONFLICTING).toBe('CONFLICTING');
  });
});
