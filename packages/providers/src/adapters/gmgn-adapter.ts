/**
 * GMGN adapter — the query-only reference integration (FR-PROV-006; T116).
 *
 * Builds the registrable manifest from the catalog. Response schemas accept
 * the recorded provider shapes (passthrough objects with the fields the
 * normalized contract actually reads) so clean recorded fixtures flow
 * end-to-end through allowlist + validation layers.
 */
import { z } from 'zod';
import type { AdapterManifestInput } from '../registration.ts';
import { GMGN_OPERATIONS } from '../operation-catalogs/gmgn.catalog.ts';

/** Recorded token-security response shape (query data only). */
export const GmgnTokenSecurityResponse = z
  .object({
    address: z.string().min(1),
    chain: z.string().min(1),
  })
  .passthrough();

export const GmgnTopTradersResponse = z
  .object({
    traders: z.array(z.object({}).passthrough()),
  })
  .passthrough();

export const GmgnPairStatsResponse = z
  .object({
    pairAddress: z.string().min(1),
  })
  .passthrough();

const GMGN_RESPONSE_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  'gmgn/token.security@1': GmgnTokenSecurityResponse,
  'gmgn/token.top_traders@1': GmgnTopTradersResponse,
  'gmgn/token.pair_stats@1': GmgnPairStatsResponse,
};

/** The complete registrable GMGN manifest (query operations ONLY). */
export function createGmgnAdapterManifest(): AdapterManifestInput {
  return {
    adapterId: 'gmgn-query-readonly',
    providerId: 'gmgn',
    plane: 'COLLECTOR',
    operations: GMGN_OPERATIONS.map((entry) => {
      const schema = GMGN_RESPONSE_SCHEMAS[entry.responseSchemaId];
      if (schema === undefined) {
        throw new Error(`no GMGN response schema registered for ${entry.responseSchemaId}`);
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

/** Runtime schema lookup used by the adapter client wiring. */
export function gmgnResponseSchema(schemaId: string): z.ZodType<unknown> {
  const schema = GMGN_RESPONSE_SCHEMAS[schemaId];
  if (schema === undefined) {
    throw new Error(`no GMGN response schema registered for ${schemaId}`);
  }
  return schema;
}
