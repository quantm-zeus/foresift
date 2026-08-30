/**
 * MCP Payload fixtures (FR-MCP-001, FR-MCP-003, §17.4, §29.4, AC-050, AC-251).
 *
 * Covers oversized request bodies, §29.4 response/page caps, valid §17.4 output envelopes,
 * and prohibited financial payload structures.
 */
import type { UtcTimestamp } from '@foresift/domain';

/** Request size limits per G.13 config. */
export const MAXIMUM_REQUEST_BYTES = 262144; // 256 KiB
export const MAXIMUM_RESPONSE_BYTES = 1048576; // 1 MiB
export const MAXIMUM_PAGE_RECORDS = 100;

/** Valid request payload inside the size cap. */
export const VALID_IN_CAP_REQUEST = {
  jsonrpc: '2.0',
  id: 'req-001',
  method: 'tools/call',
  params: {
    name: 'discover_candidates',
    arguments: { limit: 10 },
  },
};

/** Oversized request payload exceeding 256 KiB cap. */
export const OVERSIZED_REQUEST_PAYLOAD = {
  jsonrpc: '2.0',
  id: 'req-oversized-001',
  method: 'tools/call',
  params: {
    name: 'discover_candidates',
    arguments: {
      padding: 'x'.repeat(MAXIMUM_REQUEST_BYTES + 1024),
    },
  },
};

/** Valid §17.4 MCP structured output envelope fixture. */
export const VALID_MCP_OUTPUT_ENVELOPE = {
  structuredContent: {
    candidates: [
      {
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Wrapped SOL',
        marketCapUsd: 75000000000,
      },
    ],
    page: 1,
    pageSize: 1,
    totalRecords: 1,
  },
  textContent: 'Discovered 1 candidate token: SOL (Wrapped SOL) at So11111111111111111111111111111111111111112.',
  meta: {
    toolName: 'discover_candidates',
    toolVersion: '1.0.0',
    provider: 'first-party-dex-observer',
    operation: 'discover_candidates',
    evidenceIds: ['ev-mcp-001', 'ev-mcp-002'],
    observedAt: '2026-08-01T00:00:00Z' as UtcTimestamp,
    availableAt: '2026-08-01T00:01:00Z' as UtcTimestamp,
    fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
    cache: 'HIT_FRESH',
    freshnessSeconds: 30,
    qualityCodes: ['QUALITY_HIGH', 'SOURCE_FIRST_PARTY_VERIFIED'],
    conflicts: [],
    quota: {
      quotaModel: 'REQUESTS_PER_PERIOD',
      reservationState: 'COMMITTED',
      estimatedUnits: 1,
      actualUnits: 1,
    },
    partial: false,
    nextCursor: 'cur_page_2_tok_abc',
    resourceUris: ['evidence://ev-mcp-001', 'evidence://ev-mcp-002'],
  },
  resourceLinks: [
    { uri: 'evidence://ev-mcp-001', title: 'DEX Observation Receipt' },
    { uri: 'evidence://ev-mcp-002', title: 'Candidate Verification' },
  ],
};

/** Degraded / abstention §17.4 output envelope fixture. */
export const DEGRADED_MCP_OUTPUT_ENVELOPE = {
  structuredContent: {
    candidates: [],
    abstention: {
      reason: 'INSUFFICIENT_FIRST_PARTY_EVIDENCE',
      details: 'Optional provider metrics unavailable; degraded breadth without paying paid provider fees.',
    },
  },
  textContent: 'Explicit abstention: Insufficient first-party evidence to verify token security thesis.',
  meta: {
    toolName: 'research_get_security_evidence',
    toolVersion: '1.0.0',
    evidenceIds: ['ev-abstain-001'],
    fetchedAt: '2026-08-01T00:01:05Z' as UtcTimestamp,
    cache: 'MISS',
    qualityCodes: ['QUALITY_PARTIAL', 'SOURCE_DEGRADED_UNAVAILABLE', 'EXPLICIT_ABSTENTION'],
    conflicts: [],
    quota: {
      quotaModel: 'REQUESTS_PER_PERIOD',
      reservationState: 'COMMITTED',
      estimatedUnits: 1,
      actualUnits: 1,
    },
    partial: true,
    abstentionReason: 'INSUFFICIENT_FIRST_PARTY_EVIDENCE',
    resourceUris: ['conflict://conf-001'],
  },
  resourceLinks: [
    { uri: 'conflict://conf-001', title: 'Disagreement Record' },
  ],
};

/** Prohibited financial payloads that must be scrubbed / rejected (§17.4, INV-001, AC-050). */
export const PROHIBITED_FINANCIAL_PAYLOADS = [
  {
    name: 'raw unsigned transaction payload',
    data: {
      transaction: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      type: 'SOLANA_TRANSACTION',
    },
  },
  {
    name: 'private key export in response payload',
    data: {
      privateKey: '5J3mBbAH58CpQ3Y5RNJpUKPE62SQ5tfcvU2JpgyBghFdZXHp1r7',
      secretKeyBase58: '4A7B...',
    },
  },
  {
    name: 'seed phrase / mnemonic in payload',
    data: {
      mnemonic: 'army van defense carry jealous true garbage claim echo media make crunch',
      derivationPath: "m/44'/501'/0'/0'",
    },
  },
  {
    name: 'executable swap / trade order instruction',
    data: {
      action: 'EXECUTE_SWAP',
      dex: 'RAYDIUM',
      amountIn: '1000000000',
      slippageTolerance: 0.01,
    },
  },
  {
    name: 'wallet signature request instruction',
    data: {
      type: 'SIGN_TRANSACTION_REQUEST',
      message: 'Sign this message to authorize transfer',
      recipient: 'So11111111111111111111111111111111111111112',
    },
  },
] as const;
