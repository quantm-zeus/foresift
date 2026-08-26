/**
 * Helius operation catalog (FR-PROV-007, §15.8; T117).
 *
 * The four-way separation the PRD mandates:
 *   * raw `getTransaction` — SUPPORTED, normative evidence input;
 *   * standard signature history (`getSignaturesForAddress`) — SUPPORTED;
 *   * the DEPRECATED enhanced-transaction parser — retained as
 *     NON-AUTHORITATIVE supporting evidence ONLY, usable exclusively under a
 *     valid migration exception, authority NONE;
 *   * the plan-gated history operation — unavailable on STRICT_FREE plans
 *     (surfaced as disabled metadata, never fabricated availability).
 *
 * Decoder-authority metadata rides ON the catalog entries so the T118 wiring
 * test validates REAL configuration built from THIS catalog.
 */
import type { AllowlistDescriptor } from '../adapter-contract.ts';
import type { UtcTimestamp } from '@foresift/domain';
import type { OperationDefinition } from '@foresift/provider-lifecycle';

/** Honest-by-default: unverified catalog registrations carry an elapsed window. */
const UNVERIFIED_WINDOW_END = '2020-01-01T00:00:00Z' as UtcTimestamp;

const RPC_HOST = 'mainnet.helius-rpc.com';
const API_HOST = 'api.helius.xyz';
const PORT = 443;

/** Authority/status metadata carried by every Helius catalog entry. */
export interface HeliusDecoderMetadata {
  /** Decoder-authority role (validateDecoderAuthority vocabulary). */
  readonly decoderAuthority: 'SOLE' | 'PRIMARY' | 'FALLBACK' | 'NONE';
  readonly decoderStatus: 'ACTIVE' | 'DEPRECATED' | 'RETIRED';
  /** True when execution demands a valid migration exception. */
  readonly requiresMigrationException: boolean;
  /** True when the active plan gates the operation (STRICT_FREE → disabled). */
  readonly planGated: boolean;
}

export interface HeliusCatalogEntry {
  readonly operation: OperationDefinition;
  readonly descriptor: AllowlistDescriptor;
  readonly responseSchemaId: string;
  readonly decoder: HeliusDecoderMetadata;
}

function heliusOperation(
  operationId: string,
  overrides?: Partial<OperationDefinition>,
): OperationDefinition {
  return {
    providerId: 'helius',
    operationId,
    version: 'v1',
    capabilityClass: 'READ_MARKET',
    costClass: 'PAID_EXPLICIT',
    supportedChains: ['solana'],
    supportedPrograms: ['spl-token', 'token-2022'],
    inputSchemaId: `helius/in/${operationId}@1`,
    rawOutputSchemaId: `helius/raw/${operationId}@1`,
    normalizedOutputSchemaId: `helius/norm/${operationId}@1`,
    quotaModelId: 'helius-credits@1',
    cachePolicyId: 'no-cache@1',
    timeoutMs: 15_000,
    retryPolicyId: 'idempotent-post@1',
    declaredIndependenceGroup: 'HELIUS_RPC',
    upstreamLineage: [],
    licensePolicyId: 'helius-tos@1',
    estimatedQuotaUnits: 1,
    quotaResetPolicyId: 'monthly-credits@1',
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
    ...overrides,
  };
}

function jsonRpcDescriptor(operationId: string): AllowlistDescriptor {
  return {
    operationId,
    scheme: 'https',
    host: RPC_HOST,
    port: PORT,
    pathTemplate: '/',
    method: 'POST',
    requestContentTypes: ['application/json'],
    responseContentTypes: ['application/json'],
    responseSchemaId: `helius/${operationId}@1`,
    // JSON-RPC envelope only — the method name inside `params` is bounded by
    // the per-operation catalog entry that owns this descriptor.
    allowedQueryFields: [],
    allowedRequestFields: ['jsonrpc', 'id', 'method', 'params'],
    redirectPolicy: 'REFUSE',
    maxRedirects: 0,
    maxResponseBytes: 8 * 1024 * 1024,
  };
}

function apiGetDescriptor(operationId: string, pathTemplate: string): AllowlistDescriptor {
  return {
    operationId,
    scheme: 'https',
    host: API_HOST,
    port: PORT,
    pathTemplate,
    method: 'GET',
    requestContentTypes: [],
    responseContentTypes: ['application/json'],
    responseSchemaId: `helius/${operationId}@1`,
    allowedQueryFields: ['api-key'],
    allowedRequestFields: [],
    redirectPolicy: 'REFUSE',
    maxRedirects: 0,
    maxResponseBytes: 8 * 1024 * 1024,
  };
}

/** The complete Helius surface with its decoder-authority metadata. */
export const HELIUS_OPERATIONS: readonly HeliusCatalogEntry[] = [
  {
    // Normative raw transaction fetch.
    operation: heliusOperation('rpc.get_transaction'),
    descriptor: jsonRpcDescriptor('rpc.get_transaction'),
    responseSchemaId: 'helius/rpc.get_transaction@1',
    decoder: {
      decoderAuthority: 'SOLE',
      decoderStatus: 'ACTIVE',
      requiresMigrationException: false,
      planGated: false,
    },
  },
  {
    // Standard signature history.
    operation: heliusOperation('rpc.get_signatures_for_address'),
    descriptor: jsonRpcDescriptor('rpc.get_signatures_for_address'),
    responseSchemaId: 'helius/rpc.get_signatures_for_address@1',
    decoder: {
      decoderAuthority: 'PRIMARY',
      decoderStatus: 'ACTIVE',
      requiresMigrationException: false,
      planGated: false,
    },
  },
  {
    // DEPRECATED enhanced parser — non-authoritative supporting evidence
    // ONLY; execution demands a valid migration exception.
    operation: heliusOperation('enhanced.get_transaction', {
      deprecatedAt: '2026-01-01T00:00:00Z' as UtcTimestamp,
      replacementOperationId: 'rpc.get_transaction',
    }),
    descriptor: apiGetDescriptor('enhanced.get_transaction', '/v0/transactions/{signature}'),
    responseSchemaId: 'helius/enhanced.get_transaction@1',
    decoder: {
      decoderAuthority: 'NONE',
      decoderStatus: 'DEPRECATED',
      requiresMigrationException: true,
      planGated: false,
    },
  },
  {
    // Plan-gated history operation: disabled for STRICT_FREE consumption.
    operation: heliusOperation('history.get_transactions_for_address', {
      allowedInStrictFree: false,
    }),
    descriptor: apiGetDescriptor(
      'history.get_transactions_for_address',
      '/v0/addresses/{address}/transactions',
    ),
    responseSchemaId: 'helius/history.get_transactions_for_address@1',
    decoder: {
      decoderAuthority: 'PRIMARY',
      decoderStatus: 'ACTIVE',
      requiresMigrationException: false,
      planGated: true,
    },
  },
] as const;

export function heliusCatalogEntry(operationId: string): HeliusCatalogEntry {
  const entry = HELIUS_OPERATIONS.find((e) => e.operation.operationId === operationId);
  if (entry === undefined) {
    throw new Error(`unknown Helius operation ${operationId}`);
  }
  return entry;
}

export function heliusExposedOperationIds(): string[] {
  return HELIUS_OPERATIONS.map((entry) => entry.operation.operationId);
}
