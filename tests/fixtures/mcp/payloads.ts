/**
 * MCP Payload test fixtures (FR-MCP-001, FR-MCP-009, AC-001, AC-144, AC-251, PRD §17.1, §29.4).
 * JSON-RPC 2.0 message templates, size limit fixtures (256 KiB request, 1 MiB response),
 * page size cap (100 records), and malformed payloads.
 */

export const MCP_MAX_REQUEST_BYTES = 262144; // 256 KiB
export const MCP_MAX_STRUCTURED_RESPONSE_BYTES = 1048576; // 1 MiB
export const MCP_MAX_PAGE_SIZE = 100;

export const ALL_MCP_PROMPT_NAMES = [
  'analyze-token',
  'investigate-alert',
  'compare-candidates',
  'audit-security',
  'explain-original-decision',
  're-evaluate-current',
  'analyze-wallet-cluster',
  'challenge-opportunity-thesis',
] as const;

export const ALL_MCP_RESOURCE_SCHEMES = [
  'evidence',
  'run',
  'candidate',
  'snapshot',
  'report',
  'conflict',
  'capacity',
  'tradability',
] as const;

export const VALID_JSONRPC_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
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
} as const;

export const VALID_JSONRPC_INITIALIZED_NOTIFICATION = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
} as const;

export const VALID_JSONRPC_PING_REQUEST = {
  jsonrpc: '2.0',
  id: 2,
  method: 'ping',
} as const;

export const VALID_JSONRPC_TOOLS_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/list',
  params: {
    cursor: undefined,
  },
} as const;

export const VALID_JSONRPC_TOOLS_CALL_REQUEST = {
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: {
    name: 'discover_candidates',
    arguments: {
      minLiquidityUsd: 10000,
      window: '24h',
      limit: 10,
    },
  },
} as const;

export const VALID_JSONRPC_RESOURCES_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 5,
  method: 'resources/list',
} as const;

export const VALID_JSONRPC_RESOURCES_READ_REQUEST = {
  jsonrpc: '2.0',
  id: 6,
  method: 'resources/read',
  params: {
    uri: 'evidence://ev-discovery-001',
  },
} as const;

export const VALID_JSONRPC_PROMPTS_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 7,
  method: 'prompts/list',
} as const;

export const VALID_JSONRPC_PROMPTS_GET_REQUEST = {
  jsonrpc: '2.0',
  id: 8,
  method: 'prompts/get',
  params: {
    name: 'analyze-token',
    arguments: {
      address: 'So11111111111111111111111111111111111111112',
    },
  },
} as const;

/** Creates a synthetic oversized request payload exceeding 256 KiB. */
export function createOversizedRequestPayload(): string {
  const base = JSON.stringify(VALID_JSONRPC_TOOLS_CALL_REQUEST);
  const paddingSize = MCP_MAX_REQUEST_BYTES - base.length + 1024;
  return JSON.stringify({
    ...VALID_JSONRPC_TOOLS_CALL_REQUEST,
    params: {
      ...VALID_JSONRPC_TOOLS_CALL_REQUEST.params,
      padding: 'x'.repeat(paddingSize),
    },
  });
}

/** Creates a synthetic oversized response payload exceeding 1 MiB. */
export function createOversizedResponseData(): Record<string, unknown> {
  const bulkEntries = Array.from({ length: 5000 }, (_, i) => ({
    id: `entry-${i}`,
    payload: 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(10),
    nested: { fieldA: 'data', fieldB: 12345, tags: ['a', 'b', 'c', 'd'] },
  }));
  return { candidates: bulkEntries };
}

export const MALFORMED_JSONRPC_PAYLOADS = [
  {
    description: 'missing jsonrpc version',
    payload: { id: 1, method: 'tools/list' },
  },
  {
    description: 'wrong jsonrpc version',
    payload: { jsonrpc: '1.0', id: 1, method: 'tools/list' },
  },
  {
    description: 'call missing method',
    payload: { jsonrpc: '2.0', id: 1 },
  },
  {
    description: 'request missing id',
    payload: { jsonrpc: '2.0', method: 'tools/call', params: { name: 'discover_candidates' } },
  },
  {
    description: 'invalid params type (primitive instead of object)',
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: 'invalid' },
  },
] as const;
