/**
 * GMGN operation catalog — STRICTLY query-only (FR-PROV-006; T116).
 *
 * Every exposed operation is an individually declared read-only query with
 * its own exact allowlist descriptor. The catalog carries NO swap, quote-to-
 * transaction, sign, submit, private-key, wallet-trading, route, or order-
 * status capability in ANY form: not as operations, not as fields, not as
 * "future extension points".
 *
 * `gmgnExposedOperationIds()` backs the enumeration contract test that FAILS
 * the build if a trading-related operation EVER appears here.
 */
import type { AllowlistDescriptor } from '../adapter-contract.ts';
import type { UtcTimestamp } from '@foresift/domain';
import type { OperationDefinition } from '@foresift/provider-lifecycle';

/** Honest-by-default: unverified catalog registrations carry an elapsed window. */
const UNVERIFIED_WINDOW_END = '2020-01-01T00:00:00Z' as UtcTimestamp;

const GMGN_HOST = 'api.gmgn.ai';
const GMGN_PORT = 443;

/** Query-only descriptor factory — GET, JSON responses, redirects refused. */
function gmgnQueryDescriptor(
  operationId: string,
  pathTemplate: string,
  allowedQueryFields: string[],
): AllowlistDescriptor {
  return {
    operationId,
    scheme: 'https',
    host: GMGN_HOST,
    port: GMGN_PORT,
    pathTemplate,
    method: 'GET',
    requestContentTypes: [],
    responseContentTypes: ['application/json'],
    responseSchemaId: `gmgn/${operationId}@1`,
    allowedQueryFields,
    allowedRequestFields: [],
    redirectPolicy: 'REFUSE',
    maxRedirects: 0,
    maxResponseBytes: 2 * 1024 * 1024,
  };
}

function gmgnOperation(operationId: string): OperationDefinition {
  return {
    providerId: 'gmgn',
    operationId,
    version: 'v1',
    capabilityClass: 'READ_MARKET',
    costClass: 'FREE_UNMETERED',
    supportedChains: ['solana', 'ethereum', 'base'],
    supportedPrograms: [],
    inputSchemaId: `gmgn/in/${operationId}@1`,
    rawOutputSchemaId: `gmgn/raw/${operationId}@1`,
    normalizedOutputSchemaId: `gmgn/norm/${operationId}@1`,
    quotaModelId: 'gmgn-quota@1',
    cachePolicyId: 'short-cache@1',
    timeoutMs: 10_000,
    retryPolicyId: 'idempotent-get@1',
    declaredIndependenceGroup: 'GMGN',
    upstreamLineage: [],
    licensePolicyId: 'gmgn-tos-query@1',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'rolling-window@1',
    batchCapability: null,
    minimumCandidateStage: null,
    protectedReserveEligible: false,
    allowedInStrictFree: true,
    paidFallbackAllowed: false,
    deprecatedAt: null,
    sunsetAt: null,
    replacementOperationId: null,
    verificationExpiresAt: UNVERIFIED_WINDOW_END,
    forbiddenOutputFields: [],
    negativeCapabilities: [],
  };
}

export interface GmgnCatalogEntry {
  readonly operation: OperationDefinition;
  readonly descriptor: AllowlistDescriptor;
  readonly responseSchemaId: string;
}

/** The complete GMGN query surface. NOTHING else is integrated. */
export const GMGN_OPERATIONS: readonly GmgnCatalogEntry[] = [
  {
    operation: gmgnOperation('token.security'),
    descriptor: gmgnQueryDescriptor(
      'token.security',
      '/api/v1/tokens/{chain}/{address}/security',
      [],
    ),
    responseSchemaId: 'gmgn/token.security@1',
  },
  {
    operation: gmgnOperation('token.top_traders'),
    descriptor: gmgnQueryDescriptor(
      'token.top_traders',
      '/api/v1/tokens/{chain}/{address}/top_traders',
      ['limit'],
    ),
    responseSchemaId: 'gmgn/token.top_traders@1',
  },
  {
    operation: gmgnOperation('token.pair_stats'),
    descriptor: gmgnQueryDescriptor(
      'token.pair_stats',
      '/api/v1/pairs/{chain}/{pairAddress}/stats',
      [],
    ),
    responseSchemaId: 'gmgn/token.pair_stats@1',
  },
] as const;

/** Enumeration contract surface: EVERY id this integration exposes. */
export function gmgnExposedOperationIds(): string[] {
  return GMGN_OPERATIONS.map((entry) => entry.operation.operationId);
}
