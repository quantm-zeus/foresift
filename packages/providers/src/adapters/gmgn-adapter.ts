/**
 * GMGN read-only adapter (FR-PROV-006). Every call is a GET through the
 * AdapterContract's exact allowlist and the injected FetchPort — the
 * adapter itself holds no URLs beyond its catalog's declared templates and
 * no capability beyond reading recorded query responses.
 */
import { AdapterContract, buildQueryUrl } from '../adapter-contract.ts';
import type { FetchPort } from '../fetch-port.ts';
import { GMGN_HOST, GMGN_PROVIDER } from '../operation-catalogs/gmgn.catalog.ts';

export interface GmgnAdapterOptions {
  readonly contract: AdapterContract;
  readonly fetch: FetchPort;
}

interface ReadInput {
  readonly address?: string;
  readonly chain?: string;
  readonly wallet?: string;
  readonly query?: Readonly<Record<string, string>>;
}

export class GmgnAdapter {
  private readonly contract: AdapterContract;
  private readonly fetch: FetchPort;

  constructor(options: GmgnAdapterOptions) {
    this.contract = options.contract;
    this.fetch = options.fetch;
  }

  get providerId(): string {
    return GMGN_PROVIDER.providerId;
  }

  /** Token security / risk signals for one mint. */
  async tokenSecurity(input: ReadInput): Promise<unknown> {
    return this.read(
      'gmgn/token-security-read',
      `/api/v1/token_security/${input.chain ?? 'sol'}/${input.address ?? ''}`,
      input.query,
    );
  }

  /** Price/liquidity/market-cap overview for one mint. */
  async tokenOverview(input: ReadInput): Promise<unknown> {
    return this.read(
      'gmgn/token-overview-read',
      `/api/v1/token_overview/${input.chain ?? 'sol'}/${input.address ?? ''}`,
      input.query,
    );
  }

  /** Trending pool ranking read. */
  async trendingPools(input: ReadInput): Promise<unknown> {
    return this.read('gmgn/trending-pools-read', `/api/v1/trending_pools/${input.chain ?? 'sol'}`, input.query);
  }

  /** Historical wallet activity read (public chain activity only). */
  async walletActivity(input: ReadInput): Promise<unknown> {
    return this.read(
      'gmgn/wallet-activity-read',
      `/api/v1/wallet_activity/${input.chain ?? 'sol'}/${input.wallet ?? ''}`,
      input.query,
    );
  }

  private async read(operationId: string, path: string, query?: Readonly<Record<string, string>>): Promise<unknown> {
    const url = buildQueryUrl(`https://${GMGN_HOST}`, path, query);
    return this.contract.execute(this.fetch, operationId, url);
  }
}
