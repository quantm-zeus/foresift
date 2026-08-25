/**
 * Catalog support (FR-PROV-004/005): shared types and the read-only
 * operation-definition builder used by the declarative per-provider
 * catalogs. Pure data helpers — no transport, no vendor I/O.
 */
import { utcTimestamp } from '@foresift/domain';
import type {
  CapabilityClass,
  CostClass,
  OperationDefinition,
} from '@foresift/provider-lifecycle';
import type { AdapterAllowlistDescriptor } from './adapter-contract.ts';

/**
 * Authority role a catalog entry plays in decoder-authority configuration
 * (FR-PROV-007): consumed to build `DecodingPathConfig` for the security
 * package's landed validator against REAL registry entries.
 */
export interface DecoderRole {
  readonly authority: 'SOLE' | 'PRIMARY' | 'FALLBACK' | 'NONE';
  readonly domains: readonly string[];
}

/** One catalog entry: full definition + exact allowlist + optional role. */
export interface ProviderCatalogEntry {
  readonly definition: OperationDefinition;
  readonly allowlist: AdapterAllowlistDescriptor;
  readonly decoderRole?: DecoderRole | undefined;
}

export interface ReadOnlyDefinitionInput {
  readonly providerId: string;
  readonly operationId: string;
  readonly capabilityClass: CapabilityClass;
  /** Fills every mandatory §15.3 field with audited defaults. */
  readonly version?: string;
  readonly supportedChains?: readonly string[];
  readonly costClass?: CostClass;
  readonly allowedInStrictFree?: boolean;
  readonly paidFallbackAllowed?: boolean;
  readonly deprecatedAt?: string | undefined;
  readonly sunsetAt?: string | undefined;
  readonly replacementOperationId?: string | undefined;
  readonly negativeCapabilities?: readonly string[];
  readonly upstreamLineage?: readonly string[];
  readonly declaredIndependenceGroup?: string;
}

/**
 * Build a complete read-only operation definition. Every operation leaves
 * this builder carrying the standard negative-capability metadata —
 * registration enforces that floor, this makes it impossible to forget.
 */
export function defineReadOnlyOperation(input: ReadOnlyDefinitionInput): OperationDefinition {
  return {
    providerId: input.providerId,
    operationId: input.operationId,
    version: input.version ?? '1.0.0',
    capabilityClass: input.capabilityClass,
    supportedChains: [...(input.supportedChains ?? ['solana-mainnet'])],
    inputSchemaId: `schema/${input.operationId}/input`,
    rawOutputSchemaId: `schema/${input.operationId}/raw`,
    normalizedOutputSchemaId: `schema/${input.operationId}/normalized`,
    quotaModelId: 'quota/per-operation',
    cachePolicyId: 'cache/ttl-60s',
    timeoutMs: 10_000,
    retryPolicyId: 'retry/exponential-twice',
    declaredIndependenceGroup: input.declaredIndependenceGroup ?? `${input.providerId}:primary`,
    upstreamLineage: [...(input.upstreamLineage ?? [])],
    licensePolicyId: 'license/terms-attribution',
    healthStatus: 'HEALTHY',
    costClass: input.costClass ?? 'FREE_QUOTA',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'reset/daily',
    protectedReserveEligible: false,
    allowedInStrictFree: input.allowedInStrictFree ?? true,
    paidFallbackAllowed: input.paidFallbackAllowed ?? false,
    ...(input.deprecatedAt === undefined ? {} : { deprecatedAt: utcTimestamp(input.deprecatedAt) }),
    ...(input.sunsetAt === undefined ? {} : { sunsetAt: utcTimestamp(input.sunsetAt) }),
    ...(input.replacementOperationId === undefined
      ? {}
      : { replacementOperationId: input.replacementOperationId }),
    verificationExpiresAt: utcTimestamp('2027-01-01T00:00:00Z'),
    forbiddenOutputFields: ['swapRoute', 'serializedTransaction', 'privateKey'],
    negativeCapabilities: [
      ...new Set([
        'no-trading',
        'no-custody',
        'no-signing',
        'no-private-key-handling',
        'no-transaction-submission',
        ...(input.negativeCapabilities ?? []),
      ]),
    ],
  };
}
