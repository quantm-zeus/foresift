/**
 * Sanitized provider-response corpus — POSITIVE CONTROLS (T125).
 *
 * One representative clean response per adapter operation, recorded from
 * public API shapes and stripped of live identifiers. Every entry MUST pass
 * the response scanner unchanged (AC-271 acceptance pairs these with the
 * forbidden corpus in ../forbidden-corpus.ts).
 *
 * Fixture-corpus rules (documented exclusion from production scans): this
 * directory is DECLARATIVE DATA ONLY — no imports, no executable content,
 * no real credentials, no hazardous material. The "malicious" samples in
 * forbidden-corpus.ts are inert skeletons: field names and shape markers
 * with constant dummy values.
 */

export interface RecordedResponse {
  readonly providerId: string;
  readonly operationId: string;
  readonly contentType: string;
  readonly bodyText: string;
}

export const GMGN_TOKEN_SECURITY_READ: RecordedResponse = {
  providerId: 'gmgn',
  operationId: 'gmgn/token-security-read',
  contentType: 'application/json',
  bodyText: JSON.stringify({
    token_security: {
      top10_holder_rate: '0.42',
      holder_count: 18344,
      lp_burned: true,
      honeypot: false,
      contract_renounced: true,
      audit_refs: ['goplus/2026-01'],
    },
  }),
};

export const GMGN_TOKEN_OVERVIEW_READ: RecordedResponse = {
  providerId: 'gmgn',
  operationId: 'gmgn/token-overview-read',
  contentType: 'application/json',
  bodyText: JSON.stringify({
    price_usd: '0.0042',
    market_cap_usd: '18400000',
    volume_24h_usd: '921000',
    price_change_24h: '-3.1',
    liquidity_usd: '610000',
  }),
};

export const GMGN_TRENDING_POOLS_READ: RecordedResponse = {
  providerId: 'gmgn',
  operationId: 'gmgn/trending-pools-read',
  contentType: 'application/json',
  bodyText: JSON.stringify({
    rank: 1,
    interval: '5m',
    pools: [
      { chain: 'sol', pool_id: 'pool-0001', swaps_5m: 812, makers_5m: 344 },
      { chain: 'sol', pool_id: 'pool-0002', swaps_5m: 402, makers_5m: 190 },
    ],
  }),
};

export const GMGN_WALLET_ACTIVITY_READ: RecordedResponse = {
  providerId: 'gmgn',
  operationId: 'gmgn/wallet-activity-read',
  contentType: 'application/json',
  bodyText: JSON.stringify({
    history: [
      { activity_type: 'swap', token_in: 'SOL', token_out: 'TOKEN-A', amount_usd: '120.50' },
      { activity_type: 'receive', token: 'TOKEN-B', amount_ui: '1000' },
    ],
  }),
};

export const HELIUS_RAW_GET_TRANSACTION: RecordedResponse = {
  providerId: 'helius',
  operationId: 'helius/raw-get-transaction',
  contentType: 'application/json',
  bodyText: JSON.stringify({
    signature: '4RfYSANITIZEDRAWRESPONSE0000000000000000000000000',
    slot: 281_452_004,
    meta: { status: { Ok: null }, fee: 5000 },
    transaction: { message: { accountKeys: ['ACC1SANITIZED', 'ACC2SANITIZED'] } },
  }),
};

export const HELIUS_SIGNATURE_HISTORY_STANDARD: RecordedResponse = {
  providerId: 'helius',
  operationId: 'helius/signature-history-standard',
  contentType: 'application/json',
  bodyText: JSON.stringify([
    { signature: 'SIGSANITIZED000000000000000000000000000000000', slot: 281_452_001 },
    { signature: 'SIGSANITIZED111111111111111111111111111111111', slot: 281_451_997 },
  ]),
};

export const HELIUS_ENHANCED_TRANSACTION_PARSE: RecordedResponse = {
  // DEPRECATED endpoint — kept as a positive control for the exception-
  // gated path ONLY; new use is blocked without a valid migration exception.
  providerId: 'helius',
  operationId: 'helius/enhanced-transaction-parse',
  contentType: 'application/json',
  bodyText: JSON.stringify({
    signature: 'SIGSANITIZEDENHANCED00000000000000000000000000',
    type: 'SWAP',
    source: 'JUPITER',
    tokenTransfers: [
      { fromUserAccount: 'ACC1SANITIZED', toUserAccount: 'POOL1SANITIZED', mint: 'MINT1', tokenAmount: 1.5 },
    ],
  }),
};

/** All positive controls together — every one must scan clean. */
export const ALL_CLEAN_RESPONSES: readonly RecordedResponse[] = [
  GMGN_TOKEN_SECURITY_READ,
  GMGN_TOKEN_OVERVIEW_READ,
  GMGN_TRENDING_POOLS_READ,
  GMGN_WALLET_ACTIVITY_READ,
  HELIUS_RAW_GET_TRANSACTION,
  HELIUS_SIGNATURE_HISTORY_STANDARD,
  HELIUS_ENHANCED_TRANSACTION_PARSE,
];
