/**
 * MCP JSON-RPC Payload and Prohibited-Pattern test fixtures (FR-MCP-001, FR-MCP-003; AC-050, AC-251, AC-254).
 * Conforming JSON-RPC 2.0 messages, oversized message vectors (>262144 bytes),
 * and prohibited financial / custodial payload patterns (§17.4, §17.11).
 */

export const VALID_JSONRPC_INITIALIZE = {
  jsonrpc: '2.0',
  id: 'init-req-001',
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {
      roots: { listChanged: true },
      sampling: {},
    },
    clientInfo: {
      name: 'foresift-test-client',
      version: '1.0.0',
    },
  },
};

export const VALID_JSONRPC_TOOLS_LIST = {
  jsonrpc: '2.0',
  id: 'tools-list-req-002',
  method: 'tools/list',
  params: {},
};

export const VALID_JSONRPC_TOOLS_CALL = {
  jsonrpc: '2.0',
  id: 'tools-call-req-003',
  method: 'tools/call',
  params: {
    name: 'discover_candidates',
    arguments: {
      limit: 10,
    },
  },
};

export const VALID_JSONRPC_RESOURCES_LIST = {
  jsonrpc: '2.0',
  id: 'res-list-req-004',
  method: 'resources/list',
  params: {},
};

export const VALID_JSONRPC_RESOURCES_READ = {
  jsonrpc: '2.0',
  id: 'res-read-req-005',
  method: 'resources/read',
  params: {
    uri: 'evidence://ev-discovery-001',
  },
};

export const VALID_JSONRPC_PROMPTS_LIST = {
  jsonrpc: '2.0',
  id: 'prompts-list-req-006',
  method: 'prompts/list',
  params: {},
};

export const VALID_JSONRPC_PROMPTS_GET = {
  jsonrpc: '2.0',
  id: 'prompts-get-req-007',
  method: 'prompts/get',
  params: {
    name: 'analyze-token',
    arguments: {
      address: 'So11111111111111111111111111111111111111112',
    },
  },
};

/** Hard request cap constant per G.13 / PRD: 262144 bytes (256 KiB) */
export const MAXIMUM_REQUEST_BYTES = 262144;

/** Oversized payload test cases (>262144 bytes) */
export const OVERSIZED_PAYLOAD_CASES = [
  {
    name: 'exactly one byte over limit (262145 bytes)',
    messageBytes: MAXIMUM_REQUEST_BYTES + 1,
    expectedReason: 'MESSAGE_OVERSIZE',
  },
  {
    name: '1 MiB message payload',
    messageBytes: 1024 * 1024,
    expectedReason: 'MESSAGE_OVERSIZE',
  },
  {
    name: '10 MiB huge payload',
    messageBytes: 10 * 1024 * 1024,
    expectedReason: 'MESSAGE_OVERSIZE',
  },
  {
    name: 'negative byte count (malformed)',
    messageBytes: -1,
    expectedReason: 'MESSAGE_OVERSIZE',
  },
];

/**
 * Prohibited financial / custodial / key operations (§17.4, §17.11).
 * MCP surface MUST reject any schema, tool, or output carrying these patterns.
 */
export const PROHIBITED_PAYLOAD_VECTORS = [
  {
    category: 'SWAP_EXECUTION',
    payload: {
      action: 'swap',
      fromToken: 'SOL',
      toToken: 'USDC',
      amountIn: '10.5',
      route: ['Raydium', 'Orca'],
    },
    forbiddenTerms: ['swap', 'amountIn', 'route'],
  },
  {
    category: 'BRIDGE_TRANSACTION',
    payload: {
      action: 'bridge',
      sourceChain: 'solana',
      destinationChain: 'ethereum',
      recipient: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    },
    forbiddenTerms: ['bridge', 'destinationChain'],
  },
  {
    category: 'TRANSACTION_SIGNING_REQUEST',
    payload: {
      action: 'sign_transaction',
      serializedTx:
        'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    },
    forbiddenTerms: ['sign_transaction', 'serializedTx'],
  },
  {
    category: 'PRIVATE_KEY_MATERIAL',
    payload: {
      privateKey: '5J3mBbAH58CpDC3YCUWnnobumHUECoiz62GnMiCBTxUDzUjywnL',
      secretSeed: 'infant wear universe churn dynamic visual verify...',
    },
    forbiddenTerms: ['privateKey', 'secretSeed'],
  },
  {
    category: 'ORDER_PLACEMENT',
    payload: {
      orderType: 'LIMIT_BUY',
      pair: 'SOL/USDC',
      price: '150.00',
      size: '100',
    },
    forbiddenTerms: ['LIMIT_BUY', 'orderType'],
  },
  {
    category: 'WALLET_CREATION_IMPORT',
    payload: {
      operation: 'create_wallet',
      derivationPath: "m/44'/501'/0'/0'",
    },
    forbiddenTerms: ['create_wallet', 'derivationPath'],
  },
];
