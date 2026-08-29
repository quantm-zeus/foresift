export interface ProgramSupportManifestFixture {
  readonly manifestId: string;
  readonly chainId: string;
  readonly protocolFamily: 'PUMP' | 'RAYDIUM' | 'ORCA' | 'METEORA' | 'JUPITER' | string;
  readonly productFamily: string;
  readonly programId: string;
  readonly programDataAddress?: string;
  readonly deployedAtSlot?: string;
  readonly currentProgramDataSlot?: string;
  readonly upgradeAuthorityState: 'IMMUTABLE' | 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
  readonly upgradeAuthorityAddress?: string;
  readonly accountLayoutVersion: string;
  readonly instructionLayoutVersion: string;
  readonly idlOrLayoutSha256: string;
  readonly decoderVersion: string;
  readonly poolMathAdapterVersion?: string;
  readonly transferSemanticsVersion?: string;
  readonly supportedEventFamilies: readonly string[];
  readonly requiredAccountFamilies: readonly string[];
  readonly officialReferenceUris: readonly string[];
  readonly officialReferencesVerifiedAt: string;
  readonly liveChainVerificationSlot: string;
  readonly liveChainVerificationHash: string;
  readonly capabilityState: 'UNAVAILABLE' | 'DEGRADED' | 'SHADOW' | 'ACTIVE' | 'RETIRED';
  readonly unsupportedReasons: readonly string[];
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly contentHash: string;
  readonly approvalArtifactId: string;
}

const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

export const PUMP_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_pump_v1_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'PUMP',
  productFamily: 'pump_bonding_curve',
  programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  programDataAddress: 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1',
  deployedAtSlot: '240000000',
  currentProgramDataSlot: '240000000',
  upgradeAuthorityState: 'REVOKED',
  accountLayoutVersion: '1.0.0',
  instructionLayoutVersion: '1.0.0',
  idlOrLayoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  decoderVersion: '1.0.0',
  poolMathAdapterVersion: '1.0.0',
  transferSemanticsVersion: '1.0.0',
  supportedEventFamilies: ['BONDING_CURVE_CREATE', 'BONDING_CURVE_TRADE', 'PUMP_SWAP_MIGRATION'],
  requiredAccountFamilies: ['BondingCurve', 'GlobalConfig'],
  officialReferenceUris: ['https://github.com/pump-fun/contracts'],
  officialReferencesVerifiedAt: '2026-01-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_pump_280m',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-01-01T00:00:00Z',
  validUntil: '2027-01-01T00:00:00Z',
  contentHash: 'sha256:manifest_pump_content_hash_001',
  approvalArtifactId: 'art_approval_pump_001',
};

export const RAYDIUM_V4_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_raydium_v4_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'RAYDIUM',
  productFamily: 'raydium_amm_v4',
  programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  upgradeAuthorityState: 'REVOKED',
  accountLayoutVersion: '4.0.0',
  instructionLayoutVersion: '4.0.0',
  idlOrLayoutSha256: 'sha256:raydium_v4_layout_hash_pinned',
  decoderVersion: '1.0.0',
  poolMathAdapterVersion: '1.0.0',
  supportedEventFamilies: ['POOL_CREATE', 'SWAP', 'LIQUIDITY_ADD', 'LIQUIDITY_REMOVE'],
  requiredAccountFamilies: ['AmmInfo', 'TargetOrders'],
  officialReferenceUris: ['https://github.com/raydium-io/raydium-amm'],
  officialReferencesVerifiedAt: '2026-01-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_raydium_v4',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-01-01T00:00:00Z',
  validUntil: '2027-01-01T00:00:00Z',
  contentHash: 'sha256:manifest_raydium_v4_content_hash',
  approvalArtifactId: 'art_approval_raydium_001',
};

export const RAYDIUM_CPMM_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_raydium_cpmm_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'RAYDIUM',
  productFamily: 'raydium_cpmm',
  programId: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  upgradeAuthorityState: 'ACTIVE',
  upgradeAuthorityAddress: 'RaydiumAdmin111111111111111111111111111111111',
  accountLayoutVersion: '1.0.0',
  instructionLayoutVersion: '1.0.0',
  idlOrLayoutSha256: 'sha256:raydium_cpmm_layout_hash_pinned',
  decoderVersion: '1.0.0',
  poolMathAdapterVersion: '1.0.0',
  supportedEventFamilies: ['POOL_CREATE', 'SWAP', 'LIQUIDITY_DEPOSIT', 'LIQUIDITY_WITHDRAW'],
  requiredAccountFamilies: ['PoolState', 'AmmConfig'],
  officialReferenceUris: ['https://github.com/raydium-io/raydium-cpmm'],
  officialReferencesVerifiedAt: '2026-02-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_raydium_cpmm',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-02-01T00:00:00Z',
  contentHash: 'sha256:manifest_raydium_cpmm_content_hash',
  approvalArtifactId: 'art_approval_raydium_cpmm_001',
};

export const RAYDIUM_CLMM_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_raydium_clmm_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'RAYDIUM',
  productFamily: 'raydium_clmm',
  programId: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  upgradeAuthorityState: 'ACTIVE',
  accountLayoutVersion: '1.0.0',
  instructionLayoutVersion: '1.0.0',
  idlOrLayoutSha256: 'sha256:raydium_clmm_layout_hash_pinned',
  decoderVersion: '1.0.0',
  poolMathAdapterVersion: '1.0.0',
  supportedEventFamilies: ['POOL_CREATE', 'SWAP', 'POSITION_OPEN', 'POSITION_CLOSE'],
  requiredAccountFamilies: ['PoolState', 'TickArray', 'PersonalPosition'],
  officialReferenceUris: ['https://github.com/raydium-io/raydium-clmm'],
  officialReferencesVerifiedAt: '2026-02-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_raydium_clmm',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-02-01T00:00:00Z',
  contentHash: 'sha256:manifest_raydium_clmm_content_hash',
  approvalArtifactId: 'art_approval_raydium_clmm_001',
};

export const ORCA_WHIRLPOOLS_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_orca_whirlpools_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'ORCA',
  productFamily: 'orca_whirlpools',
  programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  upgradeAuthorityState: 'ACTIVE',
  accountLayoutVersion: '1.0.0',
  instructionLayoutVersion: '1.0.0',
  idlOrLayoutSha256: 'sha256:orca_whirlpools_layout_hash_pinned',
  decoderVersion: '1.0.0',
  poolMathAdapterVersion: '1.0.0',
  supportedEventFamilies: [
    'WHIRLPOOL_INITIALIZE',
    'SWAP',
    'INCREASE_LIQUIDITY',
    'DECREASE_LIQUIDITY',
  ],
  requiredAccountFamilies: ['Whirlpool', 'TickArray', 'Position'],
  officialReferenceUris: ['https://github.com/orca-so/whirlpools'],
  officialReferencesVerifiedAt: '2026-01-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_orca',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-01-01T00:00:00Z',
  contentHash: 'sha256:manifest_orca_content_hash',
  approvalArtifactId: 'art_approval_orca_001',
};

export const METEORA_DLMM_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_meteora_dlmm_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'METEORA',
  productFamily: 'meteora_dlmm',
  programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  upgradeAuthorityState: 'ACTIVE',
  accountLayoutVersion: '1.0.0',
  instructionLayoutVersion: '1.0.0',
  idlOrLayoutSha256: 'sha256:meteora_dlmm_layout_hash_pinned',
  decoderVersion: '1.0.0',
  poolMathAdapterVersion: '1.0.0',
  supportedEventFamilies: ['PAIR_INITIALIZE', 'SWAP', 'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY'],
  requiredAccountFamilies: ['LbPair', 'BinArray'],
  officialReferenceUris: ['https://github.com/MeteoraAg/dlmm-sdk'],
  officialReferencesVerifiedAt: '2026-01-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_meteora_dlmm',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-01-01T00:00:00Z',
  contentHash: 'sha256:manifest_meteora_dlmm_content_hash',
  approvalArtifactId: 'art_approval_meteora_dlmm_001',
};

export const METEORA_DBC_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_meteora_dbc_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'METEORA',
  productFamily: 'meteora_dbc',
  programId: 'dbcv4gHn4sN97d5b1q7QnB8yK4wD3mF2pL1xZ6vR9tE',
  upgradeAuthorityState: 'ACTIVE',
  accountLayoutVersion: '1.0.0',
  instructionLayoutVersion: '1.0.0',
  idlOrLayoutSha256: 'sha256:meteora_dbc_layout_hash_pinned',
  decoderVersion: '1.0.0',
  poolMathAdapterVersion: '1.0.0',
  supportedEventFamilies: ['BONDING_CURVE_INIT', 'SWAP', 'MIGRATION'],
  requiredAccountFamilies: ['DbcConfig', 'VirtualPool'],
  officialReferenceUris: ['https://github.com/MeteoraAg/dynamic-bonding-curve'],
  officialReferencesVerifiedAt: '2026-03-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_meteora_dbc',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-03-01T00:00:00Z',
  contentHash: 'sha256:manifest_meteora_dbc_content_hash',
  approvalArtifactId: 'art_approval_meteora_dbc_001',
};

export const JUPITER_ROUTE_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_jupiter_route_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'JUPITER',
  productFamily: 'jupiter_route_observation',
  programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  upgradeAuthorityState: 'ACTIVE',
  accountLayoutVersion: '6.0.0',
  instructionLayoutVersion: '6.0.0',
  idlOrLayoutSha256: 'sha256:jupiter_route_layout_hash_pinned',
  decoderVersion: '1.0.0',
  supportedEventFamilies: ['ROUTE_OBSERVATION', 'SWAP_EVENT_ROUTED'],
  requiredAccountFamilies: [],
  officialReferenceUris: ['https://github.com/jup-ag/jupiter-core'],
  officialReferencesVerifiedAt: '2026-01-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_jupiter_route',
  capabilityState: 'ACTIVE',
  unsupportedReasons: [],
  validFrom: '2026-01-01T00:00:00Z',
  contentHash: 'sha256:manifest_jupiter_route_content_hash',
  approvalArtifactId: 'art_approval_jupiter_001',
};

export const DEGRADED_MANIFEST: ProgramSupportManifestFixture = {
  manifestId: 'man_degraded_001',
  chainId: SOLANA_MAINNET,
  protocolFamily: 'PUMP',
  productFamily: 'pump_bonding_curve',
  programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  upgradeAuthorityState: 'ACTIVE',
  accountLayoutVersion: '2.0.0',
  instructionLayoutVersion: '2.0.0',
  idlOrLayoutSha256: 'sha256:mismatched_layout_sha',
  decoderVersion: '1.0.0',
  supportedEventFamilies: ['BONDING_CURVE_TRADE'],
  requiredAccountFamilies: ['BondingCurve'],
  officialReferenceUris: ['https://github.com/pump-fun/contracts'],
  officialReferencesVerifiedAt: '2026-01-01T00:00:00Z',
  liveChainVerificationSlot: '280000000',
  liveChainVerificationHash: 'sha256:live_verification_mismatch',
  capabilityState: 'DEGRADED',
  unsupportedReasons: ['IDL_OR_LAYOUT_MISMATCH', 'UNVERIFIED_UPGRADE_DETECTED'],
  validFrom: '2026-01-01T00:00:00Z',
  contentHash: 'sha256:manifest_degraded_content_hash',
  approvalArtifactId: 'art_approval_degraded_001',
};
