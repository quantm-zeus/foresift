/**
 * Batch coalescing fixtures and test vectors (FR-COST-005, AC-102).
 */

export interface BatchItemFixture {
  readonly itemId: string;
  readonly providerId: string;
  readonly operationId: string;
  readonly tokenAddress: string;
  readonly chainId: string;
  readonly callerId: string;
  readonly requestedAt: string;
}

export const COMPATIBLE_BATCH_ITEMS: readonly BatchItemFixture[] = [
  {
    itemId: 'item-1',
    providerId: 'prov_gmgn',
    operationId: 'get_token_security',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chainId: 'solana',
    callerId: 'actor-1',
    requestedAt: '2026-08-01T12:00:00.100Z',
  },
  {
    itemId: 'item-2',
    providerId: 'prov_gmgn',
    operationId: 'get_token_security',
    tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    chainId: 'solana',
    callerId: 'actor-2',
    requestedAt: '2026-08-01T12:00:00.120Z',
  },
  {
    itemId: 'item-3',
    providerId: 'prov_gmgn',
    operationId: 'get_token_security',
    tokenAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    chainId: 'solana',
    callerId: 'actor-3',
    requestedAt: '2026-08-01T12:00:00.140Z',
  },
  {
    itemId: 'item-4',
    providerId: 'prov_gmgn',
    operationId: 'get_token_security',
    tokenAddress: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    chainId: 'solana',
    callerId: 'actor-4',
    requestedAt: '2026-08-01T12:00:00.160Z',
  },
];

export const INCOMPATIBLE_DIFFERENT_PROVIDER_ITEMS: readonly BatchItemFixture[] = [
  {
    itemId: 'item-helius-1',
    providerId: 'prov_helius',
    operationId: 'get_token_security',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chainId: 'solana',
    callerId: 'actor-1',
    requestedAt: '2026-08-01T12:00:00.100Z',
  },
  {
    itemId: 'item-gmgn-1',
    providerId: 'prov_gmgn',
    operationId: 'get_token_security',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chainId: 'solana',
    callerId: 'actor-2',
    requestedAt: '2026-08-01T12:00:00.110Z',
  },
];

export const INCOMPATIBLE_DIFFERENT_OPERATION_ITEMS: readonly BatchItemFixture[] = [
  {
    itemId: 'item-op-1',
    providerId: 'prov_gmgn',
    operationId: 'get_token_security',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chainId: 'solana',
    callerId: 'actor-1',
    requestedAt: '2026-08-01T12:00:00.100Z',
  },
  {
    itemId: 'item-op-2',
    providerId: 'prov_gmgn',
    operationId: 'get_wallet_holdings',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chainId: 'solana',
    callerId: 'actor-2',
    requestedAt: '2026-08-01T12:00:00.110Z',
  },
];

/** Generate N compatible items for testing max batch size and safe utilization. */
export function generateCompatibleBatchItems(count: number): readonly BatchItemFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    itemId: `gen-item-${String(i + 1)}`,
    providerId: 'prov_gmgn',
    operationId: 'get_token_security',
    tokenAddress: `TokenAddress${'A'.repeat(30)}${String(i).padStart(4, '0')}`,
    chainId: 'solana',
    callerId: `actor-${String(i + 1)}`,
    requestedAt: '2026-08-01T12:00:00.000Z',
  }));
}
