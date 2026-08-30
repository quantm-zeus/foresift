/**
 * MCP Payloads and Limits fixtures (FR-MCP-001, FR-MCP-003, PRD §29.4, AC-251).
 *
 * Provides standard JSON-RPC 2.0 requests for all MCP primitives, boundary
 * payloads testing request/response caps (256 KiB request, 1 MiB response),
 * and pagination limits (100 records max).
 */

export const MCP_LIMITS = {
  REQUEST_BODY_MAX_BYTES: 262144, // 256 KiB
  STRUCTURED_RESPONSE_MAX_BYTES: 1048576, // 1 MiB
  PAGE_SIZE_MAX: 100,
} as const;

/** Standard initialize request adhering to baseline protocol 2025-11-25. */
export const MCP_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    },
    clientInfo: {
      name: 'foresift-test-client',
      version: '1.0.0',
    },
  },
} as const;

/** Standard tools/list request. */
export const MCP_TOOLS_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
} as const;

/** Standard tools/call request for discover_candidates. */
export const MCP_TOOLS_CALL_DISCOVER_REQUEST = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    name: 'discover_candidates',
    arguments: {
      limit: 25,
      filter: { chain: 'solana' },
    },
  },
} as const;

/** Standard tools/call request for get_asset_identity. */
export const MCP_TOOLS_CALL_IDENTITY_REQUEST = {
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: {
    name: 'get_asset_identity',
    arguments: {
      tokenAddress: 'So11111111111111111111111111111111111111112',
    },
  },
} as const;

/** Standard resources/list request. */
export const MCP_RESOURCES_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 5,
  method: 'resources/list',
  params: {},
} as const;

/** Standard resources/read request for an evidence URI. */
export const MCP_RESOURCES_READ_REQUEST = {
  jsonrpc: '2.0',
  id: 6,
  method: 'resources/read',
  params: {
    uri: 'evidence://ev-discovery-001',
  },
} as const;

/** Standard prompts/list request. */
export const MCP_PROMPTS_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 7,
  method: 'prompts/list',
  params: {},
} as const;

/** Standard prompts/get request. */
export const MCP_PROMPTS_GET_REQUEST = {
  jsonrpc: '2.0',
  id: 8,
  method: 'prompts/get',
  params: {
    name: 'analyze-token',
    arguments: {
      tokenAddress: 'So11111111111111111111111111111111111111112',
    },
  },
} as const;

/** Generate an oversized payload string of exact byte length. */
export function generateOversizedString(targetBytes: number): string {
  return 'x'.repeat(targetBytes);
}

/** Generates an oversized request exceeding the 256 KiB cap. */
export function makeOversizedRequestPayload(): string {
  const largeArg = 'a'.repeat(262150);
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 99,
    method: 'tools/call',
    params: {
      name: 'discover_candidates',
      arguments: { junk: largeArg },
    },
  });
}
