/**
 * Helius adapter (FR-PROV-007; T117).
 *
 * Builds the registrable manifest from the catalog and enforces the two
 * runtime gates the catalog metadata declares:
 *   * `enhanced.get_transaction` executes ONLY under a valid migration
 *     exception (the deprecated parser is never silently usable);
 *   * `history.get_transactions_for_address` refuses on STRICT_FREE plans —
 *     plan-gated operations surface as disabled, never fabricated.
 */
import { z } from 'zod';
import type { AdapterManifestInput } from '../registration.ts';
import { HELIUS_OPERATIONS, heliusCatalogEntry } from '../operation-catalogs/helius.catalog.ts';
import type { OperationTarget } from '@foresift/provider-lifecycle';
import { ProviderAdapterError, ProvAdapterErrorCode } from '../errors.ts';

/** Raw JSON-RPC getTransaction result: passthrough over the fields we read. */
export const HeliusRawTransactionResponse = z
  .object({
    slot: z.number(),
  })
  .passthrough();

export const HeliusSignaturesResponse = z.array(z.object({}).passthrough());

export const HeliusEnhancedTransactionResponse = z.object({}).passthrough();

export const HeliusAddressHistoryResponse = z.array(z.object({}).passthrough());

const HELIUS_RESPONSE_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  'helius/rpc.get_transaction@1': HeliusRawTransactionResponse,
  'helius/rpc.get_signatures_for_address@1': HeliusSignaturesResponse,
  'helius/enhanced.get_transaction@1': HeliusEnhancedTransactionResponse,
  'helius/history.get_transactions_for_address@1': HeliusAddressHistoryResponse,
};

export function createHeliusAdapterManifest(): AdapterManifestInput {
  return {
    adapterId: 'helius-raw-history',
    providerId: 'helius',
    plane: 'COLLECTOR',
    operations: HELIUS_OPERATIONS.map((entry) => {
      const schema = HELIUS_RESPONSE_SCHEMAS[entry.responseSchemaId];
      if (schema === undefined) {
        throw new Error(`no Helius response schema registered for ${entry.responseSchemaId}`);
      }
      return {
        operation: entry.operation,
        descriptor: entry.descriptor,
        responseSchemaId: entry.responseSchemaId,
        responseSchema: schema,
      };
    }),
  };
}

export function heliusResponseSchema(schemaId: string): z.ZodType<unknown> {
  const schema = HELIUS_RESPONSE_SCHEMAS[schemaId];
  if (schema === undefined) {
    throw new Error(`no Helius response schema registered for ${schemaId}`);
  }
  return schema;
}

/** Minimal use-time authority gate seam (wired to MigrationExceptions). */
export interface MigrationExceptionGate {
  assertValidForUse(target: OperationTarget): Promise<unknown>;
}

export type SolanaPlanClass = 'STRICT_FREE' | 'METERED';

/**
 * Runtime gates every Helius operation execution passes BEFORE any transport:
 * plan availability first, then the deprecation/exception fence.
 */
export async function assertHeliusOperationExecutable(
  operationId: string,
  options: {
    readonly plan?: SolanaPlanClass | undefined;
    readonly exceptions?: MigrationExceptionGate | undefined;
    /** Registry target for the exception lookup. */
    readonly target?: OperationTarget | undefined;
  },
): Promise<void> {
  const entry = heliusCatalogEntry(operationId);
  const provider = entry.operation.providerId;
  const target: OperationTarget = options.target ?? {
    providerId: provider,
    operationId: entry.operation.operationId,
    version: entry.operation.version,
  };

  if (entry.decoder.planGated && options.plan === 'STRICT_FREE') {
    throw new ProviderAdapterError(
      `${operationId} is plan-gated and unavailable on STRICT_FREE plans; surfaced as disabled, never fabricated`,
      { operationId },
      ProvAdapterErrorCode.PROV_ADAPTER_PLAN_GATED_UNAVAILABLE,
    );
  }
  if (entry.decoder.requiresMigrationException) {
    if (options.exceptions === undefined) {
      throw new ProviderAdapterError(
        `${operationId} is the DEPRECATED enhanced parser; execution requires a valid migration exception and none is wired`,
        { operationId },
        ProvAdapterErrorCode.PROV_ADAPTER_DEPRECATED_PARSER_BLOCKED,
      );
    }
    try {
      await options.exceptions.assertValidForUse(target);
    } catch (error) {
      throw new ProviderAdapterError(
        `${operationId} has no valid migration exception at the current instant; the deprecated parser stays non-authoritative and unusable`,
        { operationId, cause: error instanceof Error ? error.message : String(error) },
        ProvAdapterErrorCode.PROV_ADAPTER_DEPRECATED_PARSER_BLOCKED,
      );
    }
  }
}
