/**
 * Helius reference catalog (FR-PROV-007; T117): supported raw/history read
 * operations with a hard separation between RAW responses and LOCAL decoding.
 * The vendor's enhanced parser is a DEPRECATED, exception-gated FALLBACK —
 * never the authoritative decoder (see ../helius-decoding.ts). The one
 * plan-gated operation is disabled under STRICT_FREE by construction
 * (planGated ⇒ allowedInStrictFree false; registration refuses otherwise).
 */
import type { UtcTimestamp } from '@foresift/domain';
import type {
  AdapterAllowlistEntry,
  OperationWireDescriptor,
  ProviderAdapterDescriptor,
} from '../adapter-contract.ts';

const VERIFICATION_HORIZON = '2026-09-30T00:00:00Z' as UtcTimestamp;
const RPC_HOSTS: readonly AdapterAllowlistEntry[] = [{ host: 'mainnet.helius-rpc.com', port: 443 }];
const API_HOSTS: readonly AdapterAllowlistEntry[] = [{ host: 'api.helius.dev', port: 443 }];

function heliusOperation(input: Omit<OperationWireDescriptor, 'supportedChains' | 'inputSchemaId' | 'rawOutputSchemaId' | 'normalizedOutputSchemaId' | 'quotaModelId' | 'cachePolicyId' | 'timeoutMs' | 'retryPolicyId' | 'declaredIndependenceGroup' | 'upstreamLineage' | 'licensePolicyId' | 'estimatedQuotaUnits' | 'quotaResetPolicyId' | 'protectedReserveEligible' | 'paidFallbackAllowed' | 'verificationExpiresAt'> & Partial<Pick<OperationWireDescriptor, 'timeoutMs'>>): OperationWireDescriptor {
  return {
    supportedChains: ['solana'],
    supportedPrograms: [{ programId: 'all', versions: ['*'] }],
    inputSchemaId: `schema://helius/input/${input.operationId}@${input.version}`,
    rawOutputSchemaId: `schema://helius/raw/${input.operationId}@${input.version}`,
    normalizedOutputSchemaId: `schema://helius/normalized/${input.operationId}@${input.version}`,
    quotaModelId: 'quota://helius/compute-units',
    cachePolicyId: 'cache://short-ttl',
    timeoutMs: input.timeoutMs ?? 15_000,
    retryPolicyId: 'retry://standard',
    declaredIndependenceGroup: 'helius-primary',
    upstreamLineage: [],
    licensePolicyId: 'license://helius-terms-2026-03',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'quota-reset://monthly',
    protectedReserveEligible: false,
    paidFallbackAllowed: false,
    verificationExpiresAt: VERIFICATION_HORIZON,
    ...input,
  };
}

export const HELIUS_DESCRIPTOR: ProviderAdapterDescriptor = {
  providerId: 'helius',
  displayName: 'Helius Solana raw/history reads',
  providerGroup: 'chain-data',
  baseUrl: 'https://mainnet.helius-rpc.com',
  operations: [
    heliusOperation({
      operationId: 'get-raw-transaction',
      version: '1.0.0',
      displayName: 'Fetch raw transaction payload',
      capabilityClass: 'READ_TRANSACTION_RAW',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/v2/transactions/get-transaction',
      declaredQueryParams: ['api-key', 'signature', 'encoding'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 4_194_304,
      allowlistEntries: RPC_HOSTS,
      allowedInStrictFree: true,
      forbiddenOutputFields: [],
    }),
    heliusOperation({
      operationId: 'get-transaction-history',
      version: '1.0.0',
      displayName: 'List historical signatures for an address',
      capabilityClass: 'READ_TRANSACTION_HISTORY',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/v2/addresses/{address}/signatures',
      declaredQueryParams: ['api-key', 'limit', 'before'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 2_097_152,
      allowlistEntries: RPC_HOSTS,
      allowedInStrictFree: true,
    }),
    heliusOperation({
      operationId: 'get-address-balances',
      version: '1.0.0',
      displayName: 'Read address balances',
      capabilityClass: 'READ_ACCOUNT_STATE',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/v1/addresses/{address}/balances',
      declaredQueryParams: ['api-key', 'show-zero'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 1_048_576,
      allowlistEntries: RPC_HOSTS,
      allowedInStrictFree: true,
    }),
    heliusOperation({
      operationId: 'get-parsed-transactions',
      version: '1.0.0',
      baseUrl: 'https://api.helius.dev',
      displayName: 'Vendor-enhanced transaction summaries (deprecated parser as fallback only)',
      capabilityClass: 'READ_TRANSACTION_HISTORY',
      costClass: 'FREE_QUOTA',
      pathTemplate: '/v0/addresses/{address}/transactions',
      declaredQueryParams: ['api-key', 'limit', 'before'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 2_097_152,
      allowlistEntries: API_HOSTS,
      allowedInStrictFree: true,
    }),
    heliusOperation({
      operationId: 'get-enhanced-token-data',
      version: '1.0.0',
      baseUrl: 'https://api.helius.dev',
      displayName: 'Plan-gated enhanced token metadata batch',
      capabilityClass: 'READ_MARKET',
      costClass: 'PAID_EXPLICIT',
      pathTemplate: '/v0/tokens/metadata',
      declaredQueryParams: ['api-key', 'mint'],
      expectedContentTypes: ['application/json'],
      maxResponseBytes: 524_288,
      allowlistEntries: API_HOSTS,
      allowedInStrictFree: false,
      planGated: true,
    }),
  ],
};
