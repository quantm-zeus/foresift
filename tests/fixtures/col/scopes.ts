import type { UtcTimestamp } from '@foresift/domain';

export interface CollectorScopeDeclaration {
  readonly scopeId: string;
  readonly chainId: string;
  readonly programId: string;
  readonly programVersion: string;
  readonly accountLayoutVersion: string;
  readonly supportedEventFamilies: readonly string[];
  readonly coverageStartSlot: string;
  readonly coverageStartTime: UtcTimestamp;
  readonly finalityPolicy: 'confirmed' | 'finalized';
  readonly decoderVersion: string;
  readonly quotaStreamedByteEnvelope: {
    readonly maxBytesPerSec: number;
    readonly maxEventsPerSec: number;
  };
  readonly maximumLagSlots: number;
  readonly maximumGapAgeSeconds: number;
  readonly rightsPolicy: string;
}

export const SOLANA_CHAIN_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

export const PUMP_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_pump_v1',
  chainId: SOLANA_CHAIN_ID,
  programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  programVersion: '1.0.0',
  accountLayoutVersion: '1.0.0',
  supportedEventFamilies: ['BONDING_CURVE_CREATE', 'BONDING_CURVE_TRADE', 'PUMP_SWAP_MIGRATION'],
  coverageStartSlot: '250000000',
  coverageStartTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 10_000_000,
    maxEventsPerSec: 5000,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const RAYDIUM_AMM_V4_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_raydium_v4',
  chainId: SOLANA_CHAIN_ID,
  programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  programVersion: '4.0.0',
  accountLayoutVersion: '4.0.0',
  supportedEventFamilies: ['POOL_CREATE', 'SWAP', 'LIQUIDITY_ADD', 'LIQUIDITY_REMOVE'],
  coverageStartSlot: '250000000',
  coverageStartTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 10_000_000,
    maxEventsPerSec: 5000,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const RAYDIUM_CPMM_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_raydium_cpmm',
  chainId: SOLANA_CHAIN_ID,
  programId: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  programVersion: '1.0.0',
  accountLayoutVersion: '1.0.0',
  supportedEventFamilies: ['POOL_CREATE', 'SWAP', 'LIQUIDITY_DEPOSIT', 'LIQUIDITY_WITHDRAW'],
  coverageStartSlot: '260000000',
  coverageStartTime: '2026-02-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 5_000_000,
    maxEventsPerSec: 2500,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const RAYDIUM_CLMM_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_raydium_clmm',
  chainId: SOLANA_CHAIN_ID,
  programId: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  programVersion: '1.0.0',
  accountLayoutVersion: '1.0.0',
  supportedEventFamilies: ['POOL_CREATE', 'SWAP', 'POSITION_OPEN', 'POSITION_CLOSE'],
  coverageStartSlot: '260000000',
  coverageStartTime: '2026-02-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 5_000_000,
    maxEventsPerSec: 2500,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const ORCA_WHIRLPOOLS_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_orca_whirlpools',
  chainId: SOLANA_CHAIN_ID,
  programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  programVersion: '1.0.0',
  accountLayoutVersion: '1.0.0',
  supportedEventFamilies: ['WHIRLPOOL_INITIALIZE', 'SWAP', 'INCREASE_LIQUIDITY', 'DECREASE_LIQUIDITY'],
  coverageStartSlot: '250000000',
  coverageStartTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 10_000_000,
    maxEventsPerSec: 5000,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const METEORA_DLMM_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_meteora_dlmm',
  chainId: SOLANA_CHAIN_ID,
  programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  programVersion: '1.0.0',
  accountLayoutVersion: '1.0.0',
  supportedEventFamilies: ['PAIR_INITIALIZE', 'SWAP', 'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY'],
  coverageStartSlot: '250000000',
  coverageStartTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 10_000_000,
    maxEventsPerSec: 5000,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const METEORA_DBC_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_meteora_dbc',
  chainId: SOLANA_CHAIN_ID,
  programId: 'dbcv4gHn4sN97d5b1q7QnB8yK4wD3mF2pL1xZ6vR9tE',
  programVersion: '1.0.0',
  accountLayoutVersion: '1.0.0',
  supportedEventFamilies: ['BONDING_CURVE_INIT', 'SWAP', 'MIGRATION'],
  coverageStartSlot: '270000000',
  coverageStartTime: '2026-03-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 5_000_000,
    maxEventsPerSec: 2500,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const JUPITER_ROUTE_SCOPE: CollectorScopeDeclaration = {
  scopeId: 'scope_jupiter_route_obs',
  chainId: SOLANA_CHAIN_ID,
  programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  programVersion: '6.0.0',
  accountLayoutVersion: '6.0.0',
  supportedEventFamilies: ['ROUTE_OBSERVATION', 'SWAP_EVENT_ROUTED'],
  coverageStartSlot: '250000000',
  coverageStartTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed',
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: {
    maxBytesPerSec: 15_000_000,
    maxEventsPerSec: 8000,
  },
  maximumLagSlots: 50,
  maximumGapAgeSeconds: 300,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const UNSUPPORTED_CHAIN_SCOPE = {
  scopeId: 'scope_unsupported_chain',
  chainId: 'unknown:999999',
  programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  programVersion: '1.0.0',
  accountLayoutVersion: '1.0.0',
  supportedEventFamilies: ['TRADE'],
  coverageStartSlot: '1',
  coverageStartTime: '2026-01-01T00:00:00Z' as UtcTimestamp,
  finalityPolicy: 'confirmed' as const,
  decoderVersion: '1.0.0',
  quotaStreamedByteEnvelope: { maxBytesPerSec: 1000, maxEventsPerSec: 10 },
  maximumLagSlots: 10,
  maximumGapAgeSeconds: 60,
  rightsPolicy: 'OPEN_INTERNAL',
};

export const UNSUPPORTED_PROGRAM_SCOPE = {
  ...PUMP_SCOPE,
  scopeId: 'scope_unsupported_prog',
  programId: 'UnknownProgram111111111111111111111111111111',
};

export const UNSUPPORTED_VERSION_SCOPE = {
  ...PUMP_SCOPE,
  scopeId: 'scope_unsupported_ver',
  programVersion: '99.0.0',
};
