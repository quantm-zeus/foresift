/**
 * GMGN reference catalog (FR-PROV-006; T116): STRICTLY QUERY-ONLY market and
 * address analytics reads. Every operation is a GET returning JSON; there is
 * no operation — and must never be one — that builds, signs, routes, swaps,
 * or submits anything. The enumeration contract test fails if any exposed
 * operation id, path, or capability class drifts toward the trading surface.
 */
import type { UtcTimestamp } from '@foresift/domain';
import type {
  AdapterAllowlistEntry,
  OperationWireDescriptor,
  ProviderAdapterDescriptor,
} from '../adapter-contract.ts';

const VERIFICATION_HORIZON = '2026-09-30T00:00:00Z' as UtcTimestamp;
const GMGN_HOSTS: readonly AdapterAllowlistEntry[] = [{ host: 'gmgn.ai', port: 443 }];

function gmgnOperation(input: Omit<OperationWireDescriptor, 'supportedChains' | 'inputSchemaId' | 'rawOutputSchemaId' | 'normalizedOutputSchemaId' | 'quotaModelId' | 'cachePolicyId' | 'timeoutMs' | 'retryPolicyId' | 'declaredIndependenceGroup' | 'upstreamLineage' | 'licensePolicyId' | 'estimatedQuotaUnits' | 'quotaResetPolicyId' | 'protectedReserveEligible' | 'paidFallbackAllowed' | 'verificationExpiresAt'> & Partial<Pick<OperationWireDescriptor, 'timeoutMs'>>): OperationWireDescriptor {
  return {
    supportedChains: ['solana'],
    inputSchemaId: `schema://gmgn/input/${input.operationId}@${input.version}`,
    rawOutputSchemaId: `schema://gmgn/raw/${input.operationId}@${input.version}`,
    normalizedOutputSchemaId: `schema://gmgn/normalized/${input.operationId}@${input.version}`,
    quotaModelId: 'quota://gmgn/http-requests',
    cachePolicyId: 'cache://short-ttl',
    timeoutMs: input.timeoutMs ?? 10_000,
    retryPolicyId: 'retry://standard',
    declaredIndependenceGroup: 'gmgn-primary',
    upstreamLineage: [],
    licensePolicyId: 'license://gmgn-terms-2026-06',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'quota-reset://monthly',
    protectedReserveEligible: false,
    paidFallbackAllowed: false,
    verificationExpiresAt: VERIFICATION_HORIZON,
    ...input,
  };
}

export const GMGN_DESCRIPTOR: ProviderAdapterDescriptor = {
  providerId: 'gmgn',
  displayName: 'GMGN market analytics (query-only)',
  providerGroup: 'market-analytics',
  baseUrl: 'https://gmgn.ai',
  operations: [
    gmgnOperation({
      operationId: 'get-token-price',
      version: '1.0.0',
      displayName: 'Get current token price',
      capabilityClass: 'READ_MARKET',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/defi/quotation/v1/tokens/price',
      declaredQueryParams: ['chain', 'address'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 262_144,
      allowlistEntries: GMGN_HOSTS,
      allowedInStrictFree: true,
    }),
    gmgnOperation({
      operationId: 'get-token-overview',
      version: '1.0.0',
      displayName: 'Get token market overview',
      capabilityClass: 'READ_MARKET',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/defi/quotation/v1/tokens/detail',
      declaredQueryParams: ['chain', 'address'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 524_288,
      allowlistEntries: GMGN_HOSTS,
      allowedInStrictFree: true,
    }),
    gmgnOperation({
      operationId: 'get-trending-pools',
      version: '1.0.0',
      displayName: 'List trending pools (read-only ranking)',
      capabilityClass: 'READ_MARKET',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/defi/quotation/v1/rank/sol/pools',
      declaredQueryParams: ['orderby', 'direction', 'limit'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 1_048_576,
      allowlistEntries: GMGN_HOSTS,
      allowedInStrictFree: true,
    }),
    gmgnOperation({
      operationId: 'get-address-activity',
      version: '1.0.0',
      displayName: 'Read public address activity summary',
      capabilityClass: 'READ_ACCOUNT_STATE',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/defi/quotation/v1/smart/money_summary',
      declaredQueryParams: ['chain', 'wallet'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 262_144,
      allowlistEntries: GMGN_HOSTS,
      allowedInStrictFree: true,
    }),
  ],
};
