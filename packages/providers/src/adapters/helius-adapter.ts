/**
 * Helius adapter (FR-PROV-007; T117): raw/history reads with LOCAL decoding
 * separation. Methods returning RAW payloads feed the local decoder; the
 * enhanced-parser-backed operation exists only as a deprecated fallback and
 * the plan-gated operation is refused under STRICT_FREE at this boundary.
 */
import type { ProviderHttpResponse } from '../fetch-port.ts';
import { EgressFetchPort } from '../fetch-port.ts';
import { DescriptorAdapter } from '../adapter-runtime.ts';
import { HELIUS_DESCRIPTOR } from '../catalogs/helius.catalog.ts';
import { HELIUS_PLAN_GATED_OPERATION_ID } from '../helius-decoding.ts';
import { ProviderLifecycleError, ProvErrorCode } from '@foresift/provider-lifecycle';

export interface StrictFreePolicy {
  /** True when the deployment runs STRICT_FREE (no paid plans at all). */
  readonly strictFree: boolean;
}

export class HeliusAdapter extends DescriptorAdapter {
  private readonly policy: StrictFreePolicy;

  constructor(port: EgressFetchPort, policy: StrictFreePolicy) {
    super(HELIUS_DESCRIPTOR, port);
    this.policy = policy;
  }

  getRawTransaction(
    query: { readonly 'api-key': string; readonly signature: string; readonly encoding: string },
  ): Promise<ProviderHttpResponse> {
    return this.execute('get-raw-transaction', { query });
  }

  getTransactionHistory(
    pathParams: { readonly address: string },
    query: { readonly 'api-key': string; readonly limit: string; readonly before?: string | undefined },
  ): Promise<ProviderHttpResponse> {
    return this.execute('get-transaction-history', {
      pathParams,
      ...(query.before === undefined
        ? {}
        : {
            query: { 'api-key': query['api-key'], limit: query.limit, before: query.before },
          }),
    });
  }

  getAddressBalances(
    pathParams: { readonly address: string },
    query: { readonly 'api-key': string; readonly 'show-zero'?: string | undefined },
  ): Promise<ProviderHttpResponse> {
    const { 'show-zero': _sz, ...rest } = query;
    void _sz;
    return this.execute('get-address-balances', {
      pathParams,
      ...(query['show-zero'] === undefined ? {} : { query: { ...rest, 'show-zero': query['show-zero'] } }),
    });
  }

  getParsedTransactions(
    pathParams: { readonly address: string },
    query: { readonly 'api-key': string; readonly limit: string },
  ): Promise<ProviderHttpResponse> {
    return this.execute('get-parsed-transactions', { pathParams, query });
  }

  /** Plan-gated operation: refused outright under STRICT_FREE. */
  async getEnhancedTokenData(
    query: { readonly 'api-key': string; readonly mint: string },
  ): Promise<ProviderHttpResponse> {
    if (this.policy.strictFree) {
      throw new ProviderLifecycleError(
        ProvErrorCode.PROV_STRICT_FREE_UNAVAILABLE,
        `${HELIUS_PLAN_GATED_OPERATION_ID} is plan-gated and disabled under STRICT_FREE`,
        { operationId: HELIUS_PLAN_GATED_OPERATION_ID },
      );
    }
    return this.execute(HELIUS_PLAN_GATED_OPERATION_ID, { query });
  }
}
