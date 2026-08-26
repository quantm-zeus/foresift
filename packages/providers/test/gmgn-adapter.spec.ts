/**
 * T116: GMGN strictly query-only contract. The exposed-operation enumeration
 * test FAILS if any trading-related operation EVER appears in the catalog —
 * swap, quote-to-transaction, sign, submit, private-key, wallet-trading,
 * route, or order-status shapes are prohibited by FR-PROV-006.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  AdapterClient,
  GMGN_OPERATIONS,
  createGmgnAdapterManifest,
  gmgnExposedOperationIds,
  recordedFetchPort,
} from '../src/index.ts';
import { jsonResponse, testGuard } from './helpers.ts';

/** Any id or path matching this pattern is a trading CAPABILITY — FAIL.
 * (Read-only analytics like `top_traders` are NOT trading capabilities; the
 * pattern matches action/execution shapes: swaps, signing, submission,
 * key handling, order routing/status, transaction building.) */
const TRADING_SHAPE =
  /(swap|quote[-_]?to[-_]?transaction|\bsign(?:ature)?[-_]?\b|submit|private[-_]?key|seed[-_]?phrase|wallet[-_]?(?:connect|import|auth)|place[-_]?order|order[-_]?(?:placement|status)|transaction[-_]?build|routing|liquidity[-_]?(?:add|remove)|bridg(?:e|ing))/i;

describe('T116 GMGN query-only contract', () => {
  it('enumerates EXACTLY the query operations and nothing else', () => {
    expect(gmgnExposedOperationIds()).toEqual([
      'token.security',
      'token.top_traders',
      'token.pair_stats',
    ]);
  });

  it('FAILS if any exposed operation id carries a trading-related shape', () => {
    const offenders = gmgnExposedOperationIds().filter((id) => TRADING_SHAPE.test(id));
    expect(
      offenders,
      `trading-related operations exposed by the GMGN integration: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('every descriptor is GET-only JSON with empty request fields and refused redirects', () => {
    for (const entry of GMGN_OPERATIONS) {
      expect(entry.descriptor.method).toBe('GET');
      expect(entry.descriptor.requestContentTypes).toEqual([]);
      expect(entry.descriptor.allowedRequestFields).toEqual([]);
      expect(entry.descriptor.redirectPolicy).toBe('REFUSE');
      expect(entry.descriptor.maxRedirects).toBe(0);
      expect(TRADING_SHAPE.test(entry.descriptor.pathTemplate)).toBe(false);
      expect(entry.operation.capabilityClass).toBe('READ_MARKET');
    }
  });

  it('a trading-shaped operation can never be registered through the manifest', async () => {
    // The manifest factory derives ONLY from the catalog; there is no path
    // that appends an undeclared operation. Assert the structural fact:
    // manifest length always equals catalog length.
    const manifest = createGmgnAdapterManifest();
    expect(manifest.operations).toHaveLength(GMGN_OPERATIONS.length);
  });

  it('clean recorded query fixtures flow end-to-end through allowlist + validation', async () => {
    const fixture = readFileSync(
      new URL('./fixtures/gmgn/token-security.json', import.meta.url),
      'utf8',
    );
    const entry = GMGN_OPERATIONS[0];
    if (entry === undefined) throw new Error('GMGN catalog is empty');
    const client = new AdapterClient<Record<string, unknown>>({
      descriptor: entry.descriptor,
      responseSchema: z.object({ address: z.string().min(1) }).passthrough(),
      guard: testGuard(),
      plane: 'COLLECTOR',
      fetchPort: recordedFetchPort(
        new Map([
          [
            `GET https://api.gmgn.ai:443/api/v1/tokens/sol/So11111111111111111111111111111111111111112/security`,
            jsonResponse(fixture),
          ],
        ]),
      ),
    });
    const result = await client.execute({
      pathParams: { chain: 'sol', address: 'So11111111111111111111111111111111111111112' },
    });
    expect(result.data.address).toBe('So11111111111111111111111111111111111111112');
    expect(result.data['renounced_mint']).toBe(true);
  });
});
