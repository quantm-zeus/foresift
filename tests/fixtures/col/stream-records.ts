import type { UtcTimestamp } from '@foresift/domain';

export interface CollectorStreamRecordFixture {
  readonly recordId: string;
  readonly endpoint: string;
  readonly subscriptionFilterVersion: string;
  readonly connectionGeneration: number;
  readonly slot: string;
  readonly blockHash: string;
  readonly transactionSignature: string;
  readonly instructionIndex: number;
  readonly logIndex?: number;
  readonly accountCoordinates: readonly string[];
  readonly receivedAt: UtcTimestamp;
  readonly availableAt: UtcTimestamp;
  readonly ingestedAt: UtcTimestamp;
  readonly finality: 'processed' | 'confirmed' | 'finalized';
  readonly rawArtifactHash: string;
  readonly decoderVersion: string;
  readonly rightsPolicy: string;
  readonly normalizedEventHash: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

export const STREAM_RECORD_PUMP_BUY: CollectorStreamRecordFixture = {
  recordId: 'rec_pump_001',
  endpoint: 'wss://atlas.solana.rpc.internal',
  subscriptionFilterVersion: '1.0.0',
  connectionGeneration: 1,
  slot: '300100200',
  blockHash: '5K2kQdDq9Jm7M4T7q8Wv1YkZ3PxL9Rn6SgHb8XvQ4wE2',
  transactionSignature: '5Upq7rZ9kX1mY3vN8wP2qL5sT4jK6hF8dG9aB3cE2wX4',
  instructionIndex: 0,
  logIndex: 2,
  accountCoordinates: [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    'BondingCurveAccount111111111111111111111111',
    'UserWallet11111111111111111111111111111111',
  ],
  receivedAt: '2026-08-20T10:00:00.000Z' as UtcTimestamp,
  availableAt: '2026-08-20T10:00:00.005Z' as UtcTimestamp,
  ingestedAt: '2026-08-20T10:00:00.010Z' as UtcTimestamp,
  finality: 'confirmed',
  rawArtifactHash: 'sha256:raw_stream_record_payload_hash_001',
  decoderVersion: '1.0.0',
  rightsPolicy: 'OPEN_INTERNAL',
  normalizedEventHash: 'sha256:normalized_event_pump_buy_001',
  eventType: 'BONDING_CURVE_TRADE',
  payload: {
    side: 'BUY',
    mint: 'TokenMintAddress1111111111111111111111111111',
    solAmountLamports: '1000000000',
    tokenAmountUnits: '500000000000',
    virtualSolReserves: '30000000000',
    virtualTokenReserves: '1073000000000000',
  },
};

export const STREAM_RECORD_RAYDIUM_SWAP: CollectorStreamRecordFixture = {
  recordId: 'rec_raydium_001',
  endpoint: 'wss://atlas.solana.rpc.internal',
  subscriptionFilterVersion: '1.0.0',
  connectionGeneration: 1,
  slot: '300100201',
  blockHash: '5K2kQdDq9Jm7M4T7q8Wv1YkZ3PxL9Rn6SgHb8XvQ4wE2',
  transactionSignature: '3Kzq7rZ9kX1mY3vN8wP2qL5sT4jK6hF8dG9aB3cE2wX5',
  instructionIndex: 1,
  logIndex: 4,
  accountCoordinates: [
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    'AmmPoolAccount111111111111111111111111111111',
  ],
  receivedAt: '2026-08-20T10:00:00.100Z' as UtcTimestamp,
  availableAt: '2026-08-20T10:00:00.105Z' as UtcTimestamp,
  ingestedAt: '2026-08-20T10:00:00.110Z' as UtcTimestamp,
  finality: 'confirmed',
  rawArtifactHash: 'sha256:raw_stream_record_raydium_hash_001',
  decoderVersion: '1.0.0',
  rightsPolicy: 'OPEN_INTERNAL',
  normalizedEventHash: 'sha256:normalized_event_raydium_swap_001',
  eventType: 'SWAP',
  payload: {
    poolAddress: 'AmmPoolAccount111111111111111111111111111111',
    amountIn: '500000000',
    amountOut: '25000000000',
    direction: 'A_TO_B',
  },
};
