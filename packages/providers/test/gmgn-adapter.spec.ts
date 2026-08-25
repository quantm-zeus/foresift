/**
 * GMGN adapter suite (FR-PROV-006, AC-255): the exposed-operation
 * enumeration contract FAILS if any trading-related operation ever appears;
 * forbidden runtime registration variants refuse; clean recorded query
 * fixtures flow end-to-end through the allowlist and validation layers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  applyMigrations,
  createEngine,
  PRECISION_RETAINING_TIMESTAMP_PARSERS,
  type DatabaseEngine,
} from '@foresift/persistence';
import { ProvErrorCode } from '@foresift/provider-lifecycle';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdapterContract } from '../src/adapter-contract.ts';
import { AdapterRegistrar } from '../src/registration.ts';
import { defineReadOnlyOperation } from '../src/catalog-support.ts';
import { GMGN_HOST, GMGN_OPERATIONS, GMGN_PROVIDER } from '../src/operation-catalogs/gmgn.catalog.ts';
import { GmgnAdapter } from '../src/adapters/gmgn-adapter.ts';
import {
  fixtureFetch,
  jsonResponse,
  PUBLIC_IP,
  staticResolver,
  GMGN_TOKEN_SECURITY_FIXTURE,
  GMGN_WALLET_ACTIVITY_FIXTURE,
} from './fixtures.ts';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);

let db: PGlite;
let engine: DatabaseEngine;

function gmgnContract(): AdapterContract {
  return new AdapterContract({
    descriptors: GMGN_OPERATIONS.map((e) => e.allowlist),
    resolver: staticResolver({ [GMGN_HOST]: [PUBLIC_IP] }),
  });
}

beforeAll(async () => {
  db = new PGlite({ parsers: PRECISION_RETAINING_TIMESTAMP_PARSERS });
  engine = createEngine(db, 'pglite');
  await applyMigrations({ engine, migrationsDir: MIGRATIONS_DIR });
});

afterAll(async () => {
  await db.close();
});

describe('exposed-operation enumeration contract (FR-PROV-006)', () => {
  /** The predicate the contract test enforces over EVERY exposed operation. */
  const TRADING_VOCABULARY = /swap|quote|route|sign|submit|trade|order|bridge|liquidity-add|burn-/i;

  it('every exposed operation is pure read-only query surface', () => {
    expect(GMGN_OPERATIONS.length).toBeGreaterThan(0);
    for (const entry of GMGN_OPERATIONS) {
      // Operation id names no trading concept.
      expect(TRADING_VOCABULARY.test(entry.definition.operationId)).toBe(false);
      // Capability class is a READ_* admissible class — never a prohibited
      // or quote-to-transaction shape.
      expect(entry.definition.capabilityClass.startsWith('READ_')).toBe(true);
      // Exactly one allowlisted host, GET, no redirects, JSON responses.
      expect(entry.allowlist.egress.host).toBe(GMGN_HOST);
      expect(entry.allowlist.method).toBe('GET');
      expect(entry.allowlist.redirects.policy).toBe('NONE');
      expect(entry.allowlist.responseContentTypes).toEqual(['application/json']);
      // Negative capabilities ride every descriptor's definition.
      expect(entry.definition.negativeCapabilities).toContain('no-trading');
    }
  });

  it('the enumeration predicate HAS TEETH — a trading-shaped op is flagged', () => {
    // Prove the contract test would fail if a swap operation ever appeared.
    const infiltrator = {
      definition: defineReadOnlyOperation({
        providerId: GMGN_PROVIDER.providerId,
        operationId: 'gmgn/swap-quote-and-submit',
        capabilityClass: 'QUOTE_READ_ONLY',
      }),
      allowlist: { ...GMGN_OPERATIONS[0]!.allowlist, operationId: 'gmgn/swap-quote-and-submit' },
    };
    const TRADING = /swap|quote|route|sign|submit|trade|order|bridge/i;
    expect(TRADING.test(infiltrator.definition.operationId)).toBe(true);
  });

  it('forbidden runtime registration variants refuse outright', async () => {
    const registrar = new AdapterRegistrar({ engine });
    const base = GMGN_OPERATIONS[0]!;
    for (const poisoned of [
      'PROHIBITED_TRANSACTION_BUILD',
      'PROHIBITED_SIGN',
      'PROHIBITED_SUBMIT',
      'PROHIBITED_CUSTODY',
    ] as const) {
      await expect(
        registrar.registerAdapter({
          providerId: 'gmgn',
          displayName: 'GMGN',
          exposure: { kind: 'INDIVIDUAL_OPERATIONS' },
          operations: [{ definition: { ...base.definition, capabilityClass: poisoned }, allowlist: base.allowlist }],
        }),
      ).rejects.toMatchObject({ code: ProvErrorCode.PROV_CAPABILITY_CLASS_PROHIBITED });
    }
  });
});

describe('clean recorded fixtures flow end-to-end through both layers', () => {
  it('token security and wallet activity reads return validated data', async () => {
    const adapter = new GmgnAdapter({
      contract: gmgnContract(),
      fetch: fixtureFetch((request) => {
        if (request.url.includes('/token_security/')) return jsonResponse(GMGN_TOKEN_SECURITY_FIXTURE);
        if (request.url.includes('/wallet_activity/')) return jsonResponse(GMGN_WALLET_ACTIVITY_FIXTURE);
        throw new Error(`unexpected fixture request: ${request.url}`);
      }),
    });

    const security = (await adapter.tokenSecurity({
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    })) as typeof GMGN_TOKEN_SECURITY_FIXTURE;
    expect(security.data.symbol).toBe('TESTCOIN');

    const activity = (await adapter.walletActivity({
      wallet: '9xQeWvG816bUx9EPSjvfHUwkQ4mB2uJ7u6FwWcpGRnoT',
      query: { limit: '10' },
    })) as typeof GMGN_WALLET_ACTIVITY_FIXTURE;
    expect(activity.history).toHaveLength(1);
  });

  it('undeclared request fields refuse before any transport call', async () => {
    let called = 0;
    const adapter = new GmgnAdapter({
      contract: gmgnContract(),
      fetch: fixtureFetch(() => {
        called += 1;
        return jsonResponse(GMGN_WALLET_ACTIVITY_FIXTURE);
      }),
    });
    // 'apikey' is NOT on the wallet-activity allowlist — and credentials in
    // URLs are a product-boundary violation anyway.
    await expect(
      adapter.walletActivity({ wallet: 'w', query: { apikey: 'nope' } }),
    ).rejects.toMatchObject({ code: ProvErrorCode.PROV_ALLOWLIST_REQUEST_FIELD_REFUSED });
    expect(called).toBe(0);
  });
});
