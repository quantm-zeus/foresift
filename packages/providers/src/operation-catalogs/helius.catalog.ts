/**
 * Helius operation catalog (FR-PROV-007; §15.8 Helius, AC-256).
 *
 * Raw `getTransaction` and standard signature-history operations are
 * separated from the DEPRECATED enhanced parser entry, which carries its
 * deprecation registry fields (deprecatedAt / sunsetAt /
 * replacementOperationId) and is retained ONLY as non-authoritative
 * evidence under a valid migration exception. The plan-gated historical
 * scan operation declares allowedInStrictFree=false: unavailable in the
 * free plan, it stays disabled in STRICT_FREE consumption.
 *
 * The decoderRole declarations here are the REAL registry entries the
 * security package's decoder-authority validator consumes (T118).
 */
import { z } from 'zod';
import { defineReadOnlyOperation, type ProviderCatalogEntry } from '../catalog-support.ts';

export const HELIUS_PROVIDER = Object.freeze({
  providerId: 'helius',
  providerGroup: 'external-provider',
  displayName: 'Helius (raw/history + local decoding)',
});

export const HELIUS_HOST = 'api.helius.xyz';
export const ENHANCED_PARSE_OPERATION_ID = 'helius/enhanced-transaction-parse';

const RawTransactionResponse = z.object({
  signature: z.string(),
  slot: z.number(),
  transaction: z.object({
    message: z.object({
      instructions: z.array(
        z.object({
          programId: z.string(),
          accounts: z.array(z.string()).optional(),
          data: z.string().optional(),
        }),
      ),
    }),
  }),
  meta: z.object({ err: z.unknown().nullable().optional() }).optional(),
});
const SignatureHistoryResponse = z.object({
  history: z.array(
    z.object({
      signature: z.string(),
      slot: z.number(),
      timestamp: z.number().optional(),
    }),
  ),
});

function entry(
  operationId: string,
  pathTemplate: string,
  capabilityClass: Parameters<typeof defineReadOnlyOperation>[0]['capabilityClass'],
  responseSchema: z.ZodTypeAny,
  queryParamAllowlist: readonly string[],
  overrides?: Partial<Parameters<typeof defineReadOnlyOperation>[0]>,
  decoderRole?: ProviderCatalogEntry['decoderRole'],
): ProviderCatalogEntry {
  return {
    definition: defineReadOnlyOperation({
      providerId: HELIUS_PROVIDER.providerId,
      operationId,
      capabilityClass,
      ...overrides,
    }),
    allowlist: {
      operationId,
      egress: { scheme: 'https', host: HELIUS_HOST, port: 443, plane: 'COLLECTOR' },
      method: 'GET',
      pathTemplate,
      queryParamAllowlist,
      responseContentTypes: ['application/json'],
      responseSchema,
      maxResponseBytes: 1_048_576,
      redirects: { policy: 'NONE' },
    },
    ...(decoderRole === undefined ? {} : { decoderRole }),
  };
}

/** The declared Helius exposure — raw/history authoritative, parser deprecated. */
export const HELIUS_OPERATIONS: readonly ProviderCatalogEntry[] = Object.freeze([
  entry(
    'helius/raw-get-transaction',
    '/v0/transactions/{signature}',
    'READ_TRANSACTION_RAW',
    RawTransactionResponse,
    ['encoding'],
    {},
    // THE authoritative economic-event decoding path (raw + local pass).
    { authority: 'SOLE', domains: ['transaction-history'] },
  ),
  entry(
    'helius/signature-history-standard',
    '/v0/addresses/{address}/transactions',
    'READ_TRANSACTION_HISTORY',
    SignatureHistoryResponse,
    ['limit', 'before', 'until'],
    {},
    { authority: 'PRIMARY', domains: ['transaction-history'] },
  ),
  entry(
    ENHANCED_PARSE_OPERATION_ID,
    '/v0/enhanced/transactions/{signature}',
    'READ_TRANSACTION_HISTORY',
    z.object({ description: z.string().optional(), type: z.string().optional() }),
    [],
    {
      deprecatedAt: '2026-05-01T00:00:00Z',
      sunsetAt: '2026-09-01T00:00:00Z',
      replacementOperationId: 'helius/raw-get-transaction',
    },
    // NON-authoritative evidence only — never SOLE/PRIMARY.
    { authority: 'FALLBACK', domains: ['transaction-history'] },
  ),
  entry(
    // Plan-gated history operation: unavailable on the free plan → stays
    // DISABLED in STRICT_FREE consumption metadata.
    'helius/historical-signature-scan',
    '/v2/historical/signatures/{address}',
    'READ_TRANSACTION_HISTORY',
    SignatureHistoryResponse,
    ['limit', 'cursor'],
    { allowedInStrictFree: false, paidFallbackAllowed: false, costClass: 'PAID_EXPLICIT' },
    { authority: 'NONE', domains: ['transaction-history'] },
  ),
]);
