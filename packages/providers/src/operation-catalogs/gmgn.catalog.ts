/**
 * GMGN operation catalog (FR-PROV-006; §15.8 GMGN) — STRICTLY QUERY-ONLY.
 *
 * This catalog is the complete declared exposure of the GMGN integration.
 * The enumeration contract test in test/gmgn-adapter.spec.ts FAILS if any
 * operation ever appears whose id, capability class, or path is not pure
 * read-only query surface: swap, quote-to-transaction, sign, submit,
 * private-key, wallet-management, and order/trade-status operations are
 * prohibited and have no representation here beyond the negative tests that
 * prove their refusal.
 */
import { z } from 'zod';
import { defineReadOnlyOperation, type ProviderCatalogEntry } from '../catalog-support.ts';

export const GMGN_PROVIDER = Object.freeze({
  providerId: 'gmgn',
  providerGroup: 'external-provider',
  displayName: 'GMGN (query-only)',
});

export const GMGN_HOST = 'gmgn.ai';

// Recorded-shape response schemas: default (stripping) objects over the
// fields the adapters actually read; unknown extra fields are ignored but
// everything read MUST be present and well-typed.
const TokenSecurityResponse = z.object({
  data: z
    .object({
      symbol: z.string().optional(),
      holder_count: z.number().optional(),
      renounced_mint: z.boolean().optional(),
      top10_holder_rate: z.number().optional(),
    })
    .optional(),
});
const TokenOverviewResponse = z.object({
  data: z
    .object({ price: z.number().optional(), liquidity: z.number().optional(), market_cap: z.number().optional() })
    .optional(),
});
const TrendingResponse = z.object({
  data: z.object({ rank: z.array(z.object({ address: z.string(), symbol: z.string().optional() })).optional() }),
});
const WalletActivityResponse = z.object({
  history: z.array(z.object({ signature: z.string(), activity_type: z.string().optional() })).optional(),
});

function entry(
  operationId: string,
  pathTemplate: string,
  capabilityClass: Parameters<typeof defineReadOnlyOperation>[0]['capabilityClass'],
  responseSchema: z.ZodTypeAny,
  queryParamAllowlist: readonly string[],
): ProviderCatalogEntry {
  return {
    definition: defineReadOnlyOperation({
      providerId: GMGN_PROVIDER.providerId,
      operationId,
      capabilityClass,
    }),
    allowlist: {
      operationId,
      egress: { scheme: 'https', host: GMGN_HOST, port: 443, plane: 'COLLECTOR' },
      method: 'GET',
      pathTemplate,
      queryParamAllowlist,
      responseContentTypes: ['application/json'],
      responseSchema,
      maxResponseBytes: 262_144,
      redirects: { policy: 'NONE' },
    },
  };
}

/** The strictly query-only GMGN exposure — the ONLY declared surface. */
export const GMGN_OPERATIONS: readonly ProviderCatalogEntry[] = Object.freeze([
  entry('gmgn/token-security-read', '/api/v1/token_security/{chain}/{address}', 'READ_SECURITY', TokenSecurityResponse, [
    'from',
  ]),
  entry('gmgn/token-overview-read', '/api/v1/token_overview/{chain}/{address}', 'READ_MARKET', TokenOverviewResponse, []),
  entry('gmgn/trending-pools-read', '/api/v1/trending_pools/{chain}', 'READ_MARKET', TrendingResponse, [
    'orderby',
    'direction',
    'limit',
  ]),
  entry(
    'gmgn/wallet-activity-read',
    '/api/v1/wallet_activity/{chain}/{wallet}',
    'READ_ACCOUNT_STATE',
    WalletActivityResponse,
    ['limit', 'tag'],
  ),
]);
