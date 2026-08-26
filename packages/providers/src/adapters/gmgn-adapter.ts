/**
 * GMGN adapter (FR-PROV-006; T116): the strictly query-only reference
 * adapter. Every method is a thin, named binding over the descriptor — no
 * additional endpoints can exist because there is no way to add one.
 */
import type { ProviderHttpResponse } from '../fetch-port.ts';
import { EgressFetchPort } from '../fetch-port.ts';
import { DescriptorAdapter } from '../adapter-runtime.ts';
import { GMGN_DESCRIPTOR } from '../catalogs/gmgn.catalog.ts';

export class GmgnAdapter extends DescriptorAdapter {
  constructor(port: EgressFetchPort) {
    super(GMGN_DESCRIPTOR, port);
  }

  getTokenPrice(query: { readonly chain: string; readonly address: string }): Promise<ProviderHttpResponse> {
    return this.execute('get-token-price', { query });
  }

  getTokenOverview(query: { readonly chain: string; readonly address: string }): Promise<ProviderHttpResponse> {
    return this.execute('get-token-overview', { query });
  }

  getTrendingPools(
    query: { readonly orderby: string; readonly direction: string; readonly limit: string },
  ): Promise<ProviderHttpResponse> {
    return this.execute('get-trending-pools', { query });
  }

  getAddressActivity(query: { readonly chain: string; readonly wallet: string }): Promise<ProviderHttpResponse> {
    return this.execute('get-address-activity', { query });
  }
}
